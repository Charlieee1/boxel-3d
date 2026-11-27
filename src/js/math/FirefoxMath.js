// Bit-exact port of SpiderMonkey's fdlibm (modules/fdlibm, FreeBSD msun) sin/cos/atan2/acos as built for x86-64 (no FMA)

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const highWord = x => { f64[0] = x; return u32[1] | 0; };
const lowWord = x => { f64[0] = x; return u32[0]; };
const fromWords = (hi, lo) => { u32[1] = hi; u32[0] = lo; return f64[0]; };
const pow2 = n => fromWords((n + 1023) << 20, 0);
const scalbn = (x, n) => n > 1023 ? x * pow2(1023) * pow2(n - 1023) : n < -1022 ? x * pow2(-1022) * pow2(n + 1022) : x * pow2(n);

// ---------- k_sin.cpp / k_cos.cpp ----------
const S1 = fromWords(0xBFC55555, 0x55555549), S2 = fromWords(0x3F811111, 0x1110F8A6), S3 = fromWords(0xBF2A01A0, 0x19C161D5);
const S4 = fromWords(0x3EC71DE3, 0x57B1FE7D), S5 = fromWords(0xBE5AE5E6, 0x8A2B9CEB), S6 = fromWords(0x3DE5D93A, 0x5ACFD57C);
const C1 = fromWords(0x3FA55555, 0x5555554C), C2 = fromWords(0xBF56C16C, 0x16C15177), C3 = fromWords(0x3EFA01A0, 0x19CB1590);
const C4 = fromWords(0xBE927E4F, 0x809C52AD), C5 = fromWords(0x3E21EE9E, 0xBDB4B1C4), C6 = fromWords(0xBDA8FAE9, 0xBE8838D4);

