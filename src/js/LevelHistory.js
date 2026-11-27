const CHUNK_END_CHANCE = 1 / 64; // Chance an object ends a chunk, so chunks average 64 objects
const MAX_CHUNK_LENGTH = 1024;
const chunkEnds = new WeakMap(); // Object data -> whether it ends a chunk, fixed per data so inserts and deletes only change nearby chunks

// Deep equality of exported object data, signed zeros included
function isSameData(a, b) {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  var keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (var i = 0; i < keys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, keys[i]) || !isSameData(a[keys[i]], b[keys[i]])) return false;
  }
  return true;
}

function isChunkEnd(data) {
  var end = chunkEnds.get(data);
  if (end == null) chunkEnds.set(data, end = Math.random() < CHUNK_END_CHANCE);
  return end;
}

class LevelHistory {
  constructor() {
    this.clear(); // Initialize empty
  }

  save(description = "Edited level") {
    app.level.invalidateStatics(); // Every edit lands here, so blocks may have moved: rebuild culling grids and fully reset next time
    var previous = this.history[this.historyIndex];
    var level = app.level.exportToJSON(false); // Objects are stored as shared chunks below instead
    this.history.length = this.historyIndex + 1; // Alt splice
    this.history.push({
      'level': level,
      'chunks': this.getChunks(this.getLevelData(), previous),
      'description': description
    });
    this.historyIndex++;
  }

  clear() {
    this.history = [];
    this.historyIndex = 0;
  }

  undo() {
    if (this.historyIndex > 1) {
      this.historyIndex--;
      this.load(this.history[this.historyIndex]);
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.load(this.history[this.historyIndex]);
    }
  }

  // Exported data of an object, the same copy as last time when it hasn't changed, so entries share it
  getObjectData(object) {
    var data = object.toJSON();
    if (object.historyData != null && isSameData(object.historyData, data)) data = object.historyData;
    else object.historyData = data;
    if (object.sourceData != null && object.sourceData !== data && isSameData(object.sourceData, data)) object.sourceData = data; // Lets the loaded file's copy go
    return data;
  }

  // Exported data of every level object, in the order exportToJSON() lists them
  getLevelData() {
    return app.level.children.filter(object => object.type == "Mesh").map(object => this.getObjectData(object));
  }

  // Splits object data into chunks, reusing the previous entry's chunks that didn't change
  getChunks(objects, previous) {
    var oldChunks = new Map();
    if (previous != null) previous.chunks.forEach(chunk => oldChunks.set(chunk[0], chunk));
    var chunks = [];
    var start = 0;
    for (var i = 0; i < objects.length; i++) {
      if (isChunkEnd(objects[i]) || i - start + 1 >= MAX_CHUNK_LENGTH || i == objects.length - 1) {
        var old = oldChunks.get(objects[start]);
        var isSame = old != null && old.length == i - start + 1;
        for (var j = 0; isSame && j < old.length; j++) isSame = old[j] === objects[start + j];
        chunks.push(isSame ? old : objects.slice(start, i + 1));
        start = i + 1;
      }
    }
    return chunks;
  }

  // Loads an entry like clearLevel() then importFromJSON() would, but blocks identical to what that rebuild would make are kept
  load(entry) {
    var level = app.level;
    var reusable = new Map(); // Object data -> kept objects exported as it
    level.children.forEach(object => {
      if (object.type != "Mesh" || !level.isAsBuilt(object)) return; // Moving, edited or played-with blocks are rebuilt like before
      var data = this.getObjectData(object);
      if (!isSameData(object.sourceData, data)) return;
      if (!reusable.has(data)) reusable.set(data, []);
      reusable.get(data).push(object);
    });

    var objects = [];
    level.resetProperties();
    level.importProperties(entry.level);
    entry.chunks.forEach(chunk => chunk.forEach(data => {
      var matches = reusable.get(data);
      var object;
      if (matches != null && matches.length > 0) {
        object = matches.shift();
        level.renewBodyIds(object); // Ordered among the rebuilt ones as if it were rebuilt too
      }
      else object = level.createObjectFromJSON(data);
      object.historyData = data;
      var index = object === app.player ? objects.indexOf(object) : -1;
      if (index >= 0) objects.splice(index, 1); // A second player entry moves it, as add() does
      objects.push(object);
    }));
    level.setObjects(objects);
  }
}

export { LevelHistory };
