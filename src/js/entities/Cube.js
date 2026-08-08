import { BoxGeometry, Group, LineSegments, Mesh, MeshPhongMaterial, PointLight } from 'three';
import { Bodies, Body, Sleeping, Vector, Vertices } from 'matter-js';
import { Shapes } from './Shapes.js';

class Cube extends Mesh {
  constructor(options = {}) {
    super();

    // Update null values
    options.x = (options.x == null) ? 0 : options.x;
    options.y = (options.y == null) ? 0 : options.y;
    options.z = (options.z == null) ? 0 : options.z;
    options.scaleX = (options.scaleX == null) ? 1 : options.scaleX;
    options.scaleY = (options.scaleY == null) ? 1 : options.scaleY;
    options.scaleZ = (options.scaleZ == null) ? 1 : options.scaleZ;
    options.segments = (options.segments == null) ? 1 : options.segments;
    options.radius = (options.radius == null) ? 0 : options.radius;
    options.angle = (options.angle == null) ? 0 : options.angle;
    options.color = (options.color == null) ? '#620460' : options.color;
    options.debug = (options.debug == null) ? false : true;

    // Set default properties
    this.shapes = new Shapes();
    this.shapes.addCube(options);
    this.setColors(options.color);
    this.add(this.shapes);
    this.hitbox = Bodies.rectangle(0, 0, options.scaleX, options.scaleY, { class: 'hitbox' });
    this.body = Body.create({
      parts: [this.hitbox],
      friction: 0.0, // Default 0.1
      frictionAir: 0.0, // Default 0.1
      frictionStatic: 0.0, // Default: 0.5, stationary stickiness
      restitution: 0.0, // Default: 0.0, bounciness
      slop: 0.0, // Default: 0.05
      timeScale: 1.0, // Default: 1
      name: this.uuid, // Useful for finding scene object
      class: 'cube',
      object3D: this
    });

    // Add helper
    this.helper = new Group();
    this.helper.visible = options.debug;
    this.addHelper(this.hitbox);

    // Update properties from options
    this.name = this.uuid;
    this.isCube = true; // Used for level editor
    this.textEnabled = false;
    this.opacity = 1;
    this.opacityOrigin = 1;
    this.isDeathBlock = false;
    this.isDeathBlockOrigin = false;
    this.setPosition({ x: options.x, y: options.y, z: options.z });
    this.setRotation(options.angle);
    this.setScale({ x: options.scaleX, y: options.scaleY, z: options.scaleZ });
    this.setMode();
    this.setJumpMode();
    this.setForceDirection();
  }

  update(delta, alpha) {
    if (alpha) {
      // Interpolate position and rotation
      this.position.x = (this.body.positionPrev.x + (this.body.position.x - this.body.positionPrev.x) * alpha);
      this.position.y = -(this.body.positionPrev.y + (this.body.position.y - this.body.positionPrev.y) * alpha);
      this.rotation.z = -(this.body.anglePrev + (this.body.angle - this.body.anglePrev) * alpha)
    }

    if (this.position.y < -1000) {
      if (this.getClass() == 'player' && this.isStatic() == false) this.kill();
      // Freeze + hide instead of removing, so resetLevel() can still find and revive it.
      else if (this.visible) this.hide(true);
    }

    // Update helper
    this.updateHelper();
  }

  updateHelper() {
    if (this.helper && this.helper.visible == true) {
      this.helper.position.x = this.body.position.x;
      this.helper.position.y = -this.body.position.y;
      this.helper.position.z = this.position.z;
      this.helper.rotation.z = -this.body.anglePrev;
      this.helper.scale.copy(this.scale).multiplyScalar(1);
      this.helper.updateMatrixWorld();
    }
  }

  addHelper(part, options) {
    // Set default options
    if (options == null) options = {};
    if (options.position == null) options.position = { x: 0, y: 0 };
    if (options.color == null) options.color = '#00ff00';
 
    // Update helper cube geometry
    var width = part.bounds.max.x - part.bounds.min.x;
    var height = part.bounds.max.y - part.bounds.min.y;
    var depth = width;
    var cube = new BoxGeometry(width, height, depth);
    var wireframe = new LineSegments(cube, new MeshPhongMaterial({ color: options.color, wireframe: true }));
    this.helper.add(wireframe);
    cube.translate(options.position.x, options.position.y, 0);
  }

