import { Group } from 'three';
import { Constraint, World } from 'matter-js';
import { EntityFactory } from './entities/EntityFactory.js';
import { levels, themes } from '../js/Data.js';

class Level extends Group {
  constructor() {
    super();
    this.name = this.defaultName = 'My Level';
    this.theme = this.defaultTheme = 'classic';
    this.defaultBlockColor = null;
    this.entityFactory = new EntityFactory();
    this.publishedFileId = null; // Reserved for Steam itemIds
    this.zoom = undefined;
    this.disableManualCheckpointRespawn = false;
    this.levelUIText = '';
  }

  addObject(object) {
    // Prevent multiple player objects from being added to the level
    if (object.getClass() == 'player' && object !== app.player) return

    // Update body state (-1 == active physics)
    if (object.position.z == 0) {
      World.add(app.engine.world, object.body); // Add hitbox to world
      this.parent.add(object.helper);
    }
    
    // Add to group and compute world matrix once (scene.matrixWorldAutoUpdate is off)
    this.add(object);
    object.updateMatrixWorld();
    object.updateHelper();
  }

  removeObject(object, override = false) {
    // Prevent deleting the player
    if ((app.selectedObject != null && app.selectedObject.getClass() != 'player') || override == true) {
      if (object != undefined) {
        World.remove(app.engine.world, object.body);
        this.parent.remove(object.helper);
        this.remove(object);
        this.deselectLevel();
      }
    }
  }

  clearLevel() {
    var length = this.children.length;
    this.name = this.defaultName;
    this.theme = this.defaultTheme;
    this.defaultBlockColor = null;
    this.zoom = undefined;
    this.disableManualCheckpointRespawn = false;
    this.levelUIText = '';
    if (app.levelUIText) app.levelUIText.innerHTML = '';
    app.player.removeRope();
    // Clear the session-only "Set as start position" playtest override - never persisted, cleared on exit/level-switch.
    if (app.levelEditor) {
      app.levelEditor.tempSpawnPosition = null;
      app.levelEditor.tempSpawnRotation = null;
    }
    for (var i=0; i < length; i++) {
      var child = this.children[0];
      this.removeObject(child, true);
    }
  }

  // Attempts to link exactly one pair of blocks whose nearest ends coincide (within 1e-6, float-rounding
  // tolerance) - creates a Matter Constraint (added to app.engine.world) and returns { constraint, endIndexA,
  // endIndexB }, or null if no ends coincide. endIndexA/endIndexB is the index (0 or 1) into that block's own
  // getBlockEndCandidates().locals that was used for the link - i.e. which local end actually participated -
  // or null if that block has no real end-centres (squarish/anchor block, linked via its plain centre instead).
  // Purely transient: this is a one-time level-authoring aid (see LevelEditor.confirmChain), not a
  // persistent feature - the caller is responsible for removing the constraint once the settle simulation
  // it was created for is done, and for baking the settled result into the blocks' static positions.
  linkBlockPair(a, b) {
    // Matter's body is purely 2D (x/y/angle) - a tilted (x/y-rotated) block's local X/Y axes no longer match the
    // physics plane, so neither its end-centre math nor a 2D constraint can represent it correctly (same restriction as cut-out).
    if (a.rotation.x !== 0 || a.rotation.y !== 0 || b.rotation.x !== 0 || b.rotation.y !== 0) return null;

    // Only z==0 blocks are ever added to engine.world (see addObject/updateObjectPhysicsState) - a constraint
    // referencing a body that was never added to the world is never gravity/velocity-integrated by Engine.update,
    // so it would silently do nothing (same reason Player.addRope checks this before adding a rope joint).
    if (a.position.z !== 0 || b.position.z !== 0) return null;

    var endsA = app.util.getBlockEndCandidates(a), endsB = app.util.getBlockEndCandidates(b);
    var bestFa = -1, bestFb = -1, bestDist = 1e-6;
    for (var fa = 0; fa < endsA.points.length; fa++) {
      for (var fb = 0; fb < endsB.points.length; fb++) {
        var d = endsA.points[fa].distanceTo(endsB.points[fb]);
        if (d < bestDist) { bestDist = d; bestFa = fa; bestFb = fb; }
      }
    }
    if (bestFa === -1) return null; // no coincident ends between this pair

    // Matter rotates pointA/pointB by the body's angle DELTA since constraint creation, not its absolute angle
    // (see Constraint.solve) - so the offset must be the current WORLD end-centre relative to the body, not the
    // canonical unrotated local (which silently drops the block's own rotation at link time, if any, before settling).
    var worldA = endsA.points[bestFa], worldB = endsB.points[bestFb];
    var offsetA = { x: worldA.x - a.position.x, y: -(worldA.y - a.position.y) };
    var offsetB = { x: worldB.x - b.position.x, y: -(worldB.y - b.position.y) };

    // length is left unset so Matter derives it from the points' actual (near-zero) initial distance, same as
    // Rope.js's joints - avoids hardcoding a literal 0 target length that doesn't quite match the true (within-1e-6) initial gap.
    var constraint = Constraint.create({
      bodyA: a.body, bodyB: b.body,
      pointA: offsetA,
      pointB: offsetB,
      stiffness: 1
    });
    World.add(app.engine.world, constraint);
    return {
      constraint,
      endIndexA: endsA.locals.length > 1 ? bestFa : null,
      endIndexB: endsB.locals.length > 1 ? bestFb : null
    };
  }

