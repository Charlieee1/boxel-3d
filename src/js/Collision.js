import { MathUtils } from 'three';
import { Bounds } from 'matter-js';

class Collision {
  constructor() {
    // uuid pairs ("sensorUuid|otherUuid") currently in contact, maintained incrementally via
    // collisionStart/collisionEnd rather than rebuilt each call - a respawn's Engine.clear() wipes
    // Matter's own pair cache, so it re-fires collisionStart for contacts that never actually broke;
    // this set is how deterministic mode tells that apart from a genuinely new touch
    this.activeSensorPairs = new Set();
  }

  checkPlayerCollision(e) {
    var pairs = e.pairs;
    var settings = app.storage.getSettings();

    // Loop through pairs of collisions
    for (var pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
      var pair = pairs[pairIndex];
      var bodies = [pair.bodyA, pair.bodyB];

      // Switch and compare bodies (bodyA and bodyB)
      for (var bodyIndex = 0; bodyIndex < bodies.length; bodyIndex++) {
        var bodyA = bodies[(bodyIndex + 0) % 2]; // Switch bodyA to bodyB
        var bodyB = bodies[(bodyIndex + 1) % 2]; // Switch bodyB to bodyA
        var objectA = bodyA.parent.object3D;
        var objectB = bodyB.parent.object3D;

        if (objectA != null && objectB != null) {
          // Check if any collision is related to the player
          if (objectA.body.class == 'player') {
            app.player.jumpReady = true;
          }

          // Check bodies if bodyB is not a sensor. This prevents sensors reacting to each other.
          if (bodyB.class != 'sensor') {

            // Check sensor points
            if (bodyA.class == 'sensor') {
              // Deterministic mode: skip re-triggering a block effect whose contact was already active
              // (prevents e.g. a checkpoint/gravity/bounce block re-firing on the player or any other
              // body that respawns/resets still touching it, without needing an actual new touch)
              var pairKey = objectA.uuid + '|' + objectB.uuid;
              var isNewPair = !this.activeSensorPairs.has(pairKey);
              this.activeSensorPairs.add(pairKey);
              var shouldTrigger = isNewPair || settings.deterministic !== true;

              if (shouldTrigger) {
              if (objectA.body.class == 'cube' && objectA.isDeathBlock === true) {
                if (objectB.body.class == 'player') { app.player.kill(); }
              }
              else if (objectA.body.class == 'tip') {
                if (objectB.body.class == 'player') {
                  if (settings.disableTextboxes !== true) app.level.showTip(objectA.text);
                  objectA.hide(true);
                }
              }
              else if (objectA.body.class == 'bounce') {
                var force = objectA.scale.y / 2; // Use bounce height
                if (objectA.body.isStatic == false) { objectA.setForce(force, objectB, true); } // Yeet bounce cube backwards
                if (objectB.body.isStatic == false) { objectB.setForce(force, objectA); }

                // Play bounce sound (only for player)
                if (objectB.body.class == 'player') {
                  app.assets.audio.play('bounce');
                }
              }
              else if (objectA.body.class == 'checkpoint') {
                if (objectB.body.class ==  'player') {
                  app.player.saveCheckpoint(objectA.position);
                  app.assets.audio.play('success');
                }
              }
              else if (objectA.body.class == 'spike') {
                if (objectB.body.class ==  'player') { app.player.kill(); }
              }
              else if (objectA.body.class == 'shrink') {
                if (objectB.body.class ==  'player') {
                  app.player.shrink();
                  objectA.hide(true);
                }
              }
              else if (objectA.body.class == 'grow') {
                if (objectB.body.class ==  'player') {
                  app.player.grow();
                  objectA.hide(true);
                }
              }
              else if (objectA.body.class == 'resize') {
                if (objectB.isStatic() == false) {
                  objectB.setScale(objectA.scale, false);

                  // Play resize sound (only for player)
                  if (objectB.body.class == 'player') {
                    app.assets.audio.play('resize');
                  }
                }
              }
              else if (objectA.body.class == 'direction') {
                var force = objectB.calculateForceDirection(objectA.body, objectB.body);
                objectB.setForceDirection(force, false);

                // Play teleport sound (only for player)
                if (objectB.body.class == 'player') {
                  app.assets.audio.play('teleport');
                }
              }
              else if (objectA.body.class == 'gravity') {
                if (objectB.body.class ==  'player') {
                  app.updateGravity(objectA.body.angle);
                  app.assets.audio.play('teleport');
                }
              }
              else if (objectA.body.class == 'grapple') {
                if (objectB.body.class ==  'player') {
                  app.player.setMode('grapple', false);
                  app.assets.audio.play('teleport');
                }
              }
              else if (objectA.body.class == 'finish') {
                if (objectB.body.class ==  'player') {
                  app.player.finish();
                }
              }
              else if (objectA.body.class == 'reset') {
                if (objectB.body.class ==  'player') {
                  app.player.reset(objectA.getResetConfig());
                }
              }
              else if (objectA.body.class == 'control') {
                if (objectB.body.class ==  'player') {
                  app.player.setMode('control', false);
                  app.player.syncControlsFromHeld();
                  app.assets.audio.play('teleport');
                }
              }
              else if (objectA.body.class == 'power') {
                if (objectB.body.class ==  'player') {
                  app.player.setJumpMode('unlimited', false);
                  app.assets.audio.play('teleport');
                }
              }
              else if (objectA.body.class == 'teleport') {
                // Set position for any cube
                const position = objectA.text?.split(',') || [];
                objectB.setPosition({
                  x: Number(position[0] || 0),
                  y: Number(position[1] || 0),
                  z: 0
                }, false);
                objectB.updateMatrixWorld();

                // Only play sound for player
                if (objectB.body.class ==  'player') {
                  app.assets.audio.play('teleport');
                }
              }
              }
            }
            else {
              if (objectA.body.class == 'cube') {
                if (objectB.body.class ==  'player') {
                  const detune = MathUtils.randInt(-1200, 1200);
                  app.assets.audio.play('pop1', { detune: detune });
                }
              }
            }
          }
        }
      }
    }
  }