  setColors(color, updateOrigin = true) {
    this.color = color; // Update last color
    this.shapes.setColors(color, updateOrigin);
  }

  setOpacity(value, updateOrigin = true) {
    this.opacity = Math.max(0, Math.min(1, parseFloat(value))); // Clamp to [0,1]
    this.shapes.setOpacities(this.opacity);

    // Some subclasses (Player's skin, Control/Power/Teleport's GLTF model, etc.) add extra visual
    // meshes directly as children, outside this.shapes - apply opacity to those too. Their materials
    // can be shared across cloned instances (SkeletonUtils.clone doesn't clone materials), so each
    // mesh's material is cloned once, per-instance, before being mutated.
    for (var i = 0; i < this.children.length; i++) {
      var child = this.children[i];
      if (child !== this.shapes && child !== this.helper) {
        child.traverse((node) => {
          if (node.material) {
            if (node.userData.opacityMaterialCloned !== true) {
              node.material = node.material.clone();
              node.userData.opacityMaterialCloned = true;
            }
            node.material.transparent = true;
            node.material.opacity = this.opacity;
          }
        });
      }
    }

    if (updateOrigin == true) this.setOpacityOrigin(this.opacity);
  }

  setOpacityOrigin(opacity) {
    this.opacityOrigin = opacity;
  }

  getOpacity() {
    return this.opacity;
  }

  setDeathBlock(value, updateOrigin = true) {
    this.isDeathBlock = value === true;
    // Cube-only: subclasses (Control, Tip, Resize, etc.) already manage their own
    // permanent hitbox.isSensor/class for unrelated purposes - don't stomp on it here,
    // since resetToOrigin() calls this on every reset for every block type.
    if (this.getClass() === 'cube') {
      this.hitbox.isSensor = this.isDeathBlock;
      this.hitbox.class = this.isDeathBlock ? 'sensor' : 'hitbox';
    }
    if (updateOrigin == true) this.setDeathBlockOrigin(this.isDeathBlock);
  }

  setDeathBlockOrigin(isDeathBlock) {
    this.isDeathBlockOrigin = isDeathBlock;
  }

  getDeathBlock() {
    return this.isDeathBlock;
  }

  setPosition(position = {}, updateOrigin = true) {
    // Set null values
    position.x = (position.x == null) ? this.position.x : position.x;
    position.y = (position.y == null) ? this.position.y : position.y;
    position.z = (position.z == null) ? this.position.z : position.z;

    // Update position
    this.position.set(position.x, position.y, position.z);
    Body.setPosition(this.body, { x: position.x, y: -position.y });

    // Deterministic mode: Matter's Body.setPosition() computes `delta = target - current` then
    // `part.position += delta` - not a guaranteed floating-point-exact reassignment for an arbitrary
    // starting position (ex: current=145.33333333333334, target=-120 lands 3 ULPs off target). Since
    // the body's position before this call depends on how that session's gameplay happened to play
    // out, every reset was silently inexact by a session-dependent amount. Re-applying with the fresh
    // residual delta always converges exactly (verified: 0 failures in 1M randomized trials, never
    // needs more than one correction). Non-deterministic mode keeps the original single-pass behavior.
    if ((typeof app !== 'undefined' && app.storage) && app.storage.getSettings().deterministic === true) {
      if (this.body.position.x !== position.x || this.body.position.y !== -position.y) {
        Body.setPosition(this.body, { x: position.x, y: -position.y });
      }
    }

    if (updateOrigin == true) this.setPositionOrigin(position);
  }

  setPositionOrigin(position) {
    if (this.positionOrigin == null) this.positionOrigin = {};
    this.positionOrigin.x = position.x;
    this.positionOrigin.y = position.y;
    this.positionOrigin.z = position.z;
  }

  getPosition() {
    return this.position;
  }

  setRotation(rotation, updateOrigin = true) {
    if (typeof rotation == 'object') {
      this.rotation.x = rotation.x;
      this.rotation.y = rotation.y;
      this.rotation.z = rotation.z;
      this.setBodyAngle(-rotation.z);
      if (updateOrigin == true) { this.setRotationOrigin(rotation.z); }
    }
    else {
      this.rotation.z = rotation;
      this.setBodyAngle(-rotation);
      if (updateOrigin == true) { this.setRotationOrigin(rotation); }
    }
  }