function kernelSin(x, y, iy) {
  const z = x * x, w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

function kernelCos(x, y) {
  const z = x * x;
  let w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  w = 1.0 - hz;
  return w + (((1.0 - w) - hz) + (z * r - x * y));
}

// ---------- k_rem_pio2.cpp (only reached for |x| >= 2^20 * pi/2) ----------
const IPIO2 = [
  0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A,
  0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
  0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
  0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
  0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880,
  0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B
];
const PIO2 = [
  fromWords(0x3FF921FB, 0x40000000), fromWords(0x3E74442D, 0x00000000), fromWords(0x3CF84698, 0x80000000), fromWords(0x3B78CC51, 0x60000000),
  fromWords(0x39F01B83, 0x80000000), fromWords(0x387A2520, 0x40000000), fromWords(0x36E38222, 0x80000000), fromWords(0x3569F31D, 0x00000000)
];
const TWO24 = 16777216.0, TWON24 = 5.9604644775390625e-8;

function kernelRemPio2(x, y, e0, nx) {
  const iq = new Int32Array(20), f = new Float64Array(20), fq = new Float64Array(20), q = new Float64Array(20);
  const jk = 4, jp = jk, jx = nx - 1;
  let jv = ((e0 - 3) / 24) | 0; if (jv < 0) jv = 0;
  let q0 = e0 - 24 * (jv + 1);
  let i, j, k, fw, z, n, ih, carry;

  // Set up f[0] to f[jx+jk] where f[jx+jk] = ipio2[jv+jk]
  j = jv - jx;
  const m = jx + jk;
  for (i = 0; i <= m; i++, j++) f[i] = j < 0 ? 0.0 : IPIO2[j];

  // Compute q[0],q[1],...q[jk]
  for (i = 0; i <= jk; i++) {
    for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
    q[i] = fw;
  }

  let jz = jk;
  for (;;) {
    // Distill q[] into iq[] reversingly
    for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--) {
      fw = (TWON24 * z) | 0;
      iq[i] = (z - TWO24 * fw) | 0;
      z = q[j - 1] + fw;
    }

    // Compute n
    z = scalbn(z, q0);
    z -= 8.0 * Math.floor(z * 0.125);
    n = z | 0;
    z -= n;
    ih = 0;
    if (q0 > 0) {
      i = iq[jz - 1] >> (24 - q0); n += i;
      iq[jz - 1] -= i << (24 - q0);
      ih = iq[jz - 1] >> (23 - q0);
    }
    else if (q0 === 0) ih = iq[jz - 1] >> 23;
    else if (z >= 0.5) ih = 2;

    if (ih > 0) {
      n += 1; carry = 0;
      for (i = 0; i < jz; i++) {
        j = iq[i];
        if (carry === 0) {
          if (j !== 0) { carry = 1; iq[i] = 0x1000000 - j; }
        } else iq[i] = 0xffffff - j;
      }
      if (q0 > 0) {
        if (q0 === 1) iq[jz - 1] &= 0x7fffff;
        else if (q0 === 2) iq[jz - 1] &= 0x3fffff;
      }
      if (ih === 2) {
        z = 1.0 - z;
        if (carry !== 0) z -= scalbn(1.0, q0);
      }
    }

    // Check if recomputation is needed
    if (z === 0.0) {
      j = 0;
      for (i = jz - 1; i >= jk; i--) j |= iq[i];
      if (j === 0) {
        for (k = 1; iq[jk - k] === 0; k++);
        for (i = jz + 1; i <= jz + k; i++) {
          f[jx + i] = IPIO2[jv + i];
          for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
          q[i] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }

  // Chop off zero terms
  if (z === 0.0) {
    jz -= 1; q0 -= 24;
    while (iq[jz] === 0) { jz--; q0 -= 24; }
  } else {
    z = scalbn(z, -q0);
    if (z >= TWO24) {
      fw = (TWON24 * z) | 0;
      iq[jz] = (z - TWO24 * fw) | 0;
      jz += 1; q0 += 24;
      iq[jz] = fw;
    } else iq[jz] = z | 0;
  }

  // Convert integer "bit" chunk to floating-point value
  fw = scalbn(1.0, q0);
  for (i = jz; i >= 0; i--) { q[i] = fw * iq[i]; fw *= TWON24; }

  // Compute PIo2[0,...,jp]*q[jz,...,0]
  for (i = jz; i >= 0; i--) {
    for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += PIO2[k] * q[i + k];
    fq[jz - i] = fw;
  }

  // Compress fq[] into y[] (prec 1)
  fw = 0.0;
  for (i = jz; i >= 0; i--) fw += fq[i];
  y[0] = ih === 0 ? fw : -fw;
  fw = fq[0] - fw;
  for (i = 1; i <= jz; i++) fw += fq[i];
  y[1] = ih === 0 ? fw : -fw;
  return n & 7;
}

// ---------- e_rem_pio2.cpp ----------
const INVPIO2 = fromWords(0x3FE45F30, 0x6DC9C883);
const PIO2_1 = fromWords(0x3FF921FB, 0x54400000), PIO2_1T = fromWords(0x3DD0B461, 0x1A626331);
const PIO2_2 = fromWords(0x3DD0B461, 0x1A600000), PIO2_2T = fromWords(0x3BA3198A, 0x2E037073);
const PIO2_3 = fromWords(0x3BA3198A, 0x2E000000), PIO2_3T = fromWords(0x397B839A, 0x252049C1);
const RNINT = 6755399441055744.0; // 0x1.8p52
const Y = new Float64Array(2);

function remPio2Small(x, n, hx) {
  const s = hx > 0 ? 1 : -1, z = x - s * n * PIO2_1;
  Y[0] = z - s * n * PIO2_1T;
  Y[1] = (z - Y[0]) - s * n * PIO2_1T;
  return s * n;
}

function remPio2Medium(x, ix) {
  const fn = (x * INVPIO2 + RNINT) - RNINT;
  const n = fn | 0;
  let r = x - fn * PIO2_1, w = fn * PIO2_1T, t;
  const j = ix >> 20;
  Y[0] = r - w;
  let i = j - ((highWord(Y[0]) >>> 20) & 0x7ff);
  if (i > 16) {
    t = r; w = fn * PIO2_2; r = t - w;
    w = fn * PIO2_2T - ((t - r) - w);
    Y[0] = r - w;
    i = j - ((highWord(Y[0]) >>> 20) & 0x7ff);
    if (i > 49) {
      t = r; w = fn * PIO2_3; r = t - w;
      w = fn * PIO2_3T - ((t - r) - w);
      Y[0] = r - w;
    }
  }
  Y[1] = (r - Y[0]) - w;
  return n;
}

// Reduces x into Y[0] + Y[1] and returns n; caller handles |x| <= pi/4
function remPio2(x) {
  const hx = highWord(x), ix = hx & 0x7fffffff;
  if (ix <= 0x400f6a7a) {
    if ((ix & 0xfffff) === 0x921fb) return remPio2Medium(x, ix);
    return remPio2Small(x, ix <= 0x4002d97c ? 1 : 2, hx);
  }
  if (ix <= 0x401c463b) {
    if (ix <= 0x4015fdbc) {
      if (ix === 0x4012d97c) return remPio2Medium(x, ix);
      return remPio2Small(x, 3, hx);
    }
    if (ix === 0x401921fb) return remPio2Medium(x, ix);
    return remPio2Small(x, 4, hx);
  }
  if (ix < 0x413921fb) return remPio2Medium(x, ix);

  // Large arguments: z = scalbn(|x|, ilogb(x) - 23)
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), lowWord(x));
  const tx = new Float64Array(3), ty = new Float64Array(2);
  for (let i = 0; i < 2; i++) { tx[i] = z | 0; z = (z - tx[i]) * TWO24; }
  tx[2] = z;
  let nx = 3;
  while (tx[nx - 1] === 0.0) nx--;
  const n = kernelRemPio2(tx, ty, e0, nx);
  if (hx < 0) { Y[0] = -ty[0]; Y[1] = -ty[1]; return -n; }
  Y[0] = ty[0]; Y[1] = ty[1];
  return n;
}

// ---------- s_sin.cpp / s_cos.cpp ----------
export function sin(x) {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e500000) return x;
    return kernelSin(x, 0.0, 0);
  }
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kernelSin(Y[0], Y[1], 1);
    case 1: return kernelCos(Y[0], Y[1]);
    case 2: return -kernelSin(Y[0], Y[1], 1);
    default: return -kernelCos(Y[0], Y[1]);
  }
}

