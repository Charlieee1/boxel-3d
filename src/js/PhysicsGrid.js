import { Composite, Detector, Events } from 'matter-js';

// Game-level cull: Matter only handles moving bodies and nearby statics, kept in the exact order a full list would have so collisions are identical

const CELL_SIZE = 64;
const MAX_CELLS_PER_BODY = 256; // Bigger static bodies are always kept instead of filling many cells

function cellKey(x, y) {
  return x * 2097152 + y; // Unique for any cell index under a million
}

class PhysicsGrid {
  constructor(engine) {
    this.engine = engine;
    this.enabled = true;
    this.buildId = 0;
    this.staticCount = -1; // Static bodies the cells were built from
    this.cells = new Map();
    this.alwaysStatics = []; // Static bodies too big (or invalid) for cells
    this.dynamics = []; // Every non-static body, always in the list
    this.list = null; // The detector list this grid last prepared
    this.stamp = 0;
    this.allBodies = null; // Full body list the moving list below was taken from
    this.movingBodies = [];

    // Every per-body loop in Engine.update skips static bodies or rewrites values they already hold, so it only gets the moving ones
    Events.on(engine, 'beforeUpdate', () => this.beforeUpdate());
    Events.on(engine, 'afterUpdate', () => this.afterUpdate());

    // Engine.update sets detector.pairs right before Detector.collisions reads and sorts detector.bodies, after bodies moved
    var detector = engine.detector;
    var pairs = detector.pairs;
    var grid = this;
    Object.defineProperty(detector, 'pairs', {
      configurable: true,
      get: function() { return pairs; },
      set: function(value) {
        pairs = value;
        if (value != null) grid.beforeDetect();
      }
    });
  }

  // Rebuilds from every body in the world, for when static bodies changed in the middle of a run (editor edits while paused)
  refresh() {
    Detector.setBodies(this.engine.detector, Composite.allBodies(this.engine.world));
  }

  beforeUpdate() {
    var world = this.engine.world;
    var detector = this.engine.detector;
    if (this.enabled == false || world.cache == null) return;

    // Same refresh Engine.update does next, done here while the world cache still lists every body
    if (world.isModified) {
      Detector.setBodies(detector, Composite.allBodies(world));
      Composite.setModified(world, false, false, true);
    }

    // A replaced detector list means bodies were added, removed or reset (static flags included), so retake the moving ones
    var allBodies = Composite.allBodies(world);
    if (allBodies !== this.allBodies || detector.bodies !== this.list) {
      this.allBodies = allBodies;
      this.movingBodies = allBodies.filter(body => body.isStatic !== true);
    }
    world.cache.allBodies = this.movingBodies;
  }

  afterUpdate() {
    var world = this.engine.world;
    if (world.cache != null && world.cache.allBodies === this.movingBodies) world.cache.allBodies = this.allBodies; // Everything else still sees every body
  }

  beforeDetect() {
    var detector = this.engine.detector;
    if (this.enabled == false) {
      if (this.list != null && detector.bodies === this.list) Detector.setBodies(detector, Composite.allBodies(this.engine.world)); // Back to every body
      this.list = null;
      return;
    }

    // A new list from Detector.setBodies: its order is the previous order every tie is resolved against
    var isFresh = detector.bodies !== this.list;
    if (isFresh) this.wrap(detector.bodies);
    this.cull(this.list, isFresh);
  }

  wrap(bodies) {
    var staticCount = 0;
    var isUnknown = false; // A static body the cells have never seen (added since they were built)
    var moved = []; // Registered static bodies whose bounds changed (resets can nudge them slightly)
    this.dynamics = [];
    for (var i = 0; i < bodies.length; i++) {
      var body = bodies[i];
      body._cullIndex = i;
      body._cullIn = true; // Everything is in a fresh list until cull() drops it
      if (body.isStatic !== true) {
        body._cullLastKey = undefined; // Key history starts over with the new order
        this.dynamics.push(body);
      }
      else {
        staticCount++;
        var b = body.bounds, built = body._cullBounds;
        if (body._cullBuild !== this.buildId) isUnknown = true;
        else if (built[0] !== b.min.x || built[1] !== b.min.y || built[2] !== b.max.x || built[3] !== b.max.y) moved.push(body);
      }
    }
    if (isUnknown || staticCount !== this.staticCount || moved.length > staticCount / 4) this.buildCells(bodies);
    else moved.forEach(body => { this.removeFromCells(body); this.addToCells(body); });
    this.list = bodies;
  }

  buildCells(bodies) {
    this.cells = new Map();
    this.alwaysStatics = [];
    this.buildId++;
    this.staticCount = 0;
    for (var i = 0; i < bodies.length; i++) {
      if (bodies[i].isStatic !== true) continue;
      this.addToCells(bodies[i]);
      this.staticCount++;
    }
  }

  // Cell range of bounds, or null when too big (or invalid) for cells
  getCellRange(minX, minY, maxX, maxY) {
    var x0 = Math.floor(minX / CELL_SIZE), x1 = Math.floor(maxX / CELL_SIZE);
    var y0 = Math.floor(minY / CELL_SIZE), y1 = Math.floor(maxY / CELL_SIZE);
    var count = (x1 - x0 + 1) * (y1 - y0 + 1);
    return (count > 0 && count <= MAX_CELLS_PER_BODY) ? [x0, y0, x1, y1] : null;
  }

