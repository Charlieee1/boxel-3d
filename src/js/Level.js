import { Group } from 'three';
import { Composite, Constraint, World } from 'matter-js';
import { EntityFactory } from './entities/EntityFactory.js';
import { levels, themes } from '../js/Data.js';
import { convertLevel } from './LevelCompatibility.js';

// Every number a reset can rewrite on a body and its parts, to tell whether a reset changed anything
function getBodyState(body) {
  var state = [body.positionPrev.x, body.positionPrev.y, body.anglePrev, body.velocity.x, body.velocity.y, body.speed, body.angularVelocity, body.angularSpeed, body.circleRadius];
  for (var i = 0; i < body.parts.length; i++) {
    var part = body.parts[i];
    state.push(part.position.x, part.position.y, part.angle, part.area, part.mass, part.inverseMass, part.density, part.inertia, part.inverseInertia);
    state.push(part.bounds.min.x, part.bounds.min.y, part.bounds.max.x, part.bounds.max.y);
    for (var j = 0; j < part.vertices.length; j++) state.push(part.vertices[j].x, part.vertices[j].y);
    for (var k = 0; k < part.axes.length; k++) state.push(part.axes[k].x, part.axes[k].y);
  }
  return state;
}

function isSameBodyState(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false; // Signed zeros count as different, to stay exact
  }
  return true;
}

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
    this.author = ''; // Overrides the level pack's author when set
    this.isLevel = true;
    this.helpers = new Group(); // Hitbox helpers of z=0 blocks, added to the scene next to the level
    this.helpers.visible = false;
    this.dynamicObjects = []; // Children that can move (or have no body), always reset and updated
    this.dynamicObjectsDirty = true;
    this.modifiedObjects = new Set(); // Static objects changed during play, the only statics a minimal reset touches
    this.driftingObjects = new Set(); // Static objects a non-deterministic reset still changes (see resetLevel)
    this.resetMode = null; // Deterministic setting of the last reset
    this.needsFullReset = true; // Next reset touches every child (level loaded or edited)
    this.staticVersion = 0; // Bumped whenever static objects are added, removed, moved or edited
    this.addEventListener('childadded', e => this.onChildAdded(e.child));
    this.addEventListener('childremoved', e => this.onChildRemoved(e.child));
  }

  // Static at its origin, so it only moves if gameplay changes it (and marks it modified)
  isStaticChild(child) {
    if (child.body == null) return false;
    return (child.isStaticOrigin != null ? child.isStaticOrigin : child.body.isStatic) === true;
  }

  onChildAdded(child) {
    if (this.isStaticChild(child)) this.invalidateStatics();
    else if (this.dynamicObjectsDirty == false) this.dynamicObjects.push(child);
  }

  onChildRemoved(child) {
    this.modifiedObjects.delete(child);
    this.driftingObjects.delete(child);
    if (this.isStaticChild(child)) this.invalidateStatics();
    else if (this.dynamicObjectsDirty == false) {
      var index = this.dynamicObjects.indexOf(child);
      if (index >= 0) this.dynamicObjects.splice(index, 1);
    }
  }

  // Static objects changed outside of gameplay (load, editor), so rebuild lists, grids and do a full reset
  invalidateStatics() {
    this.staticVersion++;
    this.dynamicObjectsDirty = true;
    this.needsFullReset = true;
  }

  // A static object was changed by gameplay, so the next reset has to restore it
  markModified(object) {
    if (this.isResetting !== true && object.parent === this && this.isStaticChild(object)) this.modifiedObjects.add(object);
  }

  getDynamicObjects() {
    if (this.dynamicObjectsDirty == true) {
      this.dynamicObjects = this.children.filter(child => !this.isStaticChild(child));
      this.dynamicObjectsDirty = false;
    }
    return this.dynamicObjects;
  }

  addObject(object) {
    // Prevent multiple player objects from being added to the level
    if (object.getClass() == 'player' && object !== app.player) return

    // Update body state (-1 == active physics)
    if (object.position.z == 0) {
      World.add(app.engine.world, object.body); // Add hitbox to world
      this.helpers.add(object.helper);
    }

    // Add to group and compute world matrix once (scene.matrixWorldAutoUpdate is off)
    this.add(object);
    object.updateMatrixWorld();
    var hitboxes = app.storage.readSettings().invalidatingSettings.hitboxes === true;
    object.helper.visible = hitboxes; // New blocks follow debug mode
    this.helpers.visible = hitboxes;
    object.updateHelper();
  }

  removeObject(object, override = false, deselect = true) {
    // Prevent deleting the player
    if ((app.selectedObject != null && app.selectedObject.getClass() != 'player') || override == true) {
      if (object != undefined) {
        World.remove(app.engine.world, object.body);
        if (object.helper) object.helper.removeFromParent();
        this.remove(object);
        if (object !== app.player) this.disposeObject(object);
        if (deselect == true) this.deselectLevel();
      }
    }
  }

  // Frees GPU memory the object created itself, model geometry and materials shared between blocks are kept
  disposeObject(object) {
    var dispose = function(node) {
      if (node.geometry) node.geometry.dispose();
      if (node.material) node.material.dispose();
    };
    if (object.shapes) object.shapes.children.forEach(dispose);
    if (object.helper) object.helper.traverse(dispose);
    object.traverse(function(node) {
      if (node.userData.opacityMaterialCloned === true) node.material.dispose(); // Per-block copy made by setOpacity()
    });
    dispose(object);
  }

  clearLevel() {
    this.name = this.defaultName;
    this.theme = this.defaultTheme;
    this.defaultBlockColor = null;
    this.zoom = undefined;
    this.disableManualCheckpointRespawn = false;
    this.levelUIText = '';
    this.author = '';
    if (app.levelUIText) app.levelUIText.innerHTML = '';
    app.player.removeRope();
    // Clear the session-only "Set as start position" playtest override - never persisted, cleared on exit/level-switch.
    if (app.levelEditor) {
      app.levelEditor.tempSpawnPosition = null;
      app.levelEditor.tempSpawnRotation = null;
    }
    this.removeAllObjects();
    this.deselectLevel();
  }

  // Same as removeObject() on every child, in one pass (removing one at a time shifts whole arrays each time, quadratic on big levels)
  removeAllObjects() {
    var children = this.children.slice();
    var bodies = new Set();
    children.forEach(child => { if (child.body) bodies.add(child.body); });
    var world = app.engine.world;
    world.bodies = world.bodies.filter(body => !bodies.has(body)); // Bodies added by anything else (mods) stay
    Composite.setModified(world, true, true, false);

    var detach = function(parent, child) {
      child.parent = null;
      child.dispatchEvent({ type: 'removed' });
      parent.dispatchEvent({ type: 'childremoved', child: child });
    };
    var helpers = this.helpers.children.slice();
    this.helpers.children.length = 0;
    helpers.forEach(helper => detach(this.helpers, helper));
    this.children.length = 0;
    children.forEach(child => {
      detach(this, child);
      if (child !== app.player) this.disposeObject(child);
    });
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
    // Particles are always dynamic, so only the dynamic list needs searching
    var particles = this.getDynamicObjects().filter(child => child.isParticle != null);
    particles.forEach(particle => this.removeObject(particle, true, false));
    var hasSelection = app.selectedObject != null || this.children.some(child => child.selected === true);
    if (particles.length > 0 && hasSelection) this.deselectLevel(); // Once, and only if something is selected
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
      // Untouched blocks already have their original look, so skip them (this runs on many editor clicks)
      if (child.body != null && (child.selected === true || child.hasTemporaryLook === true)) {
        child.select(false);
      }
    }
  }

  exportToJSON() {
    var levelJSON = {};
    levelJSON.name = this.name;
    levelJSON.version = app.version;
    levelJSON.properties = {
      theme: this.theme,
      defaultBlockColor: this.defaultBlockColor,
      description: this.description,
      zoom: this.zoom,
      disableManualCheckpointRespawn: this.disableManualCheckpointRespawn,
      levelUIText: this.levelUIText,
      author: this.author
    };
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
    var properties = convertLevel(levelData).properties; // Old level formats can reach here from mods and history
    this.name = levelData.name;
    this.theme = properties.theme || this.defaultTheme;
    this.defaultBlockColor = properties.defaultBlockColor || null;
    this.description = properties.description;
    this.zoom = properties.zoom;
    this.disableManualCheckpointRespawn = properties.disableManualCheckpointRespawn || false;
    this.levelUIText = properties.levelUIText || '';
    this.author = properties.author || '';
    if (app.levelUIText) app.levelUIText.innerHTML = this.levelUIText; // Intentional: allows HTML tags

    // Loop through JSON level data
    for (var i = 0; i < levelData.children.length; i++) {
      var settings = app.storage.readSettings();
      var objectData = levelData.children[i];
      var object = this.entityFactory.createObject(objectData.class);
      if (objectData.class == 'player') {
        object = app.player;
        if (settings.invalidatingSettings.deterministic === true) object.restoreConstructedBody();
      }
      object.helper.visible = settings.invalidatingSettings.hitboxes;
      this.setObjectProperties(object, objectData);
      this.addObject(object);
    }
  }

  // Static objects changed since the last reset, then everything that moves (the player last, so its mode event wins)
  getMinimalResetObjects(isDeterministic) {
    var statics = new Set(this.modifiedObjects);
    if (!isDeterministic) this.driftingObjects.forEach(object => statics.add(object)); // Old resets still nudge these, so keep applying them
    var objects = Array.from(statics);
    var dynamics = this.getDynamicObjects();
    for (var i = 0; i < dynamics.length; i++) {
      if (dynamics[i] !== app.player) objects.push(dynamics[i]);
    }
    if (app.player.parent === this) objects.push(app.player);
    return objects;
  }

  resetLevel() {
    // Reset counter read by tools/determinism-test to split recordings into attempts
    window.__detAttempt = (window.__detAttempt == null) ? 0 : window.__detAttempt + 1;

    // Gets called every time the level starts (including checkpoints), only moving and changed objects need it once the level has been fully reset
    var isDeterministic = app.storage.readSettings().invalidatingSettings.deterministic === true;
    if (this.resetMode !== isDeterministic) this.needsFullReset = true; // Drift tracking only holds for the mode it was measured in
    var isFullReset = this.needsFullReset;
    var resetObjects = isFullReset ? this.children.slice() : this.getMinimalResetObjects(isDeterministic);
    if (isFullReset) this.driftingObjects.clear();
    this.isResetting = true; // Restoring origins isn't a gameplay change
    for (var i = 0; i < resetObjects.length; i++) {
      var child = resetObjects[i];
      var before = (!isDeterministic && this.isStaticChild(child)) ? getBodyState(child.body) : null;
      // A throw from any one child (ex: a bad resyncBodyGeometry() case) must not abort the loop -
      // every later child would silently stay un-reset (wrong position, stale velocity, etc), which is
      // far worse and harder to diagnose than one object being skipped. Log which one failed so it's
      // traceable from a single report instead of needing a repro round-trip.
      try {
        child.resetToOrigin();
        child.updateMatrixWorld();
        // Not every child has a helper (ex: Rope)
        if (child.updateHelper) child.updateHelper();

        // Non-deterministic resets re-scale static bodies, which nudges some for a while: keep resetting those until a reset changes nothing
        if (before != null) {
          if (isSameBodyState(before, getBodyState(child.body))) this.driftingObjects.delete(child);
          else this.driftingObjects.add(child);
        }
      } catch (e) {
        console.error('resetLevel(): failed to reset child', child.getClass ? child.getClass() : child, e);
      }
    }
    this.isResetting = false;
    this.modifiedObjects.clear(); // Everything is back at its origin
    this.needsFullReset = false;
    this.resetMode = isDeterministic;

    // Every body is now at its final post-reset position - prune any activeSensorPairs entries that
    // no longer correspond to genuine contact (see Collision.reconcileAfterReset for why this is
    // needed: a deterministic-mode reset can teleport a body away from a sensor it was touching,
    // without Matter ever getting the chance to fire a real collisionEnd for that pair).
    app.collision.reconcileAfterReset();

    // A jump made just before this reset still launches the player, so don't also hand out a fresh one
    if (app.player.jumpPending !== true) app.player.jumpReady = true;
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
    if (app.storage.readSettings().invalidatingSettings.deterministic === true) {
      app.player.resetDeterministicPhysics();
    }

    var jumpReady = app.player.jumpReady; // resetScene() refreshes the jump, which checkpoint respawns don't get
    app.resetScene(false); // Rendered once at the end instead, at the real spawn point
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
    else {
      app.player.jumpReady = jumpReady;
      app.player.respawn(true);
    }

    // The one render of this reset, at the real respawn point
    app.updateRender({ delta: 0, alpha: 0 });
  }

  exitLevel() {
    app.timer.reset();
    app.player.cancelRestart(); // A pending death respawn must not fire after leaving
    app.player.removeCheckpoint();

    // Check current state
    if (app.state == 'campaign') {
      var settings = app.storage.getSettings();
      var progress = parseInt(settings.selectedLevel)
      progress++; // Increase level progress
      settings.selectedLevel = progress;
      app.level.clearLevel(); // Clear the level's zoom (and lock) before settings re-apply the camera zoom
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
        class: 'textbox',
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
    this.helpers.visible = visible; // Skips the whole group while hitboxes are off

    // Hidden helpers aren't kept in place, so reposition them and redraw now (the loop doesn't render while paused)
    this.updateHelpers();
    app.graphics.render();
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

  getPackTheme(title, target = null) {
    // Loop through levels json
    var theme;
    levels.packs.forEach(function(pack) {
      pack.levels.forEach(function(level) {
        // Assign theme using theme pack key
        if (target != null ? level === target : title == level.title) theme = themes[pack.theme];
      })
    });
    return theme;
  }

  getDescriptionByTitle(title, target = null) {
    var description;
    levels.packs.forEach(function(pack) {
      pack.levels.forEach(function(level) {
        // Assign theme using theme pack key
        if (target != null ? level === target : title == level.title) description = level.description;
      })
    });
    return description;
  }

  getAuthorByTitle(title, target = null) {
    var author;
    levels.packs.forEach(function(pack) {
      pack.levels.forEach(function(level) {
        // Assign theme using theme pack key
        if (target != null ? level === target : title == level.title) author = level.author;
      })
    });
    return author;
  }

  // Community levels live in the pack titled 'Level Packs' (see Data.js fetchLevelPacks)
  isCommunityPack(pack) {
    return pack.title === 'Level Packs';
  }

  isFromCommunityPack(title, target = null) {
    var communityPack = levels.packs.find(pack => this.isCommunityPack(pack));
    if (communityPack == null) return false;
    if (target != null) return communityPack.levels.includes(target); // Exact level, titles can be duplicated
    return communityPack.levels.some(level => level.title === title);
  }

  getLevelIndex(title, target = null) {
    var count = 0;
    var index = -1;

    // Loop through packs array
    levels.packs.forEach(function(pack) {
      // Loop through each levels array
      pack.levels.forEach(function(level) {
        // Set level index and increment count, a target level object is matched exactly (titles can be duplicated)
        if (target != null ? level === target : title == level.title) {
          index = count;
        }
        count++;
      });
    });
    return index;
  }

  // Inverse of getLevelIndex(), returns the level entry at a flattened index across all packs
  getLevelByIndex(index) {
    return levels.packs.flatMap(pack => pack.levels)[index];
  }
}

export { Level };