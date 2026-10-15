import { Capacitor } from '@capacitor/core';
import { Matrix4, Quaternion, Vector3 } from 'three';

// Shared across all Utility instances so the same asset is only ever fetched once
const _inlineSvgCache = {};

const _unitScale = new Vector3(1, 1, 1);
// Local (unrotated) half-scale offsets for the 8 corners, shared by vertex/end snapping and chain-link detection.
const _localCorners = [
  [-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1],
  [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1]
];

class Utility {
  constructor() {

  }

  // Every block's 8 corner vertices, plus its 0-or-2 "end centre" points, in both world space and the block's
  // own local (unrotated) frame - used for vertex/end snapping and chain-link detection. A block's 2D footprint
  // (its scale.x/scale.y only, ignoring depth) has a "width" (short side) and "length" (long side); if
  // length <= 2*width the block is squarish and has no end centres (see getBlockEndCandidates for the
  // single-centre fallback used then). Otherwise the two end centres lie on the length axis, each the
  // corresponding edge-midpoint moved inward by half the width.
  getBlockEndPoints(obj) {
    var hx = Math.abs(obj.scale.x) / 2, hy = Math.abs(obj.scale.y) / 2, hz = Math.abs(obj.scale.z) / 2;
    var m = new Matrix4().compose(obj.position, new Quaternion().setFromEuler(obj.rotation), _unitScale);
    var localVertices = _localCorners.map(l => ({ x: l[0] * hx, y: l[1] * hy, z: l[2] * hz }));
    var vertices = localVertices.map(l => new Vector3(l.x, l.y, l.z).applyMatrix4(m));

    var width = Math.min(Math.abs(obj.scale.x), Math.abs(obj.scale.y));
    var length = Math.max(Math.abs(obj.scale.x), Math.abs(obj.scale.y));
    var localEndCentres = [];
    if (length > 2 * width) {
      var d = length / 2 - width / 2;
      var lengthAxisIsX = Math.abs(obj.scale.x) >= Math.abs(obj.scale.y);
      localEndCentres = lengthAxisIsX ? [{ x: d, y: 0, z: 0 }, { x: -d, y: 0, z: 0 }] : [{ x: 0, y: d, z: 0 }, { x: 0, y: -d, z: 0 }];
    }
    var endCentres = localEndCentres.map(l => new Vector3(l.x, l.y, l.z).applyMatrix4(m));

    return { vertices, endCentres, localVertices, localEndCentres };
  }

  // Snap/chain-link candidates for a block's "ends": its 2 end-centres if it has any, else its own single
  // centre point as the fallback for squarish blocks - shared by vertex/end snapping (LevelEditor.js) and
  // chain-link detection (Level.js) so both apply the same fallback rule.
  getBlockEndCandidates(obj) {
    var points = this.getBlockEndPoints(obj);
    if (points.localEndCentres.length > 0) return { points: points.endCentres, locals: points.localEndCentres };
    return { points: [obj.position.clone()], locals: [{ x: 0, y: 0, z: 0 }] };
  }

  randomNumber(min, max) {
    return Math.random() * (max - min) + min;
  }

  // Hex colour between two hex colours at the given ratio (0 = hexA, 1 = hexB, 0.5 = midpoint), used for the
  // theme's dynamic icon highlight default and for deriving shaded/tinted variants of theme colours
  hexMidpoint(hexA, hexB, ratio = 0.5) {
    var a = parseInt(hexA.replace('#', ''), 16);
    var b = parseInt(hexB.replace('#', ''), 16);
    var r = Math.round((a >> 16 & 0xFF) + ((b >> 16 & 0xFF) - (a >> 16 & 0xFF)) * ratio);
    var g = Math.round((a >> 8 & 0xFF) + ((b >> 8 & 0xFF) - (a >> 8 & 0xFF)) * ratio);
    var bl = Math.round((a & 0xFF) + ((b & 0xFF) - (a & 0xFF)) * ratio);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  // Hex -> [h(0-360), s(0-100), l(0-100)]
  hexToHsl(hex) {
    var value = parseInt(hex.replace('#', ''), 16);
    var r = (value >> 16 & 0xFF) / 255, g = (value >> 8 & 0xFF) / 255, b = (value & 0xFF) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max == min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    return [h * 360, s * 100, l * 100];
  }

  // [h(0-360), s(0-100), l(0-100)] -> hex
  hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    var r, g, b;

    if (s == 0) { r = g = b = l; }
    else {
      var hue2rgb = function(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    var toHex = function(c) { return Math.round(c * 255).toString(16).padStart(2, '0'); };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  // Shifts a hex colour's hue/saturation/lightness by the given deltas (in HSL, not RGB) - used to derive
  // gradient/shade tones from a single base theme colour without the muddy-brown look that comes from
  // mixing toward black/white in RGB space
  shadeHex(hex, deltaH = 0, deltaS = 0, deltaL = 0) {
    var hsl = this.hexToHsl(hex);
    return this.hslToHex(hsl[0] + deltaH, hsl[1] + deltaS, hsl[2] + deltaL);
  }

  // Hex colour + 0-1 opacity to an rgba() string, for CSS variables that pre-composite colour and opacity
  hexToRgba(hex, alpha) {
    var value = parseInt(hex.replace('#', ''), 16);
    var r = value >> 16 & 0xFF, g = value >> 8 & 0xFF, b = value & 0xFF;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  
  getVectorFromAngle(angle = 0, decimal = 1) {
    var pi = Math.PI;
    var decimal = 1e3;
    var degrees = -angle * (180/pi);
    var x = Math.round(Math.cos((90 - degrees) * (pi / 180)) * decimal) / decimal;
    var y = Math.round(Math.sin((90 - degrees) * (pi / 180)) * decimal) / decimal;
    return { x: x, y: y };
  }
  
  getAngleFromVector(vector){
    var angle = Math.atan2(vector.y, vector.x);
    var degrees = 180*angle/Math.PI;  //degrees
    return this.degreesToRadians((360 + Math.round(degrees)) % 360);
  }
  
  radiansToDegrees(radians) {
    return radians * (180 / Math.PI);
  }
  
  degreesToRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
  
  isJSON(str) {
    try { JSON.parse(str); }
    catch (e) { return false; }
    return true;
  }

  isExtension() {
    return window.chrome?.extension != undefined;
  }

  isDesktopApp() {
    return window.desktop != null;
  }

  isNativeApp() {
    return Capacitor.isNativePlatform();
  }

  isFullscreen() {
    return document.fullscreenElement != null;
  }

  // Fetches an svg's raw markup for inline (v-html) embedding, so CSS custom properties inside it can pick up
  // theme colours - a plain <img>/background-image url() can't see the host page's CSS variables
  async getInlineSvg(url) {
    if (_inlineSvgCache[url] == null) {
      _inlineSvgCache[url] = fetch(url).then(function(response) { return response.text(); });
    }
    return _inlineSvgCache[url];
  }

  openLink(url, target = '_blank') {
    if (window.chrome?.tabs) window.chrome.tabs.create({ url: url });
    else if (window.desktop?.openExternal && target === '_blank') window.desktop.openExternal(url);
    else window.open(url, target);
  }
}

export { Utility };