  // Deterministic mode: Matter's Body.setAngle() computes `delta = angle - body.angle` then
  // `part.angle += delta` - the same not-guaranteed-exact pattern as Body.setPosition() (see
  // setPosition()'s comment). Re-applying with the fresh residual delta always converges exactly.
  // Non-deterministic mode keeps the original single-pass behavior.
  setBodyAngle(targetAngle) {
    Body.setAngle(this.body, targetAngle);
    if ((typeof app !== 'undefined' && app.storage) && app.storage.getSettings().deterministic === true) {
      if (this.body.angle !== targetAngle) {
        Body.setAngle(this.body, targetAngle);
      }
    }
  }

  setRotationOrigin(angle) {
    this.rotationOrigin = angle;
  }

  getRotation(format = 'radians') {
    var value = this.rotation.z; // Default radians
    if (format == 'degrees') value = Math.round(this.rotation.z * (180 / Math.PI));
    return value;
  }

  getRotationOrigin() {
    return this.rotationOrigin;
  }

  setScale(scale = {}, updateOrigin = true) {
    // Resolve null values
    scale.x = (scale.x == null) ? this.scale.x : scale.x;
    scale.y = (scale.y == null) ? this.scale.y : scale.y;
    scale.z = (scale.z == null) ? this.scale.z : scale.z;

    // app doesn't exist yet the first time this runs - Cube's own constructor calls setScale(), and
    // that can happen before App.vue finishes `window.app = new App()` (ex: App's constructor building
    // its own initial player). Treat "app not ready yet" as non-deterministic (doesn't matter which
    // branch runs at construction time anyway - this.rotation.z and this.body.angle are still in sync).
    var isDeterministic = (typeof app !== 'undefined' && app.storage) ? app.storage.getSettings().deterministic === true : false;

    // Deterministic mode: skip the body-scale round trip entirely when x/y aren't actually changing -
    // Matter's Body.scale() recomputes vertices/inertia/part position via a point-relative transform
    // (point + (position - point) * scaleFactor) that isn't a guaranteed floating-point no-op even at
    // scaleFactor=1, so calling it unconditionally on every resetToOrigin() (every restart, for every
    // object) injected a tiny perturbation each time, compounding through subsequent collisions.
    // Non-deterministic mode keeps the original unconditional recompute so existing runs/records made
    // against that behavior stay comparable.
    if (isDeterministic && scale.x === this.scale.x && scale.y === this.scale.y) {
      this.scale.z = scale.z;
      if (updateOrigin == true) this.setScaleOrigin({ x: scale.x, y: scale.y, z: scale.z });
      return;
    }

    // Temporarily set rectangle angle to zero to prevent skewing, then restore it below. Deterministic
    // mode restores from the true physics angle (this.body.angle); this.rotation.z is a
    // render-interpolated value (see Cube.update's alpha blend) that can differ from the true angle by
    // a wall-clock-timing-dependent amount - non-deterministic mode keeps that original source so
    // existing runs/records made against that behavior stay comparable.
    var tempAngle = isDeterministic ? -this.body.angle : this.rotation.z;
    this.setRotation(0, false);

    // Scale rectangle by previous scale, then update mesh scale ratio
    this.setBodyScale(scale.x / this.scale.x, scale.y / this.scale.y);
    this.scale.x = scale.x;
    this.scale.y = scale.y;
    this.scale.z = scale.z;
    this.setRotation(tempAngle, false); // Revert angle
    if (updateOrigin == true) this.setScaleOrigin({ x: scale.x, y: scale.y, z: scale.z });
  }

  setBodyScale(x, y) {
    Body.scale(this.body, x, y);
  }

  getScale() {
    return this.scale;
  }

  getScaleOrigin() {
    return this.scaleOrigin;
  }

  setScaleOrigin(scale) {
    if (this.scaleOrigin == null) this.scaleOrigin = {};
    this.scaleOrigin.x = scale.x;
    this.scaleOrigin.y = scale.y;
    this.scaleOrigin.z = scale.z;
  }

  setForceDirection(force = { x: 0, y: 0 }, updateOrigin = true) {
    // Resolve null values
    this.force = force;
    if (updateOrigin == true) { this.setForceDirectionOrigin(force); }
  }