export function cos(x) {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e46a09e) return 1.0;
    return kernelCos(x, 0.0);
  }
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kernelCos(Y[0], Y[1]);
    case 1: return -kernelSin(Y[0], Y[1], 1);
    case 2: return -kernelCos(Y[0], Y[1]);
    default: return kernelSin(Y[0], Y[1], 1);
  }
}

// ---------- s_atan.cpp ----------
const ATANHI = [fromWords(0x3FDDAC67, 0x0561BB4F), fromWords(0x3FE921FB, 0x54442D18), fromWords(0x3FEF730B, 0xD281F69B), fromWords(0x3FF921FB, 0x54442D18)];
const ATANLO = [fromWords(0x3C7A2B7F, 0x222F65E2), fromWords(0x3C81A626, 0x33145C07), fromWords(0x3C700788, 0x7AF0CBBD), fromWords(0x3C91A626, 0x33145C07)];
const AT = [
  fromWords(0x3FD55555, 0x5555550D), fromWords(0xBFC99999, 0x9998EBC4), fromWords(0x3FC24924, 0x920083FF), fromWords(0xBFBC71C6, 0xFE231671),
  fromWords(0x3FB745CD, 0xC54C206E), fromWords(0xBFB3B0F2, 0xAF749A6D), fromWords(0x3FB10D66, 0xA0D03D51), fromWords(0xBFADDE2D, 0x52DEFD9A),
  fromWords(0x3FA97B4B, 0x24760DEB), fromWords(0xBFA2B444, 0x2C6A6C2F), fromWords(0x3F90AD3A, 0xE322DA11)
];

function atan(x) {
  const hx = highWord(x), ix = hx & 0x7fffffff;
  let id;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lowWord(x) !== 0)) return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); }
      else { id = 1; x = (x - 1.0) / (x + 1.0); }
    } else {
      if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1.0 + 1.5 * x); }
      else { id = 3; x = -1.0 / x; }
    }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return hx < 0 ? -r : r;
}

// ---------- e_atan2.cpp ----------
const PI_O_4 = fromWords(0x3FE921FB, 0x54442D18), PI_O_2 = fromWords(0x3FF921FB, 0x54442D18);
const PI = fromWords(0x400921FB, 0x54442D18), PI_LO = fromWords(0x3CA1A626, 0x33145C07);

export function atan2(y, x) {
  if (x !== x || y !== y) return NaN;
  const hx = highWord(x), lx = lowWord(x), ix = hx & 0x7fffffff;
  const hy = highWord(y), ly = lowWord(y), iy = hy & 0x7fffffff;
  if (hx === 0x3ff00000 && lx === 0) return atan(y);
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);

  // When y = 0
  if ((iy | ly) === 0) {
    if (m < 2) return y;
    return m === 2 ? PI : -PI;
  }
  // When x = 0
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2;

  // When x is INF
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return [PI_O_4, -PI_O_4, 3.0 * PI_O_4, -3.0 * PI_O_4][m];
    return [0.0, -0.0, PI, -PI][m];
  }
  // When y is INF
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2;

  // Compute y/x
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) { z = PI_O_2 + 0.5 * PI_LO; m &= 1; }
  else if (hx < 0 && k < -60) z = 0.0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// ---------- e_acos.cpp ----------
const PIO2_HI = fromWords(0x3FF921FB, 0x54442D18), PIO2_LO = fromWords(0x3C91A626, 0x33145C07);
const PS0 = fromWords(0x3FC55555, 0x55555555), PS1 = fromWords(0xBFD4D612, 0x03EB6F7D), PS2 = fromWords(0x3FC9C155, 0x0E884455);
const PS3 = fromWords(0xBFA48228, 0xB5688F3B), PS4 = fromWords(0x3F49EFE0, 0x7501B288), PS5 = fromWords(0x3F023DE1, 0x0DFDF709);
const QS1 = fromWords(0xC0033A27, 0x1C8A2D4B), QS2 = fromWords(0x40002AE5, 0x9C598AC8), QS3 = fromWords(0xBFE6066C, 0x1B8D0159);
const QS4 = fromWords(0x3FB3B8C5, 0xB12E9282);

export function acos(x) {
  const hx = highWord(x), ix = hx & 0x7fffffff;
  let z, p, q, r, w, s;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lowWord(x)) === 0) return hx > 0 ? 0.0 : PI + 2.0 * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    z = x * x;
    p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    q = 1.0 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    r = p / q;
    return PIO2_HI - (x - (PIO2_LO - x * r));
  }
  if (hx < 0) {
    z = (1.0 + x) * 0.5;
    p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    q = 1.0 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    s = Math.sqrt(z);
    r = p / q;
    w = r * s - PIO2_LO;
    return PI - 2.0 * (s + w);
  }
  z = (1.0 - x) * 0.5;
  s = Math.sqrt(z);
  const df = fromWords(highWord(s), 0);
  const c = (z - df * df) / (s + df);
  p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
  q = 1.0 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
  r = p / q;
  w = r * s + c;
  return 2.0 * (df + w);
}
