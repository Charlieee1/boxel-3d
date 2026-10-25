// Bit-exact port of the LLVM libc sin/cos/atan2/acos in Chromium 153.0.8010.12 (llvm-libc 20fd93c3; x86-64: no FMA, accurate passes on), copied from tas/phys/libm.js
import T from './ChromeMathTables.json';

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const biasedExp = x => { f64[0] = x; return (u32[1] >>> 20) & 0x7ff; };
const fma = (a, b, c) => a * b + c;
const TWO52 = 4503599627370496;
const rint = x => (x < TWO52 && x > -TWO52) ? (x < 0 ? (x - TWO52) + TWO52 : (x + TWO52) - TWO52) : x;

// ---------- double-double (pairs as [hi, lo]) ----------
function exactAdd(a, b) { const hi = a + b, t = hi - a; return [hi, b - t]; }
function split(a, n = 27) { const C = 2 ** n + 1, t1 = C * a, t2 = a - t1, hi = t1 + t2; return [hi, a - hi]; }
function exactMultS(as, a, b, sb) {
  const bs = split(b, sb), hi = a * b;
  const t1 = as[0] * bs[0] - hi, t2 = as[0] * bs[1] + t1, t3 = as[1] * bs[0] + t2;
  return [hi, as[1] * bs[1] + t3];
}
const exactMult = (a, b, sb = 27) => exactMultS(split(a), a, b, sb);
function quickMultDD(a, b, sb = 27) {
  const r = exactMult(a[0], b[0], sb);
  const t1 = fma(a[0], b[1], r[1]), t2 = fma(a[1], b[0], t1);
  return [r[0], t2];
}
function addDD(a, b) { const r = exactAdd(a[0], b[0]), lo = a[1] + b[1]; return exactAdd(r[0], r[1] + lo); }
function divDD(a, b) {
  const q = 1 / b[0], hi = a[0] * q;
  const bh = exactMult(b[0], -hi), bl = exactMult(b[1], -hi);
  const eh = (a[0] + bh[0]) + bh[1], el = (a[1] + bl[0]) + bl[1];
  return [hi, q * (eh + el)];
}

// ---------- DyadicFloat<128>: {s: +-1, e, m: BigInt} (value = s * m * 2^e) ----------
const M128 = (1n << 128n) - 1n, TOP = 1n << 127n, M64 = (1n << 64n) - 1n;
function clz128(m) { return 128 - m.toString(2).length; }
function DF(s, e, m) { const r = { s, e, m }; if (m !== 0n) { const k = clz128(m); r.e -= k; r.m = (m << BigInt(k)) & M128; } return r; }
function DFd(x) {
  f64[0] = x; const hi = u32[1], lo = u32[0], be = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (be) m |= 1n << 52n;
  return DF(hi >>> 31 ? -1 : 1, (be ? be : 1) - 1023 - 52, m);
}
const DFh = ([s, e, h]) => DF(s, e, BigInt(h));
function shr(a, n) { return n < 128 ? { s: a.s, e: a.e + n, m: a.m >> BigInt(n) } : { s: a.s, e: 0, m: 0n }; }
function qadd(a, b) {
  if (a.m === 0n) return b;
  if (b.m === 0n) return a;
  if (a.e > b.e) b = shr(b, a.e - b.e); else if (b.e > a.e) a = shr(a, b.e - a.e);
  if (a.s === b.s) {
    const sum = a.m + b.m;
    if (sum > M128) return { s: a.s, e: a.e + 1, m: (sum >> 1n) | TOP };
    return { s: a.s, e: a.e, m: sum };
  }
  return a.m >= b.m ? DF(a.s, a.e, a.m - b.m) : DF(b.s, b.e, b.m - a.m);
}
function qmul(a, b) {
  const s = a.s !== b.s ? -1 : 1;
  let e = a.e + b.e + 128, m = 0n;
  if (a.m !== 0n && b.m !== 0n) {
    const l0 = a.m & M64, l1 = a.m >> 64n, r0 = b.m & M64, r1 = b.m >> 64n;
    m = (((l0 * r1 + l1 * r0) >> 64n) + l1 * r1) & M128;
    if (!(m & TOP)) { e -= 1; m = (m << 1n) & M128; }
  }
  return { s, e, m };
}
const neg = a => DF(-a.s, a.e, a.m);
function pow2(n) { u32[1] = (n + 1023) << 20; u32[0] = 0; return f64[0]; }
// DyadicFloat::fast_as<double> (normal range only)
function toDouble(a) {
  if (a.m === 0n) return a.s < 0 ? -0 : 0;
  const E = a.e + 127;
  const mhi = a.m >> 75n, rnd = (a.m >> 74n) & 1n, sticky = (a.m & ((1n << 74n) - 1n)) !== 0n;
  const dhi = a.s * Number(mhi) * pow2(E - 52), dlo = a.s * pow2(E - 54);
  return fma(dlo, Number(rnd) * 2 + (sticky ? 1 : 0), dhi);
}
// polyeval(x, a0, a1, ...) = a0 + x * (a1 + x * (...))
function polyF(x, cs) { let p = cs[cs.length - 1]; for (let i = cs.length - 2; i >= 0; i--) p = qadd(cs[i], qmul(x, p)); return p; }