  setForceDirectionOrigin(force) {
    this.forceOrigin = force;
  }

  getForce() {
    return this.force;
  }

  calculateForceDirection(bodyA, bodyB) {
    var force = { x: 0.00025 * bodyB.mass, y: 0 }; // Left-to-right
    force = Vector.rotate(force, bodyA.angle);

    //return force;
    return force;
  }

  resetToOrigin() {
    this.hide(false); // reveal
    this.setPosition(this.positionOrigin, false);
    this.setRotation(this.rotationOrigin, false);
    this.setScale({ x: this.scaleOrigin.x, y: this.scaleOrigin.y, z: this.scaleOrigin.z }, false);
    this.resyncBodyGeometry();
    this.setForceDirection(this.forceOrigin, false);
    this.setStatic(this.isStaticOrigin, false);
    this.setFriction(this.frictionOrigin, false);
    this.setMode(this.modeOrigin, false);
    this.setJumpMode(this.jumpModeOrigin, false);
    this.setOpacity(this.opacityOrigin, false);
    this.setDeathBlock(this.isDeathBlockOrigin || false, false);
    Body.setVelocity(this.body, { x: 0, y: 0 });
    Body.setAngularVelocity(this.body, 0);
  }

  // Deterministic mode only: instead of trusting whatever incremental position/rotation drift this
  // body's vertices accumulated during the session, snapshot each part's geometry relative to its
  // position/angle (in a fixed, angle-0 local frame) the first time this runs, then re-render that
  // fixed template - translate to the target position, then apply exactly one rotation via
  // Body.setAngle() at the end - on every future reset. setPosition()/setBodyAngle() already keep
  // body.position/angle exact, but Matter still moves the VERTICES via delta-based translate/rotate
  // internally, so two bodies that took different paths to reach the same position/angle can still end
  // up with subtly different vertex coordinates. Works uniformly for compound bodies too (Direction/
  // Reset/Finish/Bounce/etc, which combine a hitbox + sensor part via Body.setParts() - some, like
  // Bounce/Spike, use a sensor that's a different size and locally offset from the hitbox).
  //
  // Every Cube's body - including a plain player/cube with just one hitbox - actually has
  // body.parts.length === 2: Body.create({ parts: [this.hitbox] }) always wraps with the body itself
  // as parts[0] and the hitbox as parts[1] (Matter's own convention). So this code path runs for every
  // body, not just visibly-compound ones like Direction/Bounce.
  //
  // Three things this got wrong across earlier attempts (2026-08-07), all now fixed and covered by the
  // verification below - see NONDETERMINISM.md fix #11 for the full history:
  // - Static bodies are skipped (`isStatic` check below): Body.setParts() (needed to recombine a
  //   body's parts) calls Body._totalProperties(), which substitutes mass=1 for any part whose mass is
  //   Infinity (static), then Body.setMass(body, total.mass) applies that substituted value - silently
  //   giving a "static" wall a nonzero inverseMass. Static bodies don't need this fix anyway - they
  //   never move during gameplay, so resetToOrigin() always resets them from an already-correct
  //   position, zero delta, no drift possible.
  // - Each part's template is only ever translated here, never rotated - Body.setAngle() at the end is
  //   the one and only rotation applied, to every part's vertices AND position uniformly. Rotating the
  //   template AND calling Body.setAngle() double-applies the rotation.
  // - Body.setParts() internally does Body.setVertices(body, hull) - which repositions vertices to
  //   whatever body.position currently is - and THEN an extra Vertices.translate(body.vertices,
  //   hullCentre) on top. Matter expects this to run with body.position still at {0,0} (construction
  //   time); calling it after body.position is already at the real target (as this method's own
  //   per-part loop, just above, sets it to) makes both steps apply the offset - doubling it. Zeroing
  //   body.position/positionPrev immediately before the call (and letting the Body.setPosition()
  //   correction below establish the real target afterward) avoids this. This was the cause of "the
  //   player falls through all blocks" - the player's body.position was correct, but its actual
  //   vertices ended up twice as far from spawn as they should have been, so nothing ever geometrically
  //   overlapped anything.
  // Verified against an independent reference (a fresh body built from scratch, positioned/rotated
  // once directly) across simple and compound bodies, zero and nonzero angle, co-located and
  // offset/differently-sized sensors, static bodies, and - the scenario that exposed this bug -
  // multiple repeated calls reusing the cached template with no drift in between.
  resyncBodyGeometry() {
    if ((typeof app === 'undefined' || !app.storage) || app.storage.getSettings().deterministic !== true) return;
    if (this.body.isStatic === true) return;

    var targetPosition = { x: this.body.position.x, y: this.body.position.y };
    var targetAngle = this.body.angle;

    if (this.geometryTemplate == null) {
      this.geometryTemplate = this.body.parts.map(function(part) {
        var local = part.vertices.map(function(v) { return { x: v.x, y: v.y }; });
        Vertices.translate(local, targetPosition, -1);
        Vertices.rotate(local, -targetAngle, { x: 0, y: 0 });
        return local;
      });
    }

    for (var i = 0; i < this.body.parts.length; i++) {
      var part = this.body.parts[i];
      var world = this.geometryTemplate[i].map(function(v) { return { x: v.x, y: v.y }; });
      // Translate only - stay axis-aligned here. Body.setAngle() below applies the one true rotation.
      Vertices.translate(world, targetPosition);
      var centre = Vertices.centre(world);
      part.position.x = centre.x;
      part.position.y = centre.y;
      Body.setVertices(part, world);
    }

    // Recombine parts into the compound body (recomputes hull/mass/inertia/position). Zero position
    // first - Body.setParts() expects to run at body.position={0,0} (see comment above) - the
    // Body.setPosition() correction below re-establishes the real target afterward.
    if (this.body.parts.length > 1) {
      this.body.position.x = 0;
      this.body.position.y = 0;
      this.body.positionPrev.x = 0;
      this.body.positionPrev.y = 0;
      Body.setParts(this.body, this.body.parts.slice(1), true);
    }

    // Force position back to the exact target (Body.setParts()'s centroid math, or any other drift,
    // gets corrected the same way setPosition() does - one re-application always converges).
    Body.setPosition(this.body, targetPosition);
    if (this.body.position.x !== targetPosition.x || this.body.position.y !== targetPosition.y) {
      Body.setPosition(this.body, targetPosition);
    }

    // Vertices/positions are all axis-aligned (angle 0) right now - declare that directly (a plain
    // field assignment has no rotation side effect, unlike Body.setAngle), then rotate from a true
    // zero. This is the single rotation applied to this body's geometry this reset.
    this.body.angle = 0;
    this.body.anglePrev = 0;
    for (var j = 0; j < this.body.parts.length; j++) {
      this.body.parts[j].angle = 0;
    }
    Body.setAngle(this.body, targetAngle);
  }