  // Builds Matter constraints for every coincident-end pair found WITHIN candidates (the confirmed "P" chain
  // flow selection) - never scans the whole level. Returns { constraints, linkedEnds, linkPairs }: constraints is
  // the array of created constraints, for the caller (LevelEditor.confirmChain) to remove from the world again
  // once the one-time settle simulation they were created for finishes; linkedEnds is a Map from each
  // candidate block to a Set of its own local end indices (0 and/or 1, see getBlockEndCandidates) that
  // actually took part in a link - used by the baking step to know which of a block's ends (if any) need
  // shortening to remove the end-centre overlap at each joint (see LevelEditor.finishChainSettle); linkPairs is
  // the per-pair objA/objB/endIndexA/endIndexB detail behind linkedEnds, kept only for chain-bake debug logging.
  buildChainLinksForCandidates(candidates) {
    var constraints = [];
    var linkedEnds = new Map();
    var linkPairs = []; // per-pair objA/objB/endIndexA/endIndexB detail, kept only for chain-bake debug logging (see LevelEditor.logChainBakeDebugInfo)
    var addLinkedEnd = (obj, index) => {
      if (index == null) return;
      if (!linkedEnds.has(obj)) linkedEnds.set(obj, new Set());
      linkedEnds.get(obj).add(index);
    };

    for (var i = 0; i < candidates.length; i++) {
      for (var j = i + 1; j < candidates.length; j++) {
        var link = this.linkBlockPair(candidates[i], candidates[j]);
        if (link) {
          constraints.push(link.constraint);
          addLinkedEnd(candidates[i], link.endIndexA);
          addLinkedEnd(candidates[j], link.endIndexB);
          linkPairs.push({ objA: candidates[i].uuid, objB: candidates[j].uuid, endIndexA: link.endIndexA, endIndexB: link.endIndexB });
        }
      }
    }
    return { constraints, linkedEnds, linkPairs };
  }

  removeParticles() {
    var length = this.children.length;
    var index = length - 1;
    while (index >= 0) {
      var child = this.children[index];
      if (child.isParticle != null) this.removeObject(child, true);
      index--;
    }
  }

  refreshLevel() {
    // Useful for updating all static objects
    var levelData = this.exportToJSON();
    this.clearLevel();
    this.importFromJSON(levelData);
  }

  refreshObject(object) {
    this.removeObject(object); // Clear old object from world/engine
    var newObject = this.duplicateObject(object);
    return newObject;
  }

  changeObjectType(object, type) {
    var newObject = object; // Default as self
    if (object.getClass() != 'player') {
      object.body.class = type;
      newObject = this.refreshObject(object);
    }
    return newObject;
  }

  duplicateObject(object) {
    // Prevent duplicating the player object
    if (object.getClass() == 'player') return object;

    var objectData = object.toJSON();
    var newObject = this.entityFactory.createObject(objectData.class);
    this.setObjectProperties(newObject, objectData);
    this.addObject(newObject);
    return newObject;
  }

  createNewLevel() {
    // Reset player properties
    app.player.setPosition({ x: 0, y: 0, z: 0 });
    app.player.setScale({ x: 16, y: 16, z: 16 });
    app.player.setRotation(0);
    app.player.setFriction(0);

    // Prepare level with a single floor
    this.clearLevel();
    this.add(app.player); // Add player object
    var floor = this.entityFactory.createObject('cube', { x: 0, y: -64, z: 0 });
    floor.setScale({ x: 64, y: 16, z: 16 });
    floor.setStatic(true);
    this.add(floor);
  }

