import { Capacitor } from '@capacitor/core';
import { Matrix4, Quaternion, Vector3 } from 'three';

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

  openLink(url, target = '_blank') {
    if (window.chrome?.tabs) window.chrome.tabs.create({ url: url });
    else if (window.desktop?.openExternal && target === '_blank') window.desktop.openExternal(url);
    else window.open(url, target);
  }
}

export { Utility };