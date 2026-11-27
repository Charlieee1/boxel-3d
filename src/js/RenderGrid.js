import { Box3, Frustum, Matrix4, Vector3 } from 'three';

// Game-level render cull: while playing, only statics in cells the camera sees (by world box, so scale and rotation count) and moving objects are drawn

const CELL_SIZE = 256;
const MAX_CELLS_PER_OBJECT = 64; // Bigger objects are tested on their own instead of filling many cells
const LAYER_DEPTHS = [64, 256, 1024, 4096, 16384]; // Distance from z=0 where each depth layer starts, so far background blocks don't share cells with the play area

const _matrix = new Matrix4();
const _frustum = new Frustum();
const _box = new Box3();
const _near = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const _far = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const _ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function cellKey(x, y) {
  return x * 2097152 + y; // Unique for any cell index under a million
}

// Depth layer of a z position, negative behind z=0
function getLayerIndex(z) {
  var depth = Math.abs(z), index = 0;
  while (index < LAYER_DEPTHS.length && depth >= LAYER_DEPTHS[index]) index++;
  return z < 0 ? -index : index;
}

class RenderGrid {
  constructor(level) {
    this.level = level;
    this.enabled = true;
    this.builtVersion = null;
    this.layers = new Map(); // layer index -> { cellSize, zMin, zMax, cells: key -> { box, objects } }
    this.largeObjects = []; // { object, box }
    this.unboxed = []; // Objects without geometry bounds, always drawn
    this.frame = 0;
    this.savedChildren = null;
    this.savedHelpers = null;
  }

  build() {
    var level = this.level;
    this.layers = new Map();
    this.largeObjects = [];
    this.unboxed = [];
    for (var i = 0; i < level.children.length; i++) {
      var object = level.children[i];
      if (!level.isStaticChild(object)) continue;
      _box.setFromObject(object);
      var isNeverCulled = object.getObjectByProperty('frustumCulled', false) != null; // Animated models move past their bounds
      if (_box.isEmpty() || isNeverCulled) {
        this.unboxed.push(object);
        continue;
      }
      var layer0 = getLayerIndex(_box.min.z), layer1 = getLayerIndex(_box.max.z);
      for (var l = layer0; l <= layer1; l++) {
        if (this.addToLayer(l, object) == false) {
          this.largeObjects.push({ object: object, box: _box.clone() });
          break;
        }
      }
    }
    this.builtVersion = level.staticVersion;
  }

  // Puts the object (bounds in _box) in a layer's cells, false when it's too big for them
  addToLayer(index, object) {
    var layer = this.layers.get(index);
    if (layer == null) {
      var depth = LAYER_DEPTHS[Math.abs(index) - 1] || 0;
      this.layers.set(index, layer = { cellSize: Math.max(CELL_SIZE, depth), zMin: Infinity, zMax: -Infinity, cells: new Map() });
    }
    var size = layer.cellSize;
    var x0 = Math.floor(_box.min.x / size), x1 = Math.floor(_box.max.x / size);
    var y0 = Math.floor(_box.min.y / size), y1 = Math.floor(_box.max.y / size);
    var count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (!(count > 0) || count > MAX_CELLS_PER_OBJECT) return false;
    layer.zMin = Math.min(layer.zMin, _box.min.z);
    layer.zMax = Math.max(layer.zMax, _box.max.z);
    for (var x = x0; x <= x1; x++) {
      for (var y = y0; y <= y1; y++) {
        var key = cellKey(x, y);
        var cell = layer.cells.get(key);
        if (cell == null) layer.cells.set(key, cell = { box: new Box3(), objects: [] });
        cell.box.union(_box);
        cell.objects.push(object);
      }
    }
    return true;
  }

  // World x/y range the camera can see between two depths
  getVisibleRange(camera, zMin, zMax) {
    for (var i = 0; i < 4; i++) {
      _near[i].set(_ndc[i][0], _ndc[i][1], -1).unproject(camera);
      _far[i].set(_ndc[i][0], _ndc[i][1], 1).unproject(camera);
    }
    var range = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    var addPoint = function(x, y) {
      if (x < range.minX) range.minX = x;
      if (x > range.maxX) range.maxX = x;
      if (y < range.minY) range.minY = y;
      if (y > range.maxY) range.maxY = y;
    };
    var addEdge = function(p, q) {
      [zMin, zMax].forEach(function(z) {
        if ((p.z - z) * (q.z - z) <= 0 && p.z !== q.z) {
          var t = (z - p.z) / (q.z - p.z);
          addPoint(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
        }
      });
      if (p.z >= zMin && p.z <= zMax) addPoint(p.x, p.y);
    };
    for (var j = 0; j < 4; j++) {
      addEdge(_near[j], _near[(j + 1) % 4]);
      addEdge(_far[j], _far[(j + 1) % 4]);
      addEdge(_near[j], _far[j]);
    }
    return range;
  }

  // Swaps the level's children for only what the camera can see, until end() restores them
  begin(camera) {
    this.end(); // A render that threw never restored the lists
    var level = this.level;
    if (this.enabled == false) return;
    if (this.builtVersion !== level.staticVersion) this.build();

    var frame = ++this.frame;
    var visible = [];
    var add = function(object) {
      if (object._renderFrame !== frame) {
        object._renderFrame = frame;
        visible.push(object);
      }
    };
    _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_matrix);

    var visitCell = function(cell) {
      if (cell != null && _frustum.intersectsBox(cell.box)) cell.objects.forEach(add);
    };
    this.layers.forEach(layer => {
      var range = this.getVisibleRange(camera, layer.zMin, layer.zMax);
      if (!(range.minX <= range.maxX)) return; // Nothing at this depth is in view
      var size = layer.cellSize;
      var x0 = Math.floor(range.minX / size), x1 = Math.floor(range.maxX / size);
      var y0 = Math.floor(range.minY / size), y1 = Math.floor(range.maxY / size);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= layer.cells.size) {
        for (var x = x0; x <= x1; x++) {
          for (var y = y0; y <= y1; y++) visitCell(layer.cells.get(cellKey(x, y)));
        }
      }
      else layer.cells.forEach(visitCell); // Viewing the level edge-on, fewer cells exist than the range covers
    });
    this.largeObjects.forEach(function(entry) {
      if (_frustum.intersectsBox(entry.box)) add(entry.object);
    });
    this.unboxed.forEach(add);
    level.getDynamicObjects().forEach(add);

    this.savedChildren = level.children;
    level.children = visible;

    // Only the visible objects' hitbox helpers, while hitboxes are shown at all
    var helpers = level.helpers;
    if (helpers.visible === true) {
      this.savedHelpers = helpers.children;
      helpers.children = visible.filter(object => object.helper != null && object.helper.parent === helpers).map(object => object.helper);
    }
  }

  end() {
    if (this.savedChildren != null) {
      this.level.children = this.savedChildren;
      this.savedChildren = null;
    }
    if (this.savedHelpers != null) {
      this.level.helpers.children = this.savedHelpers;
      this.savedHelpers = null;
    }
  }
}

export { RenderGrid };
