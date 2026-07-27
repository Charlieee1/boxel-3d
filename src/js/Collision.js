import { MathUtils } from 'three';

class Collision {
  constructor() {
    this.previousFrameCollidingBlocks = new Set(); // Track block uuids colliding with player last frame (deterministic mode dedup)
  }

  checkPlayerCollision(e) {
    var pairs = e.pairs;
    var settings = app.storage.getSettings();
    var currentFrameCollidingBlocks = new Set();

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
              // Deterministic mode: skip re-triggering a player-block effect that was already active last frame
              // (prevents e.g. a checkpoint/gravity block re-firing when the player respawns still touching it)
              var isPlayerPair = objectB.body.class == 'player';
              if (isPlayerPair) currentFrameCollidingBlocks.add(objectA.uuid);
              var isNewPair = !this.previousFrameCollidingBlocks.has(objectA.uuid);
              var shouldTrigger = !isPlayerPair || isNewPair || settings.deterministic !== true;

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

    // Update deterministic-mode frame tracking
    this.previousFrameCollidingBlocks = currentFrameCollidingBlocks;
  }
}

export { Collision };