  addToCells(body) {
    var bounds = body.bounds;
    body._cullBuild = this.buildId;
    body._cullBounds = [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y];
    var range = this.getCellRange(bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
    if (range == null) {
      this.alwaysStatics.push(body);
      return;
    }
    for (var x = range[0]; x <= range[2]; x++) {
      for (var y = range[1]; y <= range[3]; y++) {
        var key = cellKey(x, y);
        var cell = this.cells.get(key);
        if (cell == null) this.cells.set(key, cell = []);
        cell.push(body);
      }
    }
  }

  // Unregisters a body from the cells its last registered bounds covered
  removeFromCells(body) {
    var built = body._cullBounds;
    var range = this.getCellRange(built[0], built[1], built[2], built[3]);
    var remove = function(list) {
      var index = list.indexOf(body);
      if (index >= 0) list.splice(index, 1);
    };
    if (range == null) return remove(this.alwaysStatics);
    for (var x = range[0]; x <= range[2]; x++) {
      for (var y = range[1]; y <= range[3]; y++) {
        var cell = this.cells.get(cellKey(x, y));
        if (cell != null) remove(cell);
      }
    }
  }

  // Static bodies in the cells around every moving body, a superset of everything they can touch this tick
  markNearbyStatics() {
    var stamp = ++this.stamp;
    var nearby = [];
    var add = function(body) {
      if (body._cullStamp !== stamp) {
        body._cullStamp = stamp;
        nearby.push(body);
      }
    };
    this.alwaysStatics.forEach(add);
    for (var i = 0; i < this.dynamics.length; i++) {
      var bounds = this.dynamics[i].bounds;
      var x0 = Math.floor(bounds.min.x / CELL_SIZE) - 1, x1 = Math.floor(bounds.max.x / CELL_SIZE) + 1;
      var y0 = Math.floor(bounds.min.y / CELL_SIZE) - 1, y1 = Math.floor(bounds.max.y / CELL_SIZE) + 1;
      if (!((x1 - x0 + 1) * (y1 - y0 + 1) <= this.cells.size)) {
        this.cells.forEach(cell => cell.forEach(add)); // Huge or invalid bounds, keep every static body
        continue;
      }
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          var cell = this.cells.get(cellKey(x, y));
          if (cell != null) cell.forEach(add);
        }
      }
    }
    return nearby;
  }

  cull(list, isFresh) {
    var nearby = this.markNearbyStatics();
    var stamp = this.stamp;

    // Keep moving bodies and nearby statics, in their previous order
    var kept = [];
    for (var i = 0; i < list.length; i++) {
      var body = list[i];
      if (body.isStatic !== true || body._cullStamp === stamp) kept.push(body);
      else body._cullIn = false;
    }

    // Statics entering the list, merged in where the full previous order had them (a fresh list already has them all)
    var entering = [];
    if (isFresh == false) {
      for (var j = 0; j < nearby.length; j++) {
        if (nearby[j]._cullIn !== true) entering.push(nearby[j]);
      }
    }
    var merged = kept;
    if (entering.length > 0) {
      entering.sort((a, b) => (a.bounds.min.x - b.bounds.min.x) || (a._cullIndex - b._cullIndex));
      merged = [];
      var k = 0, e = 0;
      while (k < kept.length && e < entering.length) {
        if (this.isBefore(entering[e], kept[k])) merged.push(entering[e++]);
        else merged.push(kept[k++]);
      }
      while (k < kept.length) merged.push(kept[k++]);
      while (e < entering.length) merged.push(entering[e++]);
    }

    list.length = merged.length;
    for (var m = 0; m < merged.length; m++) {
      list[m] = merged[m];
      list[m]._cullIn = true;
    }
    this.recordKeys();
  }

  // Whether static body a came before body b in the full list's previous order
  isBefore(a, b) {
    var key = a.bounds.min.x;
    if (b.isStatic === true) {
      var diff = key - b.bounds.min.x; // Static keys never change, so their order is fixed by key then original index
      return diff < 0 || (diff === 0 && a._cullIndex < b._cullIndex);
    }

    // Moving body: compared by its key at the previous sort, exact ties by the side it came from
    var diffMoving = key - b._cullLastKey;
    if (diffMoving < 0) return true;
    if (diffMoving > 0) return false;
    if (b._cullHasPrev === true) return b._cullPrevKey > key;
    return a._cullIndex < b._cullIndex; // Same key ever since the list was rebuilt
  }

  // Each moving body's key for the sort about to run, and the different key before it (the history ties depend on)
  recordKeys() {
    for (var i = 0; i < this.dynamics.length; i++) {
      var body = this.dynamics[i];
      var key = body.bounds.min.x;
      if (body._cullLastKey === undefined) body._cullHasPrev = false;
      else if (key !== body._cullLastKey) {
        body._cullPrevKey = body._cullLastKey;
        body._cullHasPrev = true;
      }
      body._cullLastKey = key;
    }
  }
}

export { PhysicsGrid };