  deselectLevel() {
    app.selectedObject = null;
    for (var i=0; i < this.children.length; i++) {
      var child = this.children[i];
      if (child.body != null) {
        child.select(false);
      }
    }
  }

  exportToJSON() {
    var levelJSON = {};
    levelJSON.name = this.name;
    levelJSON.theme = this.theme;
    levelJSON.defaultBlockColor = this.defaultBlockColor;
    levelJSON.description = this.description;
    levelJSON.zoom = this.zoom;
    levelJSON.disableManualCheckpointRespawn = this.disableManualCheckpointRespawn;
    levelJSON.levelUIText = this.levelUIText;
    levelJSON.version = app.version;
    levelJSON.children = [];

    // Loop through group children
    for (var i = 0; i < this.children.length; i++) {
      var object = this.children[i];
      if (object.type == "Mesh") {
        var objectData = object.toJSON();
        levelJSON.children.push(objectData);
      }
    }

    return levelJSON;
  }

  saveLevelData() {
    this.key = app.storage.setLevelData(this.key, this.exportToJSON());
    return this.key;
  }

  importFromJSON(levelData) {
    this.name = levelData.name;
    this.theme = levelData.theme;
    this.defaultBlockColor = levelData.defaultBlockColor || null;
    this.description = levelData.description;
    this.zoom = levelData.zoom;
    this.disableManualCheckpointRespawn = levelData.disableManualCheckpointRespawn || false;
    this.levelUIText = levelData.levelUIText || '';
    if (app.levelUIText) app.levelUIText.innerHTML = this.levelUIText; // Intentional: allows HTML tags

    // Loop through JSON level data
    for (var i = 0; i < levelData.children.length; i++) {
      var settings = app.storage.getSettings();
      var objectData = levelData.children[i];
      var object = this.entityFactory.createObject(objectData.class);
      if (objectData.class == 'player') object = app.player;
      object.helper.visible = settings.debug;
      this.setObjectProperties(object, objectData);
      this.addObject(object);
    }
  }

  resetLevel() {
    // TEMPORARY determinism diagnostic - marks the start of a new attempt. Every restart path
    // (R key, automatic kill-restart, initial level entry) funnels through resetScene() -> here,
    // making this the single reliable "a new attempt just began" hook. See App.js's
    // detSyncAttempt/detCaptureTick. Remove this line alongside that diagnostic.
    window.__detAttempt = (window.__detAttempt == null) ? 0 : window.__detAttempt + 1;

    // Gets called every time the level starts (including checkpoints)
    for (var i = 0; i < this.children.length; i++) {
      var child = this.children[i];
      // A throw from any one child (ex: a bad resyncBodyGeometry() case) must not abort the loop -
      // every later child would silently stay un-reset (wrong position, stale velocity, etc), which is
      // far worse and harder to diagnose than one object being skipped. Log which one failed so it's
      // traceable from a single report instead of needing a repro round-trip.
      try {
        child.resetToOrigin();
        child.updateMatrixWorld();
        // Not every child has a helper (ex: Rope)
        if (child.updateHelper) child.updateHelper();
      } catch (e) {
        console.error('resetLevel(): failed to reset child', child.getClass ? child.getClass() : child, e);
      }
    }

    // Every body is now at its final post-reset position - prune any activeSensorPairs entries that
    // no longer correspond to genuine contact (see Collision.reconcileAfterReset for why this is
    // needed: a deterministic-mode reset can teleport a body away from a sensor it was touching,
    // without Matter ever getting the chance to fire a real collisionEnd for that pair).
    app.collision.reconcileAfterReset();

    app.player.jumpReady = true;
  }

  retryLevel(keepCheckpoint = false, respawnToTemp = true) {
    app.updateGravity();
    app.play = true;
    app.level.removeParticles();
    app.player.cancelRestart();

    // Reset impulses and collision-pair cache if deterministic mode enabled - retryLevel() is the
    // path the "R" key uses directly (PageCampaign.vue), bypassing Player.restart()/respawn() and
    // their existing resetDeterministicPhysics() call entirely. resetScene() below zeroes each body's
    // position/velocity via resetToOrigin(), but never touches positionImpulse/constraintImpulse or
    // Matter's pair cache (warm-started contact impulses), so without this, an "R" restart carries
    // that residual solver bias straight over from whatever happened before the restart.
    if (app.storage.getSettings().deterministic === true) {
      app.player.resetDeterministicPhysics();
    }

    app.resetScene();
    window.dispatchEvent(new CustomEvent('closePopup'));

    // Remove checkpoint, or respawn to checkpoint
    if (keepCheckpoint == false || app.player.checkpoint == null) {
      app.timer.reset();
      app.timer.start();
      app.player.removeCheckpoint();
      // resetScene() above reset the player to its real saved position - re-apply the level editor's
      // temp spawn override (if any) so "R" mid-playtest respects it too (see LevelEditor.applyTempSpawn).
      if (respawnToTemp && app.levelEditor) app.levelEditor.applyTempSpawn();
    }
    else app.player.respawn(true);
  }