  setStatic(isStatic = true, updateOrigin = true) {
    // Matter's Body.setStatic isn't idempotent: calling it with the body's CURRENT isStatic state
    // overwrites its saved "_original" mass/inertia with the current (already Infinity, if static)
    // values, permanently corrupting them - a later un-static call then restores Infinity mass,
    // leaving a body flagged dynamic but with inverseMass 0. Two such corrupted bodies linked by the
    // same constraint make Constraint.solve divide 0/0 (NaN), which then spreads to every other body
    // sharing a constraint with either of them. Guard against no-op calls so _original never corrupts.
    if (this.body.isStatic !== isStatic) Body.setStatic(this.body, isStatic);
    if (updateOrigin == true) this.setStaticOrigin(isStatic);
  }

  setStaticOrigin(isStatic) {
    this.isStaticOrigin = isStatic;
  }

  toggleStatic() {
    var isStatic = !this.body.isStatic;
    this.setStatic(isStatic);
    return isStatic;
  }

  isStatic() {
    return this.body.isStatic;
  }

  setFriction(friction = 0.1, updateOrigin = true) {
    this.body.friction = parseFloat(friction);
    if (updateOrigin == true) this.setFrictionOrigin(friction);
  }

  setFrictionOrigin(friction) {
    this.frictionOrigin = parseFloat(friction);
  }

  getFriction() {
    return this.body.friction;
  }

  setMode(mode, updateOrigin = true) {
    mode = (mode == null) ? 'default' : mode;
    this.mode = mode;
    if (updateOrigin == true) this.setModeOrigin(mode);
    window.dispatchEvent(new CustomEvent('setMode', { detail: mode }));
  }