// ---------- sin / cos ----------
const OTOP = T.ONE_TWENTY_EIGHT_OVER_PI, SKD = T.SIN_K_PI_OVER_128.map(([lo, hi]) => [hi, lo]);
const SKF = T.SIN_K_PI_OVER_128_F128.map(DFh);
const PI_OVER_128_F128 = DF(1, -133, 0xc90fdaa22168c234c4c6628b80dc1cd1n);
const SIN_C = [[1, -127, '0x80000000000000000000000000000000'], [-1, -130, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab'], [1, -134, '0x88888888888888888888888888888889'],
  [-1, -140, '0xd00d00d00d00d00d00d00d00d00d00d0'], [1, -146, '0xb8ef1d2ab6399c7d560e4472800b8ef2'], [-1, -153, '0xd7322b3faa271c7f3a3f25c1bee38f10'],
  [1, -160, '0xb092309d43684be51c198e91d7b4269e']].map(DFh);
const COS_C = [[1, -127, '0x80000000000000000000000000000000'], [-1, -128, '0x80000000000000000000000000000000'], [1, -132, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab'],
  [-1, -137, '0xb60b60b60b60b60b60b60b60b60b60b6'], [1, -143, '0xd00d00d00d00d00d00d00d00d00d00d0'], [-1, -149, '0x93f27dbbc4fae397780b69f5333c725b'],
  [1, -156, '0x8f76c77fc6c4bdaa26d4c3d67f425f60']].map(DFh);

function reduceSmall(x) {
  const MPI = [-0.024543692605220713, -9.495469541099947e-13, -3.159791013743673e-23];
  const kd = rint(x * 40.74366543152521);
  const yhi = fma(kd, MPI[0], x), uhi = fma(kd, MPI[1], yhi), u0 = yhi - uhi;
  const u1 = fma(kd, MPI[1], u0), ulo = fma(kd, MPI[2], u1);
  return { k: kd, u: [uhi, ulo] };
}
function reduceLarge(x) {
  f64[0] = x; const be = (u32[1] >>> 20) & 0x7ff, xm = be - (1023 + 62);
  const idx = (xm >> 4) + 3;
  u32[1] = (u32[1] & 0x800fffff) | ((((xm & 15) + 1023 + 62) & 0x7ff) << 20);
  const xr = f64[0], xs = split(xr), C = OTOP[idx];
  const ph = exactMultS(xs, xr, C[0], 28), pm = exactMultS(xs, xr, C[1], 28), pl = exactMultS(xs, xr, C[2], 28);
  const kd = rint(ph[1] + pm[0]);
  const yhi = (ph[1] - kd) + pm[0], ymid = exactAdd(pm[1], pl[0]), ylo = pl[1];
  const yl = fma(xr, C[3], ylo);
  const y = exactAdd(yhi, ymid[0]); y[1] += ymid[1] + yl;
  return { k: kd, u: quickMultDD(y, [0.02454369260617026, 9.567553118338697e-19], 28), st: { idx, xr, yhi, ylo, ymid } };
}
function accurateU(x, small, st) {
  if (small) {
    const kd = rint(x * 40.74366543152521), xf = DFd(x);
    const sh = qadd(qmul(xf, DFd(OTOP[3][0])), DFd(-kd)), sl = qadd(qmul(xf, DFd(OTOP[3][1])), qmul(xf, DFd(OTOP[3][2])));
    return qmul(qadd(sh, sl), PI_OVER_128_F128);
  }
  const y0 = DFd(st.xr * OTOP[st.idx][3]), y1 = qadd(DFd(st.ylo), y0), ym = qadd(DFd(st.ymid[1]), y1);
  const yh = qadd(DFd(st.yhi), DFd(st.ymid[0]));
  return qmul(qadd(yh, ym), PI_OVER_128_F128);
}
function sincosEval(u) {
  const usq = u[0] * u[0];
  const p1 = fma(usq, -0.0001984126984126984, 0.008333333333333333), q1 = fma(usq, 0.041666666666666664, -0.5);
  const u3 = usq * u[0], p2 = fma(usq, p1, -0.16666666666666666), q2 = fma(usq, q1, 1.0);
  const sinlo = fma(u3, p2, u[1] * q2);
  const unh = -0.5 * u[0], m = exactMult(u[0], unh), v = exactAdd(1.0, m[0]); v[1] += m[1];
  const r1 = fma(usq, 0.0000248015873015873, -0.001388888888888889), s1 = fma(usq, 0.16666666666666666, -1.0);
  const u4 = usq * usq, uhl = u[0] * u[1], r2 = fma(usq, r1, 0.041666666666666664), s2 = fma(uhl, s1, v[1]);
  const coslo = fma(u4, r2, s2);
  return { sin: exactAdd(u[0], sinlo), cos: exactAdd(v[0], coslo), err: fma(Math.abs(u3), 4.440892098500626e-16, 2.465190328815662e-32) };
}
function getSinKF(kk) { const i = (kk & 64) ? 64 - (kk & 63) : (kk & 63), a = SKF[i]; return (kk & 128) ? { s: -1, e: a.e, m: a.m } : a; }
function trigAccurate(x, small, st, k, wantCos) {
  const u = accurateU(x, small, st), usq = qmul(u, u);
  const sinU = qmul(u, polyF(usq, SIN_C)), cosU = polyF(usq, COS_C);
  if (wantCos) return toDouble(qadd(qmul(getSinKF(k + 64), cosU), qmul(getSinKF(k + 128), sinU)));
  return toDouble(qadd(qmul(getSinKF(k), cosU), qmul(getSinKF(k + 64), sinU)));
}
function trig(x, wantCos) {
  const xe = biasedExp(x);
  let red, small = true;
  if (xe < 1023 + 16) {
    if (xe < 1023 - 4) {
      if (wantCos) {
        if (xe < 1023 - 27) return 1.0;
        const xsq = x * x, c0 = fma(xsq, 0.041666666666661425, -0.5), c1 = fma(xsq, 0.00002479925520961421, -0.0013888888826265567);
        const x4 = xsq * xsq, rlo = fma(x4, c1, c0) * xsq, err = fma(xsq, 1.1102230246251565e-16, 1.6940658945086007e-21);
        const up = 1.0 + (rlo + err), lw = 1.0 + (rlo - err);
        if (up === lw) return up;
      } else {
        if (xe < 1023 - 26) return x === 0 ? x + x : fma(x, -5.551115123125783e-17, x);
        const xsq = x * x, c0 = fma(xsq, 0.008333333333320677, -0.16666666666666666), c1 = fma(xsq, 0.0000027549179097726733, -0.00019841269299313875);
        const x4 = xsq * xsq, x3 = x * xsq, rlo = fma(x4, c1, c0) * x3, err = fma(xsq, 1.1102230246251565e-16, 3.3881317890172014e-21);
        const up = x + fma(x, err, rlo), lw = x + fma(-x, err, rlo);
        if (up === lw) return up;
      }
      red = reduceSmall(x);
      return trigAccurate(x, true, null, red.k, wantCos);
    }
    red = reduceSmall(x);
  } else {
    if (xe > 2046) return NaN;
    red = reduceLarge(x); small = false;
  }
  const k = red.k, ev = sincosEval(red.u);
  let a, b;
  if (wantCos) { a = quickMultDD(ev.cos, SKD[(k + 64) & 255]); b = quickMultDD(ev.sin, SKD[(k + 128) & 255]); }
  else { a = quickMultDD(ev.cos, SKD[k & 255]); b = quickMultDD(ev.sin, SKD[(k + 64) & 255]); }
  const rr = exactAdd(a[0], b[0]); rr[1] += b[1] + a[1];
  const up = rr[0] + (rr[1] + ev.err), lw = rr[0] + (rr[1] - ev.err);
  if (up === lw) return up;
  return trigAccurate(x, small, red.st, k, wantCos);
}
export const sin = x => trig(x, false);
export const cos = x => trig(x, true);

// ---------- atan2 ----------
const ATAN_I = T.ATAN_I.map(([lo, hi]) => [hi, lo]);
function atanEvalDD(x) {
  const xsq = x[0] * x[0];
  const c0 = fma(xsq, 0.2, -0.3333333333333333), c1 = fma(xsq, 0.1111111111111111, -0.14285714285714285);
  const x3 = xsq * x[0], x4 = xsq * xsq, d0 = fma(x4, c1, c0), d1 = fma(x4 - xsq, x[1], x[1]);
  return [x[0], fma(x3, d0, d1)];
}
const PI_DD = [3.141592653589793, 1.2246467991473532e-16], PIO2_DD = [1.5707963267948966, 6.123233995736766e-17];
const PIO4_DD = [0.7853981633974483, 3.061616997868383e-17], P3O4_DD = [2.356194490192345, 9.184850993605148e-17];
const ZERO_DD = [0, 0], MZERO_DD = [-0, -0], MPI_DD = [-PI_DD[0], -PI_DD[1]], MPIO2_DD = [-PIO2_DD[0], -PIO2_DD[1]];
const CONST_ADJ = [[[ZERO_DD, MPIO2_DD], [MZERO_DD, MPIO2_DD]], [[MPI_DD, PIO2_DD], [MPI_DD, PIO2_DD]]];
const EXCEPTS = [[[ZERO_DD, PI_DD], [ZERO_DD, PI_DD], [ZERO_DD, PI_DD]], [[PIO2_DD, PIO2_DD], [ZERO_DD, ZERO_DD], [ZERO_DD, PI_DD]],
  [[PIO2_DD, PIO2_DD], [PIO2_DD, PIO2_DD], [PIO4_DD, P3O4_DD]]];
const signBit = x => { f64[0] = x; return u32[1] >>> 31; };
export function atan2(y, x) {
  const IS_NEG = [1.0, -1.0];
  const xs = signBit(x), ys = signBit(y), ax = Math.abs(x), ay = Math.abs(y);
  const recip = ax < ay || ay !== ay; // libc compares the bit patterns, so a NaN y counts as larger
  let num = recip ? ax : ay, den = recip ? ay : ax;
  let minE = biasedExp(num), maxE = biasedExp(den);
  if (maxE > 0x7ff - 128 || minE < 128) {
    if (x !== x || y !== y) return NaN;
    const xe = x === 0 ? 0 : (ax === Infinity ? 2 : 1), ye = y === 0 ? 0 : (ay === Infinity ? 2 : 1);
    if (xe !== 1 || ye !== 1) { const r = EXCEPTS[ye][xe][xs]; return fma(IS_NEG[ys], r[0], IS_NEG[ys] * r[1]); }
    const up = minE < 128, down = maxE > 0x7ff - 128;
    if (up) { num *= 18446744073709552000; if (!down) den *= 18446744073709552000; } else if (down) { den *= 5.421010862427522e-20; if (!up) num *= 5.421010862427522e-20; }
    minE = biasedExp(num); maxE = biasedExp(den);
  }
  const fs = IS_NEG[((xs !== ys) !== recip) ? 1 : 0], ct = CONST_ADJ[xs][ys][recip ? 1 : 0];
  if (maxE - minE > 54) return fma(fs, ct[0], fs * (ct[1] + num / den));
  let k = rint(64.0 * num / den);
  const idx = k; k *= 0.015625;
  const nk = exactMult(num, k), dk = exactMult(den, k);
  const nd = exactAdd(num - dk[0], -dk[1]), dd = exactAdd(den, nk[0]); dd[1] += nk[1];
  const p = atanEvalDD(divDD(nd, dd));
  const r = addDD(ct, addDD(ATAN_I[idx], p));
  return r[0] * fs + r[1] * fs;
}

// ---------- acos ----------
const ASIN_C = T.ASIN_COEFFS, ASIN_CF = T.ASIN_COEFFS_F128.map(row => row.map(DFh));
const PIO2_F128 = DF(1, -127, 0xc90fdaa22168c234c4c6628b80dc1cd1n), PI_F128 = DF(1, -126, 0xc90fdaa22168c234c4c6628b80dc1cd1n);
function asinEvalDD(u, errIn) {
  const k = rint(u[0] * 32), idx = k, C = ASIN_C[idx];
  const yhi = fma(k, -0.03125, u[0]), y = exactAdd(yhi, u[1]), y2 = y[0] * y[0];
  const err = fma(errIn, y2, 1.9721522630525295e-31);
  const c0 = quickMultDD(y, [C[2], C[3]]);
  const c1 = fma(y[0], C[5], C[4]), c2 = fma(y[0], C[7], C[6]), c3 = fma(y[0], C[9], C[8]), c4 = fma(y[0], C[11], C[10]);
  const y4 = y2 * y2, d0 = fma(y2, c2, c1), d1 = fma(y2, c4, c3);
  const r = exactAdd(C[0], c0[0]), e1 = fma(y4, d1, d0);
  r[1] = fma(y2, e1, C[1] + c0[1] + r[1]);
  return { p: r, err };
}
export function acos(x) {
  const xe = biasedExp(x);
  if (xe < 1023 - 1) {
    if (xe < 1023 - 55) return (Math.abs(x) + 6.842277657836021e-49) + PIO2_DD[0];
    const xsq = exactMult(x, x);
    const { p, err } = asinEvalDD(xsq, Math.abs(x) * 4.440892098500626e-16);
    const r0 = exactMult(x, p[0]), rhi = fma(-x, p[0], PIO2_DD[0]);
    let rlo = ((PIO2_DD[0] - rhi) - r0[0]) - r0[1];
    rlo = fma(-x, p[1], rlo + PIO2_DD[1]);
    const up = rhi + (rlo + err), lw = rhi + (rlo - err);
    if (up === lw) return up;
    const idx = rint(xsq[0] * 64), xf = DFd(x);
    const u = qadd(qmul(xf, xf), DFd(idx * -0.015625));
    const pf = polyF(u, ASIN_CF[idx]);
    return toDouble(qadd(PIO2_F128, qmul({ s: -xf.s, e: xf.e, m: xf.m }, pf)));
  }
  const ax = Math.abs(x), xsg = x < 0 ? -1.0 : 1.0;
  if (xe >= 1023) {
    if (ax === 1.0) return x === 1.0 ? 0.0 : fma(-xsg, PI_DD[0], PI_DD[1]);
    return NaN;
  }
  const u = fma(ax, -0.5, 0.5), vhi = Math.sqrt(u);
  const vsq = exactMult(vhi, vhi), h = (u - vsq[0]) - vsq[1];
  const vh = vhi * 2.0, vl = h / vhi;
  const { p, err } = asinEvalDD([u, 0.0], vh * 4.440892098500626e-16);
  const r0 = quickMultDD([vh, vl], p);
  let rhi, rlo;
  if (x >= 0) { rhi = r0[0]; rlo = r0[1]; }
  else { const r = exactAdd(PI_DD[0], -r0[0]); rhi = r[0]; rlo = (PI_DD[1] - r0[1]) + r[1]; }
  const up = rhi + (rlo + err), lw = rhi + (rlo - err);
  if (up === lw) return up;
  const idx = rint(u * 64);
  const vv = exactMult(vhi, vl), vllo = ((h - vv[0]) - vv[1]) / vhi;
  const t = h * (-0.25) / u, vll = fma(vl, t, vllo);
  const mv = qadd(DFd(vh), qadd(DFd(vl), DFd(vll))); mv.s = x < 0 ? -1 : 1;
  const yf = DFd(fma(idx, -0.015625, u));
  let rf = qmul(mv, polyF(yf, ASIN_CF[idx]));
  if (x < 0) rf = qadd(PI_F128, rf);
  return toDouble(rf);
}