  // Mirrors checkPlayerCollision's pair switching so a real separation clears the matching
  // activeSensorPairs entry, letting a genuine future re-touch trigger normally again
  checkCollisionEnd(e) {
    var pairs = e.pairs;

    for (var pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
      var pair = pairs[pairIndex];
      var bodies = [pair.bodyA, pair.bodyB];

      for (var bodyIndex = 0; bodyIndex < bodies.length; bodyIndex++) {
        var bodyA = bodies[(bodyIndex + 0) % 2];
        var bodyB = bodies[(bodyIndex + 1) % 2];
        var objectA = bodyA.parent.object3D;
        var objectB = bodyB.parent.object3D;

        if (objectA != null && objectB != null && bodyA.class == 'sensor' && bodyB.class != 'sensor') {
          this.activeSensorPairs.delete(objectA.uuid + '|' + objectB.uuid);
        }
      }
    }
  }

  // Bug: a deterministic-mode reset (Engine.clear(), see Player.resetDeterministicPhysics) wipes
  // Matter's own pair cache, but doesn't touch this Set - and resetToOrigin() then teleports bodies to
  // new positions. If a body was touching a sensor at the moment of reset and ends up NOT touching it
  // post-teleport (the common case - dying elsewhere then respawning at a checkpoint/level-start that
  // isn't that sensor), Matter never gets the chance to fire a genuine collisionEnd for that pair (it
  // never re-detects the contact in the first place, so there's nothing for it to declare ended) - the
  // entry is orphaned here forever, silently blocking that sensor's very next real touch (whose
  // outcome then self-corrects: that blocked touch still runs checkCollisionEnd when the body walks
  // away, finally clearing the stale entry - matching the reported "touched and untouched" symptom).
  // Call this once after a reset has finished repositioning everything (Level.resetLevel(), after its
  // per-child loop) to prune entries that no longer correspond to genuine contact.
  reconcileAfterReset() {
    if (this.activeSensorPairs.size === 0) return;
    var stale = [];
    this.activeSensorPairs.forEach(function(key) {
      var separatorIndex = key.indexOf('|');
      var sensorObject = app.level.getObjectByName(key.slice(0, separatorIndex));
      var otherObject = app.level.getObjectByName(key.slice(separatorIndex + 1));
      if (sensorObject == null || otherObject == null || !Bounds.overlaps(sensorObject.body.bounds, otherObject.body.bounds)) {
        stale.push(key);
      }
    });
    stale.forEach(function(key) { this.activeSensorPairs.delete(key); }.bind(this));
  }
}

export { Collision };