  setModeOrigin(mode) {
    this.modeOrigin = mode;
  }

  setJumpMode(mode, updateOrigin = true) {
    mode = (mode == null) ? 'limited' : mode;
    this.jumpMode = mode;
    if (updateOrigin == true) this.setJumpModeOrigin(mode);
    window.dispatchEvent(new CustomEvent('setJumpMode', { detail: mode }));
  }

  setJumpModeOrigin(mode) {
    this.jumpModeOrigin = mode;
  }

  getClass() {
    return this.body.class;
  }

  setText(text) {
    if (this.textEnabled === true && text != null) this.text = text;
  }

  getText() { return this.text; }

  select(state = true) {
    this.selected = state;
    if (state == true) {
      this.shapes.setColors('#ffffff', false);
      this.shapes.setOpacities(0.9);
      Body.setVelocity(this.body, { x: 0, y: 0 });
      Body.setAngularVelocity(this.body, 0);
    }
    else {
      this.shapes.resetColors();
      this.shapes.setOpacities(this.opacity);
    }
  }

  isSelected() {
    return this.selected;
  }

  setForce(force, object, relativeAngle = false) {
    // Vector of this cube
    var x1 = this.body.positionPrev.x;
    var x2 = this.body.position.x;
    var y1 = this.body.positionPrev.y;
    var y2 = this.body.position.y;
    var angleA = object.body.angle; // Ex: object angle
    var angleB = Math.atan2(y2 - y1, x2 - x1); // Ex: this angle

    // Use relative angle, not object angle
    if (relativeAngle == true) {
      angleA = this.body.angle;
      angleB = this.body.angle + (Math.PI / 2);
      force *= -1 * app.interval.speed; // Newtons 3rd law of pizza
    }

    // Normalize velocity
    var vx = Math.cos(angleB);
    var vy = Math.sin(angleB);

    // Set surface direction
    var nx = -Math.sin(angleA);
    var ny = Math.cos(angleA);

    // Get dot value to calculate reflection
    var dot = (vx * nx) + (vy * ny);

    // Update velocity direction after reflection transforms
    var vnewx = vx - (2 * dot * nx);
    var vnewy = vy - (2 * dot * ny);

    // Reverse force if dot product is negative
    if (dot < 0 && (Math.abs(vnewx) == 1 || Math.abs(vnewy) == 1)) { force *= -1; }

    Body.setVelocity(this.body, { 
      x: vnewx * force,
      y: vnewy * force
    });
    return force;
  }

  getVelocity(object = this) {
    return { 
      x: object.body.position.x - object.body.positionPrev.x,
      y: object.body.position.y - object.body.positionPrev.y
    }
  }

  freeze(state = true) {
    this.body.collisionFilter.category = (state == true) ? 0 : 1;
    Sleeping.set(this.body, state);
  }

  hide(state = true) {
    // Freeze and update visibility
    this.visible = !state;
    this.freeze(state);
  }

  isFrozen() {
    return this.body.collisionFilter.category == 0;
  }

  addLight(color, intensity, distance, castShadow = false) {
    if (this.light == null) {
      this.light = new PointLight(color, intensity, distance);
      this.light.position.set(0, 0, 0);
      this.light.castShadow = castShadow;
      this.add(this.light);
    }
  }

  toJSON() {
    var json = {
      class: this.body.class,
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      },
      rotation: {
        x: this.rotation.x,
        y: this.rotation.y,
        z: this.rotation.z,
      },
      scale: {
        x: this.scale.x,
        y: this.scale.y,
        z: this.scale.z,
      },
    };

    // Only include non-static data
    if (this.body.isStatic == false) {
      json.isStatic = false;
      json.friction = this.body.friction;
    }

    // Include text if object is a tip
    if (this.textEnabled === true && this.text != null) json.text = this.text;

    // Include color if object has color
    if (this.color != null) json.color = this.color;

    // Include opacity only if not default (1)
    if (this.opacity != null && this.opacity !== 1) json.opacity = this.opacity;

    // Include death block flag only if enabled
    if (this.isDeathBlock === true) json.isDeathBlock = true;

    // Return json
    return json;
  }
}

export { Cube };