  exitLevel() {
    app.timer.reset();
    app.player.removeCheckpoint();

    // Check current state
    if (app.state == 'campaign') {
      var settings = app.storage.getSettings();
      var progress = parseInt(settings.progress)
      progress++; // Increase level progress
      settings.progress = progress;
      app.updateSettings(settings);
      window.dispatchEvent(new CustomEvent('setPage', { detail: 'level-picker' }));
    }
    else if (app.state == 'level-editor') {
      app.updateGravity();
      app.resetScene();
      app.levelEditor.controlsOrbit.enabled = true;
      app.levelEditor.controlsOrbit.reset();
      app.background.visible = false;
    }

    // Dispatch event after exiting level
    window.dispatchEvent(new CustomEvent('exitLevel', { detail: app.state }));
  }

  setObjectProperties(object, objectData) {
    object.setPosition({ x: objectData.position.x, y: objectData.position.y, z: objectData.position.z });
    object.setScale({ x: objectData.scale.x, y: objectData.scale.y, z: objectData.scale.z });
    object.setRotation({ x: objectData.rotation.x, y: objectData.rotation.y, z: objectData.rotation.z });
    object.setStatic(objectData.isStatic);
    object.setText(objectData.text);
    object.setFriction(objectData.friction);
    object.setColors(objectData.color || app.level.entityFactory.color);
    object.setOpacity(objectData.opacity != null ? objectData.opacity : 1, true);
    if (objectData.isDeathBlock != null && object.getClass() === 'cube') object.setDeathBlock(objectData.isDeathBlock, true);
    if (objectData.resetConfig != null && object.getClass() === 'reset') object.setResetConfig(objectData.resetConfig, false);
  }

  showTip(text) {
    // Pause game
    app.play = false;
    app.timer.pause();

    // Dispatch new popup from event
    window.dispatchEvent(new CustomEvent('openPopup', {
      detail: {
        text: text,
        inputs: [{ type: 'button', value: 'popup.button.continue', callback: function() {
          app.resumeLevel();
        }}]
      }
    }));

    // Play tip sound
    app.assets.audio.play('tip');
  }

  showHelpers(visible = true) {
    this.traverse(function(obj) {
      if (obj.helper) obj.helper.visible = visible;
    });
  }

  updateHelpers() {
    this.children.forEach(function(child) {
      if (child.helper) child.updateHelper();
    })
  }

  getTheme(name) {
    // Return theme object by name
    return themes[name];
  }

  getPackTheme(title) {
    // Loop through levels json
    var theme;
    levels.packs.forEach(function(pack) {
      pack.levels.forEach(function(level) {
        // Assign theme using theme pack key
        if (title == level.title) theme = themes[pack.theme];
      })
    });
    return theme;
  }

  getDescriptionByTitle(title) {
    var description;
    levels.packs.forEach(function(pack) {
      pack.levels.forEach(function(level) {
        // Assign theme using theme pack key
        if (title == level.title) description = level.description;
      })
    });
    return description;
  }

  getAuthorByTitle(title) {
    var author;
    levels.packs.forEach(function(pack) {
      pack.levels.forEach(function(level) {
        // Assign theme using theme pack key
        if (title == level.title) author = level.author;
      })
    });
    return author;
  }

  isFromCommunityPack(title) {
    // Community levels live in the pack titled 'Level Packs' (see Data.js fetchLevelPacks)
    var communityPack = levels.packs.find(pack => pack.title === 'Level Packs');
    if (communityPack == null) return false;
    return communityPack.levels.some(level => level.title === title);
  }

  getLevelIndex(title) {
    var count = 0;
    var index = -1;
    
    // Loop through packs array
    levels.packs.forEach(function(pack) {
      // Loop through each levels array
      pack.levels.forEach(function(level) {
        // Set level index and increment count
        if (title == level.title) {
          index = count;
        }
        count++;
      });
    });
    return index;
  }
}

export { Level };