import { Euler, Mesh, MeshBasicMaterial, Object3D, Plane, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';
import { Body, Composite, Engine, World } from 'matter-js';
import { PuttyControls } from './PuttyControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Scratch vector reused for world -> screen projection (multiselect marquee).
const _screenVec = new Vector3();

// Tuning for "P" chain physics' invisible settle simulation (see LevelEditor.settleChainAndBake) - a
// one-time level-authoring aid, not a live gameplay loop, so these are UX-tuning constants rather than
// physics-accuracy ones:
// - timestep matches the main loop's fixed engine step (see App.js updateEngine/interval.add).
// - totalSteps is a safety cap of 5 simulated seconds - plenty of time for a chain to hang/sag out.
// - speedThreshold/stableFramesNeeded let the settle stop early once the chain has visibly stopped moving.
const CHAIN_SETTLE_TUNING = {
  timestep: 1000 / 60,
  totalSteps: 3600, // 60 simulated seconds at 60 steps/sec
  speedThreshold: 0.01,
  stableFramesNeeded: 10
};

// Running counter so each chain settle gets its own negative collisionFilter.group - Matter treats any
// pair of bodies sharing the same negative group as never-colliding, regardless of category/mask.
var chainSettleGroupCounter = 0;

class LevelEditor {
  constructor(camera, domElement) {
    // Set initial variables
    this.selectedObjectType = 'cube';

    // Add controls with camera and active canvas
    this.controlsPutty = new PuttyControls(camera, domElement);
    this.controlsPutty.threshold = 0.02; // Default 0.01
    this.controlsTransform = new TransformControls(camera, domElement);
    this.controlsTransform.showZ = true;
    this.controlsTransform.space = 'world';
    this.controlsTransform.showAll = false;
    this.duplicateOffset = new Vector3(0, 16, 0);
    this.controlsOrbit = new OrbitControls(camera, domElement);
    this.controlsOrbit.enabled = false; // Default disabled for campaign
    this.controlsOrbit.mouseButtons = { LEFT: 2, MIDDLE: 2, RIGHT: 0 }; // 0 = Left/Rotate, 1 = Middle/Dolly, 2 = Right/Pan
    this.controlsOrbit.touches = { ONE: 1, TWO: 3 }; // 0 = Rotate, 1 = Pan, 2 = Dolly pan, 3 = Dolly rotate
    this.controlsOrbit.zoomSpeed = 3;
    this.controlsOrbit.minDistance = 10;
    this.controlsOrbit.maxDistance = 2000;
    this.controlsOrbit.rotateSpeed = 0.5 // Default 1;
		this.controlsOrbit.rotateSpeedDefault = 0.5 // Default 1;
    this.controlsOrbit.panSpeed = 1;
		this.controlsOrbit.panSpeedDefault = 1;
    this.down = new Vector2();
    this.move = new Vector2();
    this.up = new Vector2();
    this.drag = false;
    this.snap = 16;
    this.keys = {};
    this.selectedMode = 'translate';
    this.currentZ = 0; // editor-wide "current Z" (textbox): new blocks spawn here, "0" resets the selection here
    this.puttyAxes = ['X', 'Y', 'Z'];

    // Drag-to-move (hold Q): grab a block under the cursor and slide it; not gated by `exclusiveAction` below.
    this.dragMove = {
      enabled: false,        // true while Q is held
      state: 'static',       // 'static' | 'moving'
      offset: { x: 0, y: 0 }, // grab point relative to the block origin (unsnapped)
      moved: false           // true once the grabbed block has actually been repositioned
    };

    // The one editor action allowed to run at a time; null when idle, else { name, confirm(), cancel() }.
    this.exclusiveAction = null;

    // "N" toggle (when no "B" chord pending): clicking on top of a block always builds instead of selecting it.
    this.forceBuildEnabled = false;

    // "H" toggle: hovering an object shows the active tool's gizmo without clicking to select first.
    this.hoverPreviewEnabled = false;
    this.hoverPreviewObject = null; // object currently gizmo-attached via hover only, not a real selection
    this.hoverDragActive = false; // true while a drag borrows app.selectedObject from a hover-only attach
    this.hoverDragRestoreTo = null; // app.selectedObject value to restore once that borrowed drag ends
    this.puttyDragging = false; // DragControls exposes no public dragging flag, so track it ourselves
    this.puttyHovering = false; // Tracked from PuttyControls' hoveron/hoveroff, DragControls exposes no public getter

    // "B,B"/"B,N" chord: flip the selection. First "B" arms indefinitely; a following B or N completes it.
    this.chordPending = null; // 'B' while armed, else null

    // ",": cycles vertex/end snapping mode ('normal' -> 'vertex' -> 'centre' -> 'normal'), overrides plain grid snap while not 'normal' (see keybinds.md).
    this.snapMode = 'normal';

    // ".": arm/set a custom rotation pivot point, overriding single/group rotation center until cleared.
    this.customPivot = null; // { x, y, z } while set, else null
    this.pivotMarkerMesh = null;
    this.pivotProxy = null; // invisible Object3D the gizmo attaches to (in rotate mode) instead of the real object
    this.pivotProxyTarget = null; // the real object being remapped through the proxy
    this.pivotProxySnapshot = null; // pivotProxyTarget's position/rotation at the start of the current drag

    // Session-only "Set as start position" playtest override (checkpoint property panel button, see OriginPageLevelEditor.vue).
    this.tempSpawnPosition = null;
    this.tempSpawnRotation = null;

    // Initialize helper visibility from current mode.
    this.applyControlsModeState();

    // Putty constrols events
    this.controlsPutty.addEventListener('dragstart', () => { this.controlsOrbit.enabled = false; this.puttyDragging = true; this.beginHoverDrag(); this.saveSelectedObject(); });
    this.controlsPutty.addEventListener('dragend', () => {
      this.controlsOrbit.enabled = true;
      this.puttyDragging = false;
      // Putty is a non-rotate transform - an actual drag clears the custom pivot (see keybinds.md "." details).
      if (this.controlsPutty.moved) this.clearCustomPivot();
      // During a group transform the attached object is the control block, not a real object - skip body-sync/save.
      if (this.isMultiselectTransform()) { this.endHoverDrag(); return; }
      this.updateSelectedObject();
      this.endHoverDrag();
    });
    this.controlsPutty.addEventListener('objectChange', () => {
      this.controlsPutty.moved = true;
      // Remap the whole selection as the group control block is putty-dragged.
      if (this.isMultiselectTransform()) this.updateGroupTransform();
      // Vertex/end snapping overrides putty's own built-in grid snap (see mouseDown() and applyVertexSnapToPutty()).
      else if (this.snapMode !== 'normal' && app.selectedObject) this.applyVertexSnapToPutty();
      window.dispatchEvent(new CustomEvent('objectChange', { detail: app.selectedObject }));
    });
    this.controlsPutty.addEventListener('hoveron', () => { this.puttyHovering = true; });
    this.controlsPutty.addEventListener('hoveroff', () => { this.puttyHovering = false; });

    // Transform controls events
    this.controlsTransform.addEventListener('mouseDown', () => { this.controlsOrbit.enabled = false; this.beginHoverDrag(); this.saveSelectedObject(); });
    this.controlsTransform.addEventListener('mouseUp', () => {
      this.controlsOrbit.enabled = true;
      // A completed translate/scale drag (not rotate), single object or group, clears the custom pivot (see keybinds.md "." details).
      if (this.selectedMode !== 'rotate' && this.controlsTransform.moved) this.clearCustomPivot();
      // During a group transform the attached object is the control block, not a real object - skip body-sync/save.
      if (this.isMultiselectTransform()) { this.endHoverDrag(); return; }
      // Re-snapshot the pivot proxy so the next rotate drag starts fresh from the object's new transform.
      if (this.pivotProxyTarget) {
        var t = this.pivotProxyTarget;
        this.pivotProxySnapshot = { x: t.position.x, y: t.position.y, z: t.position.z, rx: t.rotation.x, ry: t.rotation.y, rz: t.rotation.z };
        this.pivotProxy.rotation.set(0, 0, 0);
        this.pivotProxy.updateMatrixWorld();
      }
      this.updateSelectedObject();
      this.endHoverDrag();
    });
    this.controlsTransform.addEventListener('objectChange', () => {
      this.controlsTransform.moved = true;
      // Remap the whole selection as the group control block is dragged.
      if (this.isMultiselectTransform()) this.updateGroupTransform();
      // Rotating a single object around a custom pivot remaps it through the invisible pivot proxy instead.
      else if (this.pivotProxyTarget) this.updatePivotRotation();
      // Vertex/end snapping overrides the gizmo's built-in grid snap for a plain translate drag.
      else if (this.snapMode !== 'normal' && this.selectedMode === 'translate' && app.selectedObject) this.applyVertexSnapToSelection();
      // Same, for a scale drag - corrects scale (not position) since scale is symmetric about the object center.
      else if (this.snapMode !== 'normal' && this.selectedMode === 'scale' && app.selectedObject) this.applyVertexSnapToScale(app.selectedObject);
      window.dispatchEvent(new CustomEvent('objectChange', { detail: app.selectedObject }));
    });

    // Orbit controls events
    this.controlsOrbit.addEventListener('start', () => { this.controlsOrbit.moved = false; })
    this.controlsOrbit.addEventListener('change', () => { this.controlsOrbit.moved = true; })

    // Add render listeners
    this.boundUpdateRender = this.updateRender.bind(this);
    domElement.addEventListener('pointerdown', this.pointerDown.bind(this));
    domElement.addEventListener('pointermove', this.pointerMove.bind(this));
    domElement.addEventListener('pointerup', this.pointerUp.bind(this));
    domElement.addEventListener('wheel', this.boundUpdateRender);
    window.addEventListener('resize', this.boundUpdateRender);
    window.addEventListener('setSelectedObject', this.boundUpdateRender);
    window.addEventListener('setSelectedMode', this.boundUpdateRender);
    window.addEventListener('themeSelected', this.boundUpdateRender);
    window.addEventListener('updateScale', this.boundUpdateRender); // Fires on every settings save - lets the visual grid toggle apply immediately
    window.addEventListener('blur', this.clearKeys.bind(this)); // Losing focus mid-keypress (e.g. alt-tab) can skip the keyup, so drop any tracked keys
  }

  // Releases all tracked key state - guards against a modifier (e.g. Shift) getting stuck "held" after a missed keyup
  clearKeys() {
    for (const code in this.keys) this.keys[code] = false;
  }

  pointerDown(e) {
    this.down.set(e.clientX, e.clientY);
    this.drag = true;
    this.controlsOrbit.rotateSpeed = 0; // Deactivate camera by default
    this.controlsOrbit.panSpeed = 0;
    if (this.dragMove.enabled) this.dragMoveDown(e);
    else if (this.isMultiselectSelectionStage()) this.multiselectPointerDown(e);
    else if (this.exclusiveAction?.name === 'thin-build') this.thinBuildPointerDown(e);
    this.updateRender();
  }

  pointerMove(e) {
    this.move.set(e.clientX, e.clientY);

    if (this.dragMove.enabled) {
      this.dragMoveMove(e);
      return;
    }

    if (this.isMultiselectSelectionStage()) this.multiselectPointerMove(e);
    else if (this.exclusiveAction?.name === 'fast-build') this.fastBuildPointerMove(e);
    else if (this.exclusiveAction?.name === 'thin-build') this.thinBuildPointerMove(e);

    // Restore orbit camera speeds once the drag passes the click threshold.
    if (this.isSnapped() == false) {
      this.controlsOrbit.rotateSpeed = this.controlsOrbit.rotateSpeedDefault;
      this.controlsOrbit.panSpeed = this.controlsOrbit.panSpeedDefault;
    }
    this.updateRender();
  }

  pointerUp(e) {
    this.up.set(e.clientX, e.clientY);
    this.drag = false;
    if (this.dragMove.enabled) this.dragMoveUp();
    else if (this.isMultiselectSelectionStage()) this.multiselectPointerUp(e);
    else if (this.exclusiveAction?.name === 'fast-build') this.fastBuildPointerUp(e);
    else if (this.exclusiveAction?.name === 'thin-build') this.thinBuildPointerUp(e);
    else if (this.exclusiveAction?.name === 'cut-out') this.cutOutPointerUp(e);
    else if (this.exclusiveAction?.name === 'set-pivot') this.resolveCustomPivotClick(e);
    else if (this.isChainAnchorStage()) this.chainAnchorPointerUp(e);
    this.updateRender();
  }

  // Whether an editor mode (drag-move, fast/thin build, multiselect marquee/refine/anchor, cut-out, set-pivot) suppresses vanilla clicking; transform stage is not suppressed.
  isVanillaClickingSuppressed() {
    return this.dragMove.enabled
      || this.exclusiveAction?.name === 'fast-build'
      || this.exclusiveAction?.name === 'thin-build'
      || this.exclusiveAction?.name === 'cut-out'
      || this.exclusiveAction?.name === 'set-pivot'
      || this.isChainAnchorStage()
      || this.isMultiselectSelectionStage();
  }

  isMultiselectMarquee() {
    return this.exclusiveAction?.name === 'multiselect' && this.exclusiveAction.stage === 'marquee';
  }

  isMultiselectRefine() {
    return this.exclusiveAction?.name === 'multiselect' && this.exclusiveAction.stage === 'refine';
  }

  // Both selection stages (marquee + refine) drive the pointer handlers; transform is driven by the gizmo instead.
  isMultiselectSelectionStage() {
    return this.isMultiselectMarquee() || this.isMultiselectRefine();
  }

  isMultiselectTransform() {
    return this.exclusiveAction?.name === 'multiselect' && this.exclusiveAction.stage === 'transform';
  }

  // Enable/disable orbit pan/rotate/zoom so pointer-driven editor modes can manipulate blocks instead.
  setOrbitInteractionEnabled(enabled) {
    this.controlsOrbit.enablePan = enabled;
    this.controlsOrbit.enableRotate = enabled;
    this.controlsOrbit.enableZoom = enabled;
  }

  // Enable/disable just the LEFT orbit button (pan); marquee stage disables it to draw instead.
  setOrbitLeftEnabled(enabled) {
    this.controlsOrbit.mouseButtons.LEFT = enabled ? 2 : null; // 2 = pan
  }

  // Enable/disable just the RIGHT orbit button (rotate); thin build disables it to draw instead.
  setOrbitRightEnabled(enabled) {
    this.controlsOrbit.mouseButtons.RIGHT = enabled ? 0 : null; // 0 = rotate
  }

  // Drag-to-move (hold Q): grab whatever block is under the pointer and slide it, offset-locked to the grab point.
  enableDragMove() {
    if (this.dragMove.enabled) return;
    this.dragMove.enabled = true;
    this.setOrbitInteractionEnabled(false); // stop the camera moving while dragging
  }

  disableDragMove() {
    if (this.dragMove.enabled == false) return;
    if (this.dragMove.state == 'moving') this.dragMoveUp();
    this.setOrbitInteractionEnabled(true);
    this.dragMove.enabled = false;
  }

  dragMoveDown(e) {
    if (this.dragMove.state == 'moving') return;
    // In multiselect transform, Q grabs the group control block so the whole selection moves together.
    var object = this.isMultiselectTransform() ? this.exclusiveAction.controlBlock : app.mouse.clickObject(e);
    if (object == null) return;

    this.dragMove.state = 'moving';
    this.dragMove.moved = false;
    app.selectedObject = object;

    // Snap the grab point (vertex/end snap if active, else the plain grid), then store its offset from the block origin
    var point = app.mouse.getPositionOnPlane(e, object.position.z);
    var grab = point ? this.snapPoint({ x: point.x, y: point.y, z: object.position.z }, object) : { x: object.position.x, y: object.position.y };
    this.dragMove.offset.x = grab.x - object.position.x;
    this.dragMove.offset.y = grab.y - object.position.y;
  }

  dragMoveMove(e) {
    if (this.dragMove.state == 'static') return;
    if (app.selectedObject == null) return;

    var object = app.selectedObject;
    var point = app.mouse.getPositionOnPlane(e, object.position.z);
    if (point == null) return;

    if (this.snapMode !== 'normal') {
      // Move to the raw (unsnapped) cursor-tracked position first so the object's own vertices reflect the live
      // drag, then correct via closest-pair vertex/end-centre snap across every vertex/end-centre (see applyClosestVertexSnap).
      object.setPosition({
        x: point.x - this.dragMove.offset.x,
        y: point.y - this.dragMove.offset.y,
        z: object.position.z
      });
      this.applyClosestVertexSnap(object);
    }
    else {
      var snapped = this.snapPoint({ x: point.x, y: point.y, z: object.position.z }, object);
      object.setPosition({
        x: snapped.x - this.dragMove.offset.x,
        y: snapped.y - this.dragMove.offset.y,
        z: object.position.z
      });
    }
    this.dragMove.moved = true;

    // If the grabbed object is the multiselect control block, remap the group.
    if (this.isMultiselectTransform() && object === this.exclusiveAction.controlBlock) {
      this.updateGroupTransform();
    }

    this.updateRender();
  }

  dragMoveUp() {
    if (this.dragMove.state == 'static') return;
    this.dragMove.state = 'static';
    var isGroupMove = this.isMultiselectTransform() && app.selectedObject === this.exclusiveAction.controlBlock;
    // Outside multiselect, save one entry per move; inside a group transform it's folded into the transform's entry instead.
    if (this.dragMove.moved && isGroupMove == false) app.levelHistory.save('Moved object');
    // Drag-to-move is a translate action - an actual move (single object or group) clears the custom pivot (see keybinds.md "." details).
    if (this.dragMove.moved) this.clearCustomPivot();
    // Keep the control block selected (gizmo stays) if Q moved the group; otherwise clear the transient selection.
    app.selectedObject = isGroupMove ? this.exclusiveAction.controlBlock : null;
  }

  // Fast build (hold K): click-place, drag-scale, drag-rotate, drag-move, click to finalize and start the next block.
  toggleFastBuild() {
    // While active, "K" steps back one stage (like undoing the last click) unless no block is mid-placement, then it disables.
    if (this.exclusiveAction?.name === 'fast-build') {
      this.fastBuildStepBack();
      return;
    }
    if (this.canPerformEditorAction() == false) return;

    var action = this.startExclusiveAction('fast-build', {
      confirm: function() {}, // "C" does nothing during fast build
      cancel: () => this.endFastBuild()
    });
    this.setExclusiveActionStage('create');
    action.block = null;
    action.origin = null;
    // Camera stays movable while building - the stages track free mouse movement so orbit doesn't conflict.
  }

  fastBuildStepBack() {
    var action = this.exclusiveAction;

    // No block mid-placement -> "K" disables fast build entirely.
    if (action.stage == 'create' || action.block == null) {
      this.endFastBuild();
      return;
    }

    // Otherwise walk back one stage; stepping out of 'scale' discards the just-placed block.
    if (action.stage == 'scale') {
      app.level.removeObject(action.block, true);
      action.block = null;
      action.origin = null;
      this.setExclusiveActionStage('create');
    }
    else if (action.stage == 'rotate') {
      this.setExclusiveActionStage('scale');
    }
    else if (action.stage == 'move') {
      this.setExclusiveActionStage('rotate');
    }
  }

  endFastBuild() {
    // Discard whatever's mid-placement (a block only exists once past 'create')
    if (this.exclusiveAction?.block) app.level.removeObject(this.exclusiveAction.block, true);
    this.endExclusiveAction();
  }

  fastBuildPointerUp(e) {
    // A "click" (not a camera drag) advances to the next stage, using isSnapped() as the click-vs-drag tolerance.
    if (this.controlsOrbit.moved || this.isSnapped() == false) return;

    var action = this.exclusiveAction;
    if (action.stage == 'create') {
      this.fastBuildCreateBlock(e);
      this.setExclusiveActionStage('scale');
    }
    else if (action.stage == 'scale') {
      this.setExclusiveActionStage('rotate');
    }
    else if (action.stage == 'rotate') {
      this.setExclusiveActionStage('move');
    }
    else if (action.stage == 'move') {
      // Finalize this block (one history entry per completed block, not per stage) and start the next one.
      app.levelHistory.save('Added ' + action.block.getClass());
      action.block = null;
      action.origin = null;
      this.setExclusiveActionStage('create');
    }
  }

  fastBuildCreateBlock(e) {
    var action = this.exclusiveAction;
    var raw = app.mouse.getPosition(e);
    var pos = this.snapPoint({ x: raw.x, y: raw.y, z: this.currentZ }, null);

    var type = this.selectedObjectType;
    var block = app.level.entityFactory.createObject(type);
    app.level.setObjectProperties(block, {
      class: type,
      isStatic: true,
      position: { x: pos.x, y: pos.y, z: this.currentZ },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: app.BOX_SIZE, y: app.BOX_SIZE, z: app.BOX_SIZE }
    });
    app.level.addObject(block);

    action.block = block;
    action.origin = pos;
  }

  fastBuildPointerMove(e) {
    var action = this.exclusiveAction;
    if (action.block == null) return; // still in 'create': nothing to preview yet

    if (action.stage == 'scale') {
      var raw2 = app.mouse.getPosition(e);
      var pos2 = this.snapPoint({ x: raw2.x, y: raw2.y, z: this.currentZ }, action.block);
      var origin = action.origin;

      app.level.setObjectProperties(action.block, {
        position: { x: 0.5 * (origin.x + pos2.x), y: 0.5 * (origin.y + pos2.y), z: this.currentZ },
        rotation: { x: 0, y: 0, z: 0 },
        scale: {
          x: Math.abs(origin.x - pos2.x),
          y: Math.abs(origin.y - pos2.y),
          z: app.BOX_SIZE
        }
      });
    }
    else if (action.stage == 'rotate') {
      // Unsnapped position: it's the resulting angle that gets snapped below.
      var pos = app.mouse.getPosition(e);
      var origin = action.block.position;
      var angle = Math.atan2(pos.y - origin.y, pos.x - origin.x);
      if (app.mouse.snap > 1) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12); // 15 degree steps
      action.block.setRotation({ x: 0, y: 0, z: angle });
    }
    else if (action.stage == 'move') {
      var raw = app.mouse.getPosition(e);
      var pos = this.snapPoint({ x: raw.x, y: raw.y, z: action.block.position.z }, action.block);
      action.block.setPosition({ x: pos.x, y: pos.y, z: action.block.position.z });
    }

    action.block.updateMatrixWorld();
    action.block.updateHelper();
  }

  // Thin build (press L): right-drag draws a 1-block-wide strip in one continuous gesture, then starts the next one.
  toggleThinBuild() {
    if (this.exclusiveAction?.name === 'thin-build') {
      this.endThinBuild();
      return;
    }
    if (this.canPerformEditorAction() == false) return;

    var action = this.startExclusiveAction('thin-build', {
      confirm: function() {}, // "C" does nothing during thin build
      cancel: () => this.endThinBuild()
    });
    action.block = null;
    action.origin = null;
    this.setOrbitRightEnabled(false); // right-drag draws; left/middle/wheel still orbit (pan/zoom, no rotate)
  }

  endThinBuild() {
    // Discard whatever's mid-drag (a block only exists between pointerdown and pointerup)
    if (this.exclusiveAction?.block) app.level.removeObject(this.exclusiveAction.block, true);
    this.setOrbitRightEnabled(true);
    this.endExclusiveAction();
  }

  thinBuildPointerDown(e) {
    if (e.button !== 2) return; // only the right button draws; left/middle still orbit
    var action = this.exclusiveAction;
    if (action.block != null) return; // already dragging one out

    var raw = app.mouse.getPositionOnPlane(e, this.currentZ);
    if (raw == null) return;
    var pos = this.snapPoint({ x: raw.x, y: raw.y, z: this.currentZ }, null);

    var type = this.selectedObjectType;
    var block = app.level.entityFactory.createObject(type);
    app.level.setObjectProperties(block, {
      class: type,
      isStatic: true,
      position: { x: pos.x, y: pos.y, z: this.currentZ },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: app.BOX_SIZE, y: app.BOX_SIZE, z: app.BOX_SIZE }
    });
    app.level.addObject(block);

    action.block = block;
    action.origin = pos;
  }

  thinBuildPointerMove(e) {
    var action = this.exclusiveAction;
    if (action.block == null) return; // no block yet: still waiting for pointerdown

    var raw = app.mouse.getPositionOnPlane(e, this.currentZ);
    if (raw == null) return;
    var origin = action.origin;
    var endX, endY;

    if (this.snapMode !== 'normal') {
      // Vertex-snap fully replaces grid-snap here: start from the raw endpoint, then type-match the strip's
      // own far end (the end actually being dragged) against other blocks' vertices/end-centres.
      endX = raw.x;
      endY = raw.y;
      var delta = this.closestTypedFarEndSnap(origin.x, origin.y, endX, endY, this.currentZ, app.BOX_SIZE, action.block);
      if (delta) { endX += delta.x; endY += delta.y; }
    }
    else {
      endX = app.mouse.snapToValue(raw.x, app.mouse.snap);
      endY = app.mouse.snapToValue(raw.y, app.mouse.snap);
    }

    var length = Math.hypot(endX - origin.x, endY - origin.y);
    var angle = Math.atan2(endY - origin.y, endX - origin.x);
    // Never collapse to a zero-length block; under vertex snap, honor a short-but-real snapped length (grid-snap floor would override a valid nearby vertex match).
    var minLength = this.snapMode !== 'normal' ? 0.001 : app.mouse.snap;
    length = Math.max(length, minLength);
    endX = origin.x + Math.cos(angle) * length;
    endY = origin.y + Math.sin(angle) * length;

    app.level.setObjectProperties(action.block, {
      position: { x: 0.5 * (origin.x + endX), y: 0.5 * (origin.y + endY), z: this.currentZ },
      rotation: { x: 0, y: 0, z: angle },
      scale: { x: length, y: app.BOX_SIZE, z: app.BOX_SIZE }
    });

    action.block.updateMatrixWorld();
    action.block.updateHelper();
  }

  thinBuildPointerUp(e) {
    if (e.button !== 2) return;
    var action = this.exclusiveAction;
    if (action.block == null) return; // no in-progress block (e.g. a right/middle click)

    // Finalize this block (one history entry per completed block) and start the next one.
    app.levelHistory.save('Added ' + action.block.getClass());
    action.block = null;
    action.origin = null;
  }

  // ============================== Multiselect: marquee-select a group of objects, then transform them together via "C". ==============================

  toggleMultiselect() {
    if (this.exclusiveAction?.name === 'multiselect') {
      this.cancelAction();
      return;
    }
    if (this.canPerformEditorAction() == false) return;
    this.startMultiselect();
  }

  // `purpose`: null for plain "M" multiselect, or 'chain' when reused by "P" (see armChainMode()).
  startMultiselect(purpose = null) {
    var action = this.startExclusiveAction('multiselect', {
      confirm: () => this.enterMultiselectRefine(),
      cancel: () => this.cleanupMultiselect(),
      purpose: purpose
    });
    this.setExclusiveActionStage('marquee');
    action.selected = [];
    action.marquee = { active: false, dragged: false, x1: 0, y1: 0, x2: 0, y2: 0 };
    action.controlBlock = null;
    action.originalStats = null;
    action.groupBox = null;
    action.historyIndex = null;
    action.scaleMode = 'free'; // 'free' | 'xy-locked' | 'xyz-locked'
    action.anchors = new Set(); // chain purpose only: blocks flagged static in the anchor stage (see enterChainAnchorStage)
    this.setOrbitLeftEnabled(false); // left = marquee; middle/right/wheel = camera
  }

  // Stage 2: precise add/remove by clicking individual objects.
  enterMultiselectRefine() {
    var action = this.exclusiveAction;
    if (action.stage !== 'marquee') return;
    this.setExclusiveActionStage('refine');
    // Chain purpose diverts after refine into anchor-marking instead of the normal transform stage (see keybinds.md "P").
    action.confirm = action.purpose === 'chain' ? () => this.enterChainAnchorStage() : () => this.enterMultiselectTransform();
    action.cancel = () => this.cleanupMultiselect();
    this.setOrbitLeftEnabled(true); // left-click toggles, left-drag pans the camera
    this.hideMarquee();
  }

  // Shared teardown for every exit path (cancel, group delete, editor-exit safety net).
  cleanupMultiselect() {
    var action = this.exclusiveAction;
    if (action == null || action.name !== 'multiselect') return;

    action.selected.forEach(obj => this.unhighlightObject(obj));
    if (action.controlBlock) {
      app.level.removeObject(action.controlBlock, true);
      action.controlBlock = null;
    }
    this.hideMarquee();
    app.level.deselectLevel();
    this.detachControls();
    app.selectedObject = null;
    this.clearCustomPivot(); // deselecting the group clears any custom pivot (see keybinds.md "." details)
    this.setOrbitLeftEnabled(true);        // restore left-button pan
    this.setOrbitInteractionEnabled(true); // in case Q was used mid-action
    this.endExclusiveAction();
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
    this.updateRender();
  }

  // ----- Marquee + refine stages: pointer handling -----

  multiselectPointerDown(e) {
    if (e.button !== 0) return; // only the left button selects; middle/right pan/rotate
    var m = this.exclusiveAction.marquee;
    m.active = true;
    m.dragged = false;
    m.x1 = m.x2 = e.clientX;
    m.y1 = m.y2 = e.clientY;
  }

  multiselectPointerMove(e) {
    var m = this.exclusiveAction.marquee;
    if (m.active == false) return;
    m.x2 = e.clientX;
    m.y2 = e.clientY;

    // Distinguish a drag from a click
    if (m.dragged == false && (Math.abs(m.x2 - m.x1) + Math.abs(m.y2 - m.y1)) <= 4) return;
    m.dragged = true;

    // Only the marquee stage draws a rectangle; in refine a left-drag is just a camera pan.
    if (this.isMultiselectMarquee()) {
      this.showMarquee();
      this.updateMarqueeRect(m.x1, m.y1, m.x2, m.y2);
      this.setMultiselectSelection(this.objectsInScreenRect(m.x1, m.y1, m.x2, m.y2));
    }
  }

  multiselectPointerUp(e) {
    var action = this.exclusiveAction;
    var m = action.marquee;
    if (m.active == false) return;
    m.active = false;
    this.hideMarquee();

    if (this.isMultiselectMarquee()) {
      // Stage 1: only a drag (re)selects; a plain click does nothing.
      if (m.dragged) this.setMultiselectSelection(this.objectsInScreenRect(m.x1, m.y1, e.clientX, e.clientY));
    }
    else if (this.isMultiselectRefine()) {
      // Stage 2: a plain click toggles the object under the cursor (a drag was just a camera pan).
      if (m.dragged == false) {
        var obj = app.mouse.clickObject(e);
        if (obj && obj.isCube === true && obj !== app.player) {
          var next = action.selected.indexOf(obj) === -1
            ? action.selected.concat([obj])
            : action.selected.filter(o => o !== obj);
          this.setMultiselectSelection(next);
        }
      }
    }
  }

  // Every non-player level block whose projected center lies inside the rect.
  objectsInScreenRect(x1, y1, x2, y2) {
    var left = Math.min(x1, x2), right = Math.max(x1, x2);
    var top = Math.min(y1, y2), bottom = Math.max(y1, y2);
    app.camera.updateMatrixWorld();

    var result = [];
    var children = app.level.children;
    for (var i = 0; i < children.length; i++) {
      var obj = children[i];
      if (obj.isCube !== true || obj === app.player) continue;
      if (obj === this.exclusiveAction?.controlBlock) continue;
      var s = this.projectToScreen(obj.position);
      if (s.x >= left && s.x <= right && s.y >= top && s.y <= bottom) result.push(obj);
    }
    return result;
  }

  // Project a world position to 2D screen (client) coordinates.
  projectToScreen(position) {
    _screenVec.set(position.x, position.y, position.z).project(app.camera);
    return {
      x: (_screenVec.x * 0.5 + 0.5) * app.window.innerWidth,
      y: (-_screenVec.y * 0.5 + 0.5) * app.window.innerHeight
    };
  }

  // Update the highlighted selection to exactly `objects`, diffing highlights.
  setMultiselectSelection(objects) {
    var action = this.exclusiveAction;
    action.selected.forEach(obj => { if (objects.indexOf(obj) === -1) this.unhighlightObject(obj); });
    objects.forEach(obj => { if (action.selected.indexOf(obj) === -1) this.highlightObject(obj); });
    action.selected = objects;
  }

  highlightObject(obj) {
    if (obj.getClass && obj.getClass() === 'player') return;
    if (obj._msOriginalColor == null) obj._msOriginalColor = obj.color;
    // White, or cyan if already white, for contrast; updateOrigin=false keeps the stored color intact.
    obj.setColors(obj._msOriginalColor === '#ffffff' ? '#00ffff' : '#ffffff', false);
    obj.updateMatrixWorld();
  }

  unhighlightObject(obj) {
    if (obj._msOriginalColor == null) return;
    obj.setColors(obj._msOriginalColor);
    obj.updateMatrixWorld();
    delete obj._msOriginalColor;
  }

  // ----- Marquee overlay (a plain DOM rectangle in screen space) -----

  ensureMarqueeElement() {
    if (this.marqueeElement) return this.marqueeElement;
    var el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.border = '1px solid #00ffff';
    el.style.background = 'rgba(0, 255, 255, 0.15)';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '9999';
    el.style.display = 'none';
    document.body.appendChild(el);
    this.marqueeElement = el;
    return el;
  }

  showMarquee() {
    this.ensureMarqueeElement().style.display = 'block';
  }

  updateMarqueeRect(x1, y1, x2, y2) {
    var el = this.ensureMarqueeElement();
    el.style.left = Math.min(x1, x2) + 'px';
    el.style.top = Math.min(y1, y2) + 'px';
    el.style.width = Math.abs(x2 - x1) + 'px';
    el.style.height = Math.abs(y2 - y1) + 'px';
  }

  hideMarquee() {
    if (this.marqueeElement) this.marqueeElement.style.display = 'none';
  }

  // ----- Transform stage: translucent control block + proportional remap -----

  enterMultiselectTransform() {
    var action = this.exclusiveAction;
    if (action.stage === 'transform') return; // already there
    if (action.selected.length === 0) return; // nothing captured: stay put

    // The translucent control block is the indicator now - drop the highlights
    action.selected.forEach(obj => this.unhighlightObject(obj));
    this.hideMarquee();

    // Snapshot each object's transform and compute the group's bounding box
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    action.originalStats = action.selected.map(obj => {
      minX = Math.min(minX, obj.position.x - 0.5 * Math.abs(obj.scale.x));
      maxX = Math.max(maxX, obj.position.x + 0.5 * Math.abs(obj.scale.x));
      minY = Math.min(minY, obj.position.y - 0.5 * Math.abs(obj.scale.y));
      maxY = Math.max(maxY, obj.position.y + 0.5 * Math.abs(obj.scale.y));
      minZ = Math.min(minZ, obj.position.z - 0.5 * Math.abs(obj.scale.z));
      maxZ = Math.max(maxZ, obj.position.z + 0.5 * Math.abs(obj.scale.z));
      return {
        x: obj.position.x, y: obj.position.y, z: obj.position.z,
        rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z,
        sx: obj.scale.x, sy: obj.scale.y, sz: obj.scale.z
      };
    });

    action.groupBox = {
      midX: 0.5 * (minX + maxX), midY: 0.5 * (minY + maxY), midZ: 0.5 * (minZ + maxZ),
      boxX: (maxX - minX) || app.BOX_SIZE, boxY: (maxY - minY) || app.BOX_SIZE, boxZ: (maxZ - minZ) || app.BOX_SIZE
    };

    // A custom pivot (".") overrides the group's rotation center by moving the control block itself there -
    // scale/translate for this transform session become relative to it too (documented tradeoff, see keybinds.md "." details).
    if (this.customPivot != null) {
      action.groupBox.midX = this.customPivot.x;
      action.groupBox.midY = this.customPivot.y;
      action.groupBox.midZ = this.customPivot.z;
    }

    // Preserve the pre-transform history point so confirm/cancel always resolve to one clean entry.
    if (action.historyIndex == null) action.historyIndex = app.levelHistory.historyIndex;

    var box = action.groupBox;
    var block = app.level.entityFactory.createObject('cube');
    app.level.setObjectProperties(block, {
      class: 'cube', color: '#00ffff', isStatic: true,
      position: { x: box.midX, y: box.midY, z: box.midZ },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: box.boxX, y: box.boxY, z: box.boxZ }
    });
    app.level.addObject(block);
    action.controlBlock = block;

    // Keep the control block translucent and cyan through normal selection (baseSelect would otherwise recolor it white); doesn't affect clicking.
    var baseSelect = block.select.bind(block);
    block.select = state => { baseSelect(state); block.shapes.setColors('#00ffff', false); block.shapes.setOpacities(0.2); };

    // Advance the stage before attaching so attachControls() correctly treats this as the group's control block
    // (isMultiselectTransform() must already be true here, or a custom pivot would wrongly route it through the pivot proxy).
    this.setExclusiveActionStage('transform');
    action.confirm = () => this.confirmMultiselectTransform();
    action.cancel = () => this.cancelMultiselectTransform();

    // Select it so the transform gizmo attaches.
    app.level.deselectLevel();
    app.selectedObject = block;
    block.select(true);
    this.attachControls(block);
    this.setOrbitLeftEnabled(true); // left-drag pans; the gizmo captures its handles

    window.dispatchEvent(new CustomEvent('setSelectedObject', { detail: block }));
    this.updateRender();
  }

  // Remap every selected object from the control block's transform: scale by box factors, rotate, then translate.
  updateGroupTransform() {
    var action = this.exclusiveAction;
    if (this.isMultiselectTransform() == false) return;
    var ctrl = action.controlBlock;
    if (ctrl == null) return;
    var box = action.groupBox;

    var factorX = ctrl.scale.x / box.boxX;
    var factorY = ctrl.scale.y / box.boxY;
    var factorZ = ctrl.scale.z / box.boxZ;

    // Apply scale mode constraints
    var scaleMode = action.scaleMode || 'free';
    if (scaleMode === 'xy-locked') {
      // Propagate whichever of X/Y is actually being dragged (furthest from 1) to the other, don't average them
      var xyFactor = Math.abs(factorX - 1) >= Math.abs(factorY - 1) ? factorX : factorY;
      factorX = xyFactor;
      factorY = xyFactor;
    }
    else if (scaleMode === 'xyz-locked') {
      // Propagate whichever axis is actually being dragged (furthest from 1) to the other two, don't average them
      var driveAxis = Math.abs(factorX - 1) >= Math.abs(factorY - 1) ? 'x' : 'y';
      if (Math.abs(factorZ - 1) > Math.abs(driveAxis === 'x' ? factorX - 1 : factorY - 1)) driveAxis = 'z';
      var allFactor = driveAxis === 'x' ? factorX : (driveAxis === 'y' ? factorY : factorZ);
      factorX = allFactor;
      factorY = allFactor;
      factorZ = allFactor;
    }

    // Keep the selection box's own displayed scale in sync with the locked factors, not just the raw drag.
    if (scaleMode !== 'free') {
      ctrl.setScale({ x: box.boxX * factorX, y: box.boxY * factorY, z: box.boxZ * factorZ }, true);
      ctrl.updateMatrixWorld();
      ctrl.updateHelper();
    }

    for (var i = 0; i < action.selected.length; i++) {
      var obj = action.selected[i];
      var o = action.originalStats[i];

      var rel = this.rotatePointForGroup(
        factorX * (o.x - box.midX),
        factorY * (o.y - box.midY),
        factorZ * (o.z - box.midZ),
        ctrl.rotation
      );

      obj.setScale({ x: o.sx * factorX, y: o.sy * factorY, z: o.sz * factorZ }, true);
      obj.setRotation({ x: o.rx + ctrl.rotation.x, y: o.ry + ctrl.rotation.y, z: o.rz + ctrl.rotation.z }, true);
      obj.setPosition({ x: rel[0] + ctrl.position.x, y: rel[1] + ctrl.position.y, z: rel[2] + ctrl.position.z }, true);
      obj.updateMatrixWorld();
      obj.updateHelper();
    }
    this.updateRender();
  }

  // Restore every selected object to its snapshot (used on cancel).
  revertGroupTransform() {
    var action = this.exclusiveAction;
    if (action == null || action.originalStats == null) return;
    for (var i = 0; i < action.selected.length; i++) {
      var obj = action.selected[i];
      var o = action.originalStats[i];
      obj.setScale({ x: o.sx, y: o.sy, z: o.sz }, true);
      obj.setRotation({ x: o.rx, y: o.ry, z: o.rz }, true);
      obj.setPosition({ x: o.x, y: o.y, z: o.z }, true);
      obj.updateMatrixWorld();
      obj.updateHelper();
    }
  }

  // Rotate a point by the given Euler angles: apply Z, then Y, then X.
  rotatePointForGroup(x, y, z, rotation) {
    var cos, sin, nx, ny, nz;
    cos = Math.cos(rotation.z); sin = Math.sin(rotation.z);
    nx = cos * x - sin * y; ny = sin * x + cos * y; x = nx; y = ny;
    cos = Math.cos(rotation.y); sin = Math.sin(rotation.y);
    nx = cos * x + sin * z; nz = -sin * x + cos * z; x = nx; z = nz;
    cos = Math.cos(rotation.x); sin = Math.sin(rotation.x);
    ny = cos * y - sin * z; nz = sin * y + cos * z; y = ny; z = nz;
    return [x, y, z];
  }

  confirmMultiselectTransform() {
    // Objects are already at their transformed positions - drop the control block and collapse history into one entry.
    var idx = this.exclusiveAction.historyIndex;
    this.cleanupMultiselect();
    if (idx != null) {
      this.truncateHistory(idx);
      app.levelHistory.save('Multiselect transform');
    }
  }

  cancelMultiselectTransform() {
    var idx = this.exclusiveAction.historyIndex;
    this.revertGroupTransform();
    this.cleanupMultiselect();
    if (idx != null) this.truncateHistory(idx); // back to the pre-transform state
  }

  cycleMultiselectScaleMode() {
    var action = this.exclusiveAction;
    if (this.isMultiselectTransform() == false) return;
    var modes = ['free', 'xy-locked', 'xyz-locked'];
    var currentIndex = modes.indexOf(action.scaleMode || 'free');
    action.scaleMode = modes[(currentIndex + 1) % modes.length];
    this.updateGroupTransform();
  }

  deleteMultiselectGroup() {
    var action = this.exclusiveAction;
    var idx = action.historyIndex;
    action.selected.forEach(obj => app.level.removeObject(obj, true));
    action.selected = [];
    action.originalStats = null;
    this.cleanupMultiselect();
    if (idx != null) {
      this.truncateHistory(idx);
      app.levelHistory.save('Deleted group');
    }
  }

  duplicateMultiselectGroup() {
    var action = this.exclusiveAction;

    // Duplicate each selected object; the offset copies become the new selection with a fresh transform stage.
    var copies = action.selected.map(obj => app.level.duplicateObject(obj));
    copies.forEach(copy => {
      copy.setPosition({
        x: copy.position.x + this.duplicateOffset.x,
        y: copy.position.y + this.duplicateOffset.y,
        z: copy.position.z
      }, true);
      copy.updateMatrixWorld();
      copy.updateHelper();
    });

    if (action.controlBlock) {
      app.level.removeObject(action.controlBlock, true);
      action.controlBlock = null;
    }
    app.level.deselectLevel();

    action.selected = copies;
    action.stage = 'refine';   // any non-transform stage so enterMultiselectTransform() proceeds
    this.enterMultiselectTransform();
  }

  // "D" held mid-drag: stamp a duplicate at the current location without interrupting the live drag or applying an offset.
  stampMultiselectGroupDuplicate() {
    var action = this.exclusiveAction;
    action.selected.forEach(obj => app.level.duplicateObject(obj));
    this.updateRender();
  }

  // "I" during a group transform toggles intangibility for the whole selection, keeping the snapshot's z in sync.
  toggleGroupIntangibility() {
    var action = this.exclusiveAction;
    this.toggleIntangibility(action.selected);
    action.selected.forEach((obj, i) => {
      if (action.originalStats && action.originalStats[i]) action.originalStats[i].z = obj.position.z;
    });
  }

  truncateHistory(index) {
    app.levelHistory.history.length = index + 1;
    app.levelHistory.historyIndex = index;
  }

  isSnapped() {
    var distance = this.down.distanceTo(this.move);
    return distance < this.snap;
  }

  // ============================== "," Vertex/end snapping ==============================

  // ",": cycles vertex/end snapping mode 'normal' -> 'vertex' -> 'centre' -> 'normal' (see keybinds.md).
  // 'vertex': only vertex-vertex matching. 'centre': only end-centre-to-end-centre matching. Never both at once.
  cycleSnapMode() {
    this.snapMode = this.snapMode === 'normal' ? 'vertex' : this.snapMode === 'vertex' ? 'centre' : 'normal';
    window.dispatchEvent(new CustomEvent('snapModeChanged', { detail: { mode: this.snapMode } }));
  }

  // Nearest vertex/end-center among every other block, within a tolerance relative to grid size; null if none in range.
  // Candidates are restricted to `this.snapMode`: only vertices when 'vertex', only end-candidates when 'centre'.
  // ignoreZ: exclude Z from the distance/tolerance check (for callers that don't want the matched Z, e.g. snapPoint
  // with snapZ=false) - otherwise a fixed build-height point would consume the whole tolerance in Z alone.
  snapToNearestVertex(point, exclude, ignoreZ = false) {
    var tolerance = app.BOX_SIZE * 0.5; // reasonable snap radius relative to the grid unit
    var best = null, bestDist = tolerance;
    var children = app.level.children;
    for (var i = 0; i < children.length; i++) {
      var obj = children[i];
      if (obj.isCube !== true || obj === app.player || obj === exclude) continue;
      if (this.exclusiveAction?.controlBlock === obj) continue; // never snap to the (transient) multiselect control block
      var candidates;
      if (this.snapMode === 'vertex') candidates = app.util.getBlockEndPoints(obj).vertices;
      else if (this.snapMode === 'centre') candidates = app.util.getBlockEndCandidates(obj).points;
      else candidates = [];
      for (var j = 0; j < candidates.length; j++) {
        var c = candidates[j];
        var d = ignoreZ ? Math.hypot(point.x - c.x, point.y - c.y) : Math.hypot(point.x - c.x, point.y - c.y, point.z - c.z);
        if (d < bestDist) { bestDist = d; best = c; }
      }
    }
    return best;
  }

  // Closest vertex/end-centre PAIR between `obj`'s own 8 vertices/6 end-centres and every other block's -
  // restricted to the current `this.snapMode`: only the vertex-vertex pass runs in 'vertex' mode, only the
  // centre-centre pass runs in 'centre' mode (never both), within a tolerance relative to grid size; null if
  // none in range. Shared by translate/Q-drag/scale vertex snapping (see keybinds.md ",").
  closestVertexSnapMatch(obj) {
    var tolerance = app.BOX_SIZE * 0.5; // reasonable snap radius relative to the grid unit
    var matchVertices = this.snapMode === 'vertex';
    var matchCentres = this.snapMode === 'centre';
    var moving = matchVertices ? app.util.getBlockEndPoints(obj) : null;
    var movingEnds = matchCentres ? app.util.getBlockEndCandidates(obj) : null;
    var movingVertices = matchVertices ? moving.vertices.map((p, i) => ({ point: p, local: moving.localVertices[i] })) : [];
    var movingCentres = matchCentres ? movingEnds.points.map((p, i) => ({ point: p, local: movingEnds.locals[i] })) : [];

    var best = null, bestDist = tolerance;
    var children = app.level.children;
    for (var i = 0; i < children.length; i++) {
      var other = children[i];
      if (other.isCube !== true || other === app.player || other === obj) continue;
      if (this.exclusiveAction?.controlBlock === other) continue; // never snap to the (transient) multiselect control block

      if (matchVertices) {
        var points = app.util.getBlockEndPoints(other);
        for (var m = 0; m < movingVertices.length; m++) {
          var mc = movingVertices[m];
          for (var t = 0; t < points.vertices.length; t++) {
            var tp = points.vertices[t];
            var d = Math.hypot(mc.point.x - tp.x, mc.point.y - tp.y, mc.point.z - tp.z);
            if (d < bestDist) { bestDist = d; best = { moving: mc.point, local: mc.local, target: tp }; }
          }
        }
      }
      if (matchCentres) {
        var otherEnds = app.util.getBlockEndCandidates(other);
        for (var c = 0; c < movingCentres.length; c++) {
          var mcc = movingCentres[c];
          for (var t2 = 0; t2 < otherEnds.points.length; t2++) {
            var tp2 = otherEnds.points[t2];
            var d2 = Math.hypot(mcc.point.x - tp2.x, mcc.point.y - tp2.y, mcc.point.z - tp2.z);
            if (d2 < bestDist) { bestDist = d2; best = { moving: mcc.point, local: mcc.local, target: tp2 }; }
          }
        }
      }
    }
    return best;
  }

  // Type-restricted snap for the FAR end of an in-progress thin-build strip, restricted to the current
  // `this.snapMode`: only far vertices are computed/compared in 'vertex' mode, only the far centre in 'centre'
  // mode (never both). Builds a virtual block descriptor for what the strip would look like at the given
  // origin/end, considers only its far-end vertices/centre (local x > 0 - the end actually being dragged, not
  // the fixed origin end), and returns the world-space delta needed to align the closest same-type match, or
  // null if none in range.
  closestTypedFarEndSnap(originX, originY, endX, endY, z, width, exclude) {
    var length = Math.hypot(endX - originX, endY - originY);
    var angle = Math.atan2(endY - originY, endX - originX);
    var centerX = 0.5 * (originX + endX), centerY = 0.5 * (originY + endY);

    var virtual = {
      position: new Vector3(centerX, centerY, z),
      scale: { x: length, y: width, z: width },
      rotation: new Euler(0, 0, angle, 'XYZ')
    };
    var matchVertices = this.snapMode === 'vertex';
    var matchCentres = this.snapMode === 'centre';
    var vPoints = app.util.getBlockEndPoints(virtual);
    var farVertices = matchVertices ? vPoints.vertices.filter((p, i) => vPoints.localVertices[i].x > 0) : [];
    var farCentres = matchCentres ? vPoints.endCentres.filter((p, i) => vPoints.localEndCentres[i].x > 0) : [];

    var tolerance = app.BOX_SIZE * 0.5;
    var best = null, bestDist = tolerance;
    var children = app.level.children;
    for (var i = 0; i < children.length; i++) {
      var other = children[i];
      if (other.isCube !== true || other === app.player || other === exclude) continue;
      if (this.exclusiveAction?.controlBlock === other) continue;

      if (matchVertices) {
        var points = app.util.getBlockEndPoints(other);
        for (var v = 0; v < farVertices.length; v++) {
          for (var t = 0; t < points.vertices.length; t++) {
            var d = farVertices[v].distanceTo(points.vertices[t]);
            if (d < bestDist) { bestDist = d; best = points.vertices[t].clone().sub(farVertices[v]); }
          }
        }
      }
      if (matchCentres) {
        var otherEnds = app.util.getBlockEndCandidates(other);
        for (var c = 0; c < farCentres.length; c++) {
          for (var t2 = 0; t2 < otherEnds.points.length; t2++) {
            var d2 = farCentres[c].distanceTo(otherEnds.points[t2]);
            if (d2 < bestDist) { bestDist = d2; best = otherEnds.points[t2].clone().sub(farCentres[c]); }
          }
        }
      }
    }
    return best; // a Vector3 delta, or null
  }

  // Vertex/end-centre snap for a rigid translate (position only, no scale/rotation change) - considers every one of
  // `obj`'s own vertices/end-centres against every other block's, and snaps to whichever pair is closest.
  // Shared by the translate gizmo and Q drag-to-move (see keybinds.md ",").
  applyClosestVertexSnap(obj) {
    var match = this.closestVertexSnapMatch(obj);
    if (match == null) return;
    obj.setPosition({
      x: obj.position.x + (match.target.x - match.moving.x),
      y: obj.position.y + (match.target.y - match.moving.y),
      z: obj.position.z + (match.target.z - match.moving.z)
    });
    obj.updateMatrixWorld();
    obj.updateHelper();
  }

  // Vertex/end-centre snap for a scale drag: TransformControls scale is symmetric about the object's own center, so a
  // matched vertex/end-centre is corrected by adjusting scale (not position), doubled since both sides of center move
  // oppositely, along whichever local axes the matched point actually extends along, gated to the axis/axes of the
  // active gizmo handle so snapping doesn't touch axes the user isn't dragging (see keybinds.md ",").
  applyVertexSnapToScale(obj) {
    var match = this.closestVertexSnapMatch(obj);
    if (match == null) return;

    var deltaWorld = new Vector3(match.target.x - match.moving.x, match.target.y - match.moving.y, match.target.z - match.moving.z);
    var deltaLocal = deltaWorld.applyQuaternion(obj.quaternion.clone().invert());
    var local = match.local;
    var axis = this.controlsTransform.axis || 'XYZ';

    if (local.x !== 0 && axis.includes('X')) obj.scale.x += 2 * deltaLocal.x * Math.sign(local.x);
    if (local.y !== 0 && axis.includes('Y')) obj.scale.y += 2 * deltaLocal.y * Math.sign(local.y);
    if (local.z !== 0 && axis.includes('Z')) obj.scale.z += 2 * deltaLocal.z * Math.sign(local.z);

    obj.updateMatrixWorld();
    obj.updateHelper();
  }

  // Vertex/end-centre snap for a putty drag. Dragging the line moves both endpoints together (a rigid translate,
  // same closest-pair-of-all-vertices logic as the translate gizmo/Q-drag); dragging a single point only moves that
  // one face-centre, so it alone is compared against every other block's vertices/end-centres (see keybinds.md ",").
  applyVertexSnapToPutty() {
    var putty = this.controlsPutty;
    var pointObj = putty.activePoint;
    var obj = app.selectedObject;
    if (pointObj == null || obj == null) return;

    if (pointObj.isLine) {
      this.applyClosestVertexSnap(obj);
      putty.updateHelper(); // re-derive pointA/pointB from the corrected object position
      return;
    }

    var world = new Vector3();
    pointObj.getWorldPosition(world);
    var near = this.snapToNearestVertex(world, obj);
    if (near == null) return;

    var local = new Vector3(near.x, near.y, near.z);
    pointObj.parent.worldToLocal(local);
    pointObj.position.copy(local);
    putty.updateLineFromPoints();
    putty.updateObjectFromPoints();
  }

  // Snaps a placement/drag point to the nearest vertex/end-center (if vertex-snap is on and one's in range),
  // else falls back to the plain grid snap - z is only ever moved by an actual vertex match (`snapZ`), never grid-snapped.
  // When vertex-snap is on with no match, the point is used raw - grid-snap never runs as a fallback.
  snapPoint(point, exclude, snapZ = false) {
    if (this.snapMode !== 'normal') {
      var near = this.snapToNearestVertex(point, exclude, !snapZ);
      if (near) return { x: near.x, y: near.y, z: snapZ ? near.z : point.z };
      return { x: point.x, y: point.y, z: point.z };
    }
    return {
      x: app.mouse.snapToValue(point.x, app.mouse.snap),
      y: app.mouse.snapToValue(point.y, app.mouse.snap),
      z: point.z
    };
  }

  // Vertex-snaps the current selection's position after a translate gizmo drag (overrides its built-in grid snap).
  applyVertexSnapToSelection() {
    this.applyClosestVertexSnap(app.selectedObject);
  }

  // ============================== "." Custom rotation pivot ==============================

  // ".": arms custom-pivot placement; the next click resolves a 3D point which becomes the pivot (see keybinds.md).
  armCustomPivot() {
    if (this.canPerformEditorAction() == false) return;
    this.startExclusiveAction('set-pivot', { cancel: () => this.endExclusiveAction() });
  }

  // Click while armed: resolve a 3D point on the current-Z plane and set it as the custom rotation pivot.
  resolveCustomPivotClick(e) {
    // Consumed exclusively for pivot placement - endExclusiveAction() below runs before Mouse.mouseUp's
    // own pointerup listener fires, so this flag (not just isVanillaClickingSuppressed) stops that second
    // listener from falling through to normal select/deselect handling on the same click.
    e.editorClickHandled = true;
    var point = app.mouse.getPositionOnPlane(e, this.currentZ);
    if (point) this.setCustomPivot({ x: point.x, y: point.y, z: point.z });
    this.endExclusiveAction();
  }

  setCustomPivot(point) {
    this.customPivot = point;
    this.showPivotMarker();
    window.dispatchEvent(new CustomEvent('customPivotSet', { detail: point }));
    // Re-attach immediately so an already-active rotate gizmo picks up the new pivot without reselecting.
    if (this.selectedMode === 'rotate' && app.selectedObject) this.attachControls(app.selectedObject);
  }

  // Clears the custom pivot: on deselect, or once a non-rotate transform actually completes (see keybinds.md).
  clearCustomPivot() {
    if (this.customPivot == null) return;
    this.customPivot = null;
    this.hidePivotMarker();
    window.dispatchEvent(new CustomEvent('customPivotCleared'));
    // Falling back to the object's own origin/group bbox center needs a normal (non-proxy) re-attach.
    if (app.selectedObject) this.attachControls(app.selectedObject);
  }

  ensurePivotMarker() {
    if (this.pivotMarkerMesh) return this.pivotMarkerMesh;
    var geometry = new SphereGeometry(3, 12, 12);
    var material = new MeshBasicMaterial({ color: '#ffaa00' });
    var mesh = new Mesh(geometry, material);
    mesh.visible = false;
    app.scene.add(mesh);
    this.pivotMarkerMesh = mesh;
    return mesh;
  }

  showPivotMarker() {
    var mesh = this.ensurePivotMarker();
    mesh.position.set(this.customPivot.x, this.customPivot.y, this.customPivot.z);
    mesh.visible = true;
    mesh.updateMatrixWorld();
  }

  hidePivotMarker() {
    if (this.pivotMarkerMesh) this.pivotMarkerMesh.visible = false;
  }

  // Remaps the real rotate target from the invisible pivot proxy's accumulated rotation (reuses the multiselect group-rotation math).
  updatePivotRotation() {
    var proxy = this.pivotProxy;
    var target = this.pivotProxyTarget;
    var snap = this.pivotProxySnapshot;
    var rel = this.rotatePointForGroup(snap.x - proxy.position.x, snap.y - proxy.position.y, snap.z - proxy.position.z, proxy.rotation);

    target.setPosition({ x: rel[0] + proxy.position.x, y: rel[1] + proxy.position.y, z: rel[2] + proxy.position.z }, true);
    target.setRotation({ x: snap.rx + proxy.rotation.x, y: snap.ry + proxy.rotation.y, z: snap.rz + proxy.rotation.z }, true);
    target.updateMatrixWorld();
    target.updateHelper();
  }

  updateRender() {
    // Only force render level editor if app is paused
    if (app.state == 'level-editor' && app.play == false) {
      // Manually update matrices for edited objects (scene.matrixWorldAutoUpdate is off)
      if (app.selectedObject) app.selectedObject.updateMatrixWorld();
      this.controlsTransform.getHelper().updateMatrixWorld();
      this.controlsPutty.getHelper().updateMatrixWorld();
      app.camera.updateMatrixWorld();
      app.graphics.render();
    }
    this.renderGrid();
  }

  // ----- Visual grid (level editor only): a 2D canvas overlay drawn at app.BOX_SIZE spacing on the current Z plane -----

  ensureGridCanvas() {
    if (this.gridCanvas) return this.gridCanvas;
    var canvas = document.createElement('canvas');
    canvas.className = 'level-editor-grid';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '0';
    document.body.appendChild(canvas);
    this.gridCanvas = canvas;
    this.gridContext = canvas.getContext('2d');
    return canvas;
  }

  // Unprojects a screen point (pixels) onto the world plane z = planeZ
  unprojectToPlane(screenX, screenY, planeZ) {
    var raycaster = new Raycaster();
    var ndc = new Vector2((screenX / app.window.innerWidth) * 2 - 1, -(screenY / app.window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, app.camera);
    var plane = new Plane(new Vector3(0, 0, 1), -planeZ);
    var pos = new Vector3();
    var hit = raycaster.ray.intersectPlane(plane, pos);
    return hit ? pos : null;
  }

  renderGrid() {
    var settings = app.storage.getSettings();
    var visible = settings.visualGrid === true && (app.state == 'level-editor' || app.state == 'level-manager') && app.play == false;
    var canvas = this.ensureGridCanvas();
    canvas.style.display = visible ? 'block' : 'none';
    if (visible == false) return;

    canvas.width = app.window.innerWidth;
    canvas.height = app.window.innerHeight;
    var ctx = this.gridContext;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Find the world-space rectangle visible on the current Z plane by unprojecting the four screen corners
    var z = this.currentZ || 0;
    var corners = [
      this.unprojectToPlane(0, 0, z),
      this.unprojectToPlane(canvas.width, 0, z),
      this.unprojectToPlane(0, canvas.height, z),
      this.unprojectToPlane(canvas.width, canvas.height, z)
    ].filter(function(p) { return p != null; });
    if (corners.length < 4) return; // camera looking away from the plane

    var minX = Math.min.apply(null, corners.map(function(p) { return p.x; }));
    var maxX = Math.max.apply(null, corners.map(function(p) { return p.x; }));
    var minY = Math.min.apply(null, corners.map(function(p) { return p.y; }));
    var maxY = Math.max.apply(null, corners.map(function(p) { return p.y; }));

    var size = app.BOX_SIZE;
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
    ctx.lineWidth = 1;

    var startX = Math.floor(minX / size) * size;
    for (var x = startX; x <= maxX; x += size) {
      var p1 = this.projectToScreen({ x: x, y: minY, z: z });
      var p2 = this.projectToScreen({ x: x, y: maxY, z: z });
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    var startY = Math.floor(minY / size) * size;
    for (var y = startY; y <= maxY; y += size) {
      var q1 = this.projectToScreen({ x: minX, y: y, z: z });
      var q2 = this.projectToScreen({ x: maxX, y: y, z: z });
      ctx.beginPath();
      ctx.moveTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.stroke();
    }
  }

  mouseDown(e) {
    app.mouse.setPosition('down', app.mouse.getPosition(e));

    // Update snap settings for putty controls
    this.controlsPutty.moved = false;
    // Vertex/end snap overrides putty's own built-in grid snap while active (applied post-drag, see objectChange above).
    this.controlsPutty.snap = this.snapMode !== 'normal' ? null : app.mouse.snap;

    // Update transform controls snap settings
    this.controlsTransform.moved = false;
    // Vertex/end snap overrides the gizmo's built-in grid translation/scale snap while active (applied post-drag, see objectChange above).
    this.controlsTransform.setTranslationSnap(this.snapMode !== 'normal' ? null : app.mouse.snap);
    this.controlsTransform.setScaleSnap(this.snapMode !== 'normal' ? null : app.mouse.snap);
    this.controlsTransform.setRotationSnap(app.mouse.snap > 1 ? (Math.PI / 12) : null); // 15 degrees or granular (null)
  }

  mouseMove(e) {
    app.mouse.setPosition('move', app.mouse.getPosition(e));
    this.updateHoverPreview(e);
  }

  mouseUp(e) {
    var target = app.mouse.clickObject(e);
    app.mouse.setPosition('up', app.mouse.getPosition(e));

    // Allow quick erase
    if (e.button == 2) app.mouse.mode = 'erase';

    // Check if drawing or erasing
    if (app.mouse.mode == 'draw') {
      // Check if object is not selected
      if (app.selectedObject == null || target) {
        // Select a new object on start click
        if (target && this.forceBuildEnabled == false) {
          // Copy selected object color to target color
          if (e.shiftKey === true) {
            // During a group transform, copy the clicked block's color onto every selected block (never the control block).
            if (this.isMultiselectTransform()) {
              var action = this.exclusiveAction;
              if (target !== action.controlBlock) {
                // No history entry here - recoloring is folded into the transform's own single entry on confirm/cancel.
                action.selected.forEach(obj => {
                  obj.setColors(target.color);
                  obj.setOpacity(target.getOpacity());
                  if (obj.getClass() === 'cube') obj.setDeathBlock(target.getDeathBlock());
                });
                this.updateRender();
              }
              return;
            }
            if (app.selectedObject) {
              target.setColors(app.selectedObject.color);
              target.setOpacity(app.selectedObject.getOpacity());
              if (target.getClass() === 'cube') target.setDeathBlock(app.selectedObject.getDeathBlock());
              app.levelHistory.save('Copied color');
              this.updateRender();
              return;
            }
          }

          if (this.controlsTransform.moved == false &&
            this.controlsOrbit.moved == false &&
            this.controlsPutty.moved == false) {
            app.level.deselectLevel();
            this.clearCustomPivot(); // switching selection clears any custom pivot from the previous block
            app.selectedObject = target;
            app.selectedObject.select(true);
            this.attachControls(target);

            // Update Vue.js UI from custom event
            if (app.selectedObject.getClass() != 'player') window.dispatchEvent(new CustomEvent('selectObjectType', { detail: { type: app.selectedObject.getClass(), checkNull: false }}));
            window.dispatchEvent(new CustomEvent('setSelectedObject', { detail: app.selectedObject }));
          }
        }
        else {
          // Add a new object if camera did not move
          if (this.controlsOrbit.moved == false && this.isSnapped()) {
            var objectType = this.selectedObjectType;
            var placePos = this.snapPoint({ x: app.mouse.down.x, y: app.mouse.down.y, z: this.currentZ }, null, true);
            var objectData = {
              class: objectType,
              color: app.level.entityFactory.color,
              isStatic: true,
              position: { x: placePos.x, y: placePos.y, z: placePos.z },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: app.BOX_SIZE, y: app.BOX_SIZE, z: app.BOX_SIZE }
            };
            app.level.deselectLevel(); // Deselect everything
            app.selectedObject = app.level.entityFactory.createObject(objectType);
            app.level.setObjectProperties(app.selectedObject, objectData);
            app.level.addObject(app.selectedObject);
            app.levelHistory.save('Added ' + objectType);
            app.selectedObject.select(true);
            this.attachControls(app.selectedObject);
            window.dispatchEvent(new CustomEvent('setSelectedObject', { detail: app.selectedObject }));
          }
        }
      }
      else {
        // Deselect if object and camera was not moved
        if (this.controlsTransform.moved == false &&
          this.controlsOrbit.moved == false &&
          this.controlsPutty.moved == false &&
          this.isSnapped()) {
          app.level.deselectLevel();
          this.detachControls();
          this.clearCustomPivot(); // deselecting clears any custom pivot (see keybinds.md "." details)
          window.dispatchEvent(new CustomEvent('setSelectedObject'));
        }
      }
    }
    else if (app.mouse.mode == 'erase') {
      this.eraseTarget(e);
    }

    // Reset mouse mode after quick erase
    if (e.button == 2) app.mouse.mode = app.mouse.prevMode;
  }

  // Deselect the currently selected block, equivalent to clicking on the void.
  deselectCurrentObject() {
    if (this.canPerformEditorAction() == false) return;
    if (app.selectedObject == null) return;

    app.level.deselectLevel();
    this.detachControls();
    this.clearCustomPivot(); // deselecting clears any custom pivot (see keybinds.md "." details)
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
  }

  eraseTarget(e) {
    var target = app.mouse.clickObject(e);
    if (target != null) {
      if (target.getClass() != 'player') {
        target.select(true);
        app.level.removeObject(target, true);
      }
    }
  }

  duplicateSelectedObject(offset = { x: 0, y: 0, z: 0 }) {
    // During multiselect, "D" acts on the whole group (transform stage only) - return before the selectedObject deref below.
    if (this.exclusiveAction?.name === 'multiselect') {
      if (this.exclusiveAction.stage === 'transform') {
        // Mid-translate-drag: stamp a copy at the current drag location instead of ending the transform.
        if (this.controlsTransform.dragging && this.selectedMode === 'translate') this.stampMultiselectGroupDuplicate();
        else this.duplicateMultiselectGroup();
      }
      return;
    }

    const isPlayerSelected = app.selectedObject.getClass() == 'player';
    if (app.selectedObject && !isPlayerSelected) {
      // Update object select state before duplication
      app.selectedObject.select(false);
      app.selectedObject = app.level.duplicateObject(app.selectedObject);

      // Add offset and update position
      app.selectedObject.position.add(offset);
      app.selectedObject.setPosition(app.selectedObject.position);
      app.selectedObject.select(true);

      // Update Vue.js UI from custom event
      this.attachControls(app.selectedObject);
      app.levelHistory.save('Duplicated object');
    }
  }

  deleteSelectedObject() {
    // During multiselect, "X" deletes the whole group (transform stage only) - but only if the
    // targeted object is actually the group (control block or a selected member); a separate block
    // clicked outside the group while transform is active should just delete itself instead.
    if (this.exclusiveAction?.name === 'multiselect') {
      if (this.exclusiveAction.stage === 'transform') {
        var action = this.exclusiveAction;
        var target = app.selectedObject;
        var isGroupTarget = target != null && (target === action.controlBlock || action.selected.includes(target));
        if (target != null && isGroupTarget == false) {
          app.level.removeObject(target, true);
          app.levelEditor.detachControls();
          app.selectedObject = null;
          app.levelHistory.save('Deleted object');
          window.dispatchEvent(new CustomEvent('setSelectedObject'));
        }
        else this.deleteMultiselectGroup();
      }
      return;
    }

    if (app.selectedObject) {
      app.level.removeObject(app.selectedObject, true);
      app.levelEditor.detachControls();
      app.levelHistory.save('Deleted object');
      window.dispatchEvent(new CustomEvent('setSelectedObject'));
    }
  }

  // "B" chord key: arms indefinitely; a second B flips XZ, otherwise the chord lapses (see keydown).
  handleChordB() {
    if (this.chordPending === 'B') {
      this.chordPending = null;
      window.dispatchEvent(new CustomEvent('flipChordCleared'));
      this.flipSelection('xz');
    }
    else {
      this.chordPending = 'B';
      window.dispatchEvent(new CustomEvent('flipChordArmed'));
    }
  }

  // "N": completes a pending "B,N" chord (flip YZ); alone, toggles force-build mode.
  handleChordN() {
    if (this.chordPending === 'B') {
      this.chordPending = null;
      window.dispatchEvent(new CustomEvent('flipChordCleared'));
      this.flipSelection('yz');
    }
    else {
      this.forceBuildEnabled = !this.forceBuildEnabled;
      window.dispatchEvent(new CustomEvent(this.forceBuildEnabled ? 'forceBuildEnabled' : 'forceBuildDisabled'));
    }
  }

  // "/" arms cut-out mode; requires a block already selected as the cut target.
  enterCutOutMode() {
    if (app.selectedObject == null) return;
    if (this.canPerformEditorAction() == false) return;

    var action = this.startExclusiveAction('cut-out');
    action.target = app.selectedObject;
    app.level.deselectLevel();
    this.detachControls();
    app.selectedObject = null;
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
  }

  // Cutter click while cut-out is armed: performs the cut immediately (single click, no confirm step).
  cutOutPointerUp(e) {
    e.editorClickHandled = true;
    var action = this.exclusiveAction;
    var cutter = app.mouse.clickObject(e);
    if (cutter == null || cutter === action.target) {
      this.cancelAction();
      return;
    }
    this.performCutOut(action.target, cutter);
    this.endExclusiveAction();
  }

  // 2D rotated-footprint subtraction: replaces `target` (A) with up to 4 pieces covering its
  // footprint minus the bounding box (in A's local frame) of `cutter` (B); both A and B are deleted.
  performCutOut(target, cutter) {
    // The algorithm is 2D-only; any tilt on either block (x/y rotation) can't be handled
    if (target.rotation.x !== 0 || target.rotation.y !== 0 || cutter.rotation.x !== 0 || cutter.rotation.y !== 0) {
      this.showCutOutError();
      return;
    }

    var EPS = 0.01;
    var az = target.rotation.z;
    var cos = Math.cos(az), sin = Math.sin(az);

    // Rotates a local-frame vector (lx, ly) by `az` into world space (forward rotation)
    var rotateFwd = (lx, ly) => ({ x: cos * lx - sin * ly, y: sin * lx + cos * ly });
    // Rotates a world-space offset back into A's local frame (inverse rotation)
    var rotateInv = (wx, wy) => ({ x: cos * wx + sin * wy, y: -sin * wx + cos * wy });

    // B's 4 corners in world space
    var bcos = Math.cos(cutter.rotation.z), bsin = Math.sin(cutter.rotation.z);
    var hx = cutter.scale.x / 2, hy = cutter.scale.y / 2;
    var corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([lx, ly]) => ({
      x: cutter.position.x + (bcos * lx - bsin * ly),
      y: cutter.position.y + (bsin * lx + bcos * ly)
    }));

    // Transform B's corners into A's local frame and take their bounds -> block C (abstract, never instantiated)
    var cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity;
    corners.forEach(corner => {
      var rel = rotateInv(corner.x - target.position.x, corner.y - target.position.y);
      cMinX = Math.min(cMinX, rel.x); cMaxX = Math.max(cMaxX, rel.x);
      cMinY = Math.min(cMinY, rel.y); cMaxY = Math.max(cMaxY, rel.y);
    });

    var aHalfX = target.scale.x / 2, aHalfY = target.scale.y / 2;

    // C must be strictly smaller than A on both axes, and must overlap A
    var smallerThanA = (cMaxX - cMinX) < target.scale.x && (cMaxY - cMinY) < target.scale.y;
    var overlapsA = cMinX < aHalfX && cMaxX > -aHalfX && cMinY < aHalfY && cMaxY > -aHalfY;
    if (smallerThanA == false || overlapsA == false) {
      this.showCutOutError();
      return;
    }

    // Clip C to A's bounds
    var clampedMinX = Math.max(cMinX, -aHalfX);
    var clampedMaxX = Math.min(cMaxX, aHalfX);
    var clampedMinY = Math.max(cMinY, -aHalfY);
    var clampedMaxY = Math.min(cMaxY, aHalfY);

    // One rect per edge of A that clipped-C doesn't reach (rects can overlap at corners - intentional)
    var localRects = [];
    if (clampedMinX > -aHalfX + EPS) localRects.push({ x0: -aHalfX, x1: clampedMinX, y0: -aHalfY, y1: aHalfY }); // Left
    if (clampedMaxX < aHalfX - EPS) localRects.push({ x0: clampedMaxX, x1: aHalfX, y0: -aHalfY, y1: aHalfY }); // Right
    if (clampedMinY > -aHalfY + EPS) localRects.push({ x0: -aHalfX, x1: aHalfX, y0: -aHalfY, y1: clampedMinY }); // Bottom
    if (clampedMaxY < aHalfY - EPS) localRects.push({ x0: -aHalfX, x1: aHalfX, y0: clampedMaxY, y1: aHalfY }); // Top

    var objectData = target.toJSON();
    localRects.forEach(rect => {
      var localCenter = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
      var worldCenter = rotateFwd(localCenter.x, localCenter.y);
      var piece = app.level.entityFactory.createObject(objectData.class);
      var pieceData = {
        ...objectData,
        position: { x: target.position.x + worldCenter.x, y: target.position.y + worldCenter.y, z: objectData.position.z },
        rotation: { x: objectData.rotation.x, y: objectData.rotation.y, z: az },
        scale: { x: rect.x1 - rect.x0, y: rect.y1 - rect.y0, z: objectData.scale.z }
      };
      app.level.setObjectProperties(piece, pieceData);
      app.level.addObject(piece);
    });

    app.level.removeObject(target, true); // Also deselects
    app.level.removeObject(cutter, true); // The cutter is consumed by the cut too
    app.levelHistory.save('Cut out block');
  }

  // Shared error popup for cut-out validation failures: no history entry, no level changes.
  showCutOutError() {
    window.dispatchEvent(new CustomEvent('openPopup', {
      detail: {
        text: 'popup.text.invalid_cut_out',
        inputs: [
          { value: 'popup.button.close', type: 'button' }
        ]
      }
    }));
  }

  // ============================== "P" Chain physics ==============================
  // Reuses "M" multiselect's box-select/refine staging end to end (same exclusiveAction name 'multiselect',
  // purpose 'chain' - see startMultiselect()): "P" arms box-select, drag a box, "C" confirms into refine
  // (add/remove individual blocks by click), "C" again confirms into anchor-marking (click a selected block
  // to flag/unflag it as a static anchor, default dynamic), "C" a third time finalizes - builds the Matter
  // constraints/visuals scoped to just this selection (see Level.buildChainLinksForCandidates) and ends. "V"/Escape cancels at any stage.

  armChainMode() {
    if (this.canPerformEditorAction() == false) return;
    this.startMultiselect('chain');
  }

  isChainAnchorStage() {
    return this.exclusiveAction?.name === 'multiselect' && this.exclusiveAction.purpose === 'chain' && this.exclusiveAction.stage === 'anchor';
  }

  // Stage 3 (chain purpose only): the confirmed box/refine selection becomes the chain's candidate blocks.
  enterChainAnchorStage() {
    var action = this.exclusiveAction;
    if (action.selected.length === 0) return; // nothing captured: stay put

    this.setExclusiveActionStage('anchor');
    action.confirm = () => this.confirmChain();
    action.cancel = () => this.cleanupMultiselect();
    this.setOrbitLeftEnabled(true); // left-click toggles anchor flag, left-drag pans the camera (same as refine)
    // Re-tag every selected block's highlight from the plain white/cyan selection color to chain's dynamic (cyan) color.
    action.selected.forEach(obj => this.highlightChainBlock(obj, false));
  }

  chainAnchorPointerUp(e) {
    if (this.controlsOrbit.moved || this.isSnapped() == false) return; // ignore camera drags/pans, same click-tolerance convention as refine
    var target = app.mouse.clickObject(e);
    if (target == null || target === app.player) return;

    var action = this.exclusiveAction;
    if (action.selected.indexOf(target) === -1) return; // only candidates from the confirmed selection can be flagged

    var isAnchor;
    if (action.anchors.has(target)) { action.anchors.delete(target); isAnchor = false; }
    else { action.anchors.add(target); isAnchor = true; }
    this.highlightChainBlock(target, isAnchor);
    this.updateRender();
  }

  // Orange = anchor, cyan = dynamic - reuses multiselect's highlight-color-swap mechanism/bookkeeping (_msOriginalColor).
  highlightChainBlock(obj, isAnchor) {
    if (obj._msOriginalColor == null) obj._msOriginalColor = obj.color;
    obj.setColors(isAnchor ? '#ff8800' : '#00ffff', false);
    obj.updateMatrixWorld();
  }

  // "C" (3rd press): sets every selected block's static/dynamic state (dynamic by default, static if flagged
  // anchor - regardless of the block's own prior static/dynamic setting), then builds temporary constraints
  // scoped to just this selection (see Level.buildChainLinksForCandidates - chain membership is exactly the
  // blocks run through this "P" flow, not level-wide). If any pair actually linked, the selection is settled
  // invisibly under gravity and baked into static geometry (see settleChainAndBake) - this is a one-time
  // level-authoring aid, not a persistent feature, so nothing chain-related survives past this call other
  // than the blocks' final settled positions. If nothing linked, there's nothing to settle - same as before.
  confirmChain() {
    var action = this.exclusiveAction;
    var blocks = action.selected;

    if (blocks.length < 2) {
      this.cleanupMultiselect();
      return;
    }

    blocks.forEach(obj => obj.setStatic(action.anchors.has(obj)));
    var { constraints } = app.level.buildChainLinksForCandidates(blocks);

    if (constraints.length === 0) {
      app.levelHistory.save('Created chain');
      this.cleanupMultiselect();
      return;
    }

    // Block re-entrancy (stray "C"/"V"/Escape presses) while the settle simulation is running below.
    action.confirm = () => {};
    action.cancel = () => {};
    this.settleChainAndBake(blocks, constraints);
  }

  // Runs the chain's confirmed candidates forward through Matter in a single synchronous loop (Matter can
  // step a handful of bodies hundreds of times in milliseconds, so there's no need to spread this across
  // animation frames), with the camera frozen and the blocks hidden (obj.visible, not Cube.hide()/freeze() -
  // that also sleeps/disables collision on the body, which would stop the very simulation we want to run).
  // Chain-linked blocks start out exactly coincident at their shared link points by design, so give them a
  // shared negative collisionFilter.group for the duration of the settle - otherwise Matter's own rigid-body
  // collision resolution fights the pin constraints holding those same points together, which is degenerate
  // enough to crash Matter's SAT code (_findSupports). Restored after baking (see finishChainSettle). Stops
  // once either the simulated step cap is hit or every dynamic candidate's speed has stayed below threshold
  // for several consecutive checks, then bakes the settled result (see finishChainSettle).
  settleChainAndBake(blocks, constraints) {
    var tuning = CHAIN_SETTLE_TUNING;
    var dynamicBlocks = blocks.filter(obj => obj.isStatic() == false);

    var chainCollisionGroup = -(++chainSettleGroupCounter);
    blocks.forEach(obj => {
      obj._chainOriginalCollisionGroup = obj.body.collisionFilter.group;
      obj.body.collisionFilter.group = chainCollisionGroup;
    });

    blocks.forEach(obj => obj.visible = false);
    this.setOrbitInteractionEnabled(false);
    this.showChainSettleOverlay();

    // Chain-linked pairs are exactly (within 1e-6) coincident at their shared points by design (see
    // linkBlockPair) - nudge each dynamic block's body a hair off that shared point, in a distinct direction
    // per block, before the solver ever runs. The constraints' local point offsets already matched the
    // un-nudged geometry (buildChainLinksForCandidates ran before this), so this can't affect which ends got
    // linked - it just keeps the very first solve step off an exact zero-distance edge case.
    dynamicBlocks.forEach((obj, i) => {
      var sign = (i % 2 === 0) ? 1 : -1;
      var offset = sign * (i + 1) * 0.0005;
      Body.setPosition(obj.body, { x: obj.body.position.x + offset, y: obj.body.position.y + offset });
    });

    // Give dynamic blocks volume-based mass so scale.z (depth) affects settle behavior, not just 2D area
    dynamicBlocks.forEach(obj => {
      Body.setMass(obj.body, Math.abs(obj.scale.x * obj.scale.y * obj.scale.z));
    });

    var stepsRun = 0, stableFrames = 0;
    while (stepsRun < tuning.totalSteps && stableFrames < tuning.stableFramesNeeded) {
      Engine.update(app.engine, tuning.timestep);
      stepsRun++;

      var maxSpeed = 0;
      dynamicBlocks.forEach(obj => maxSpeed = Math.max(maxSpeed, obj.body.speed));
      stableFrames = (maxSpeed < tuning.speedThreshold) ? stableFrames + 1 : 0;
    }

    this.finishChainSettle(blocks, constraints);
  }

  // Bakes the settled simulation into permanent static geometry: reads each block's final body transform
  // (same y-flip/angle-negation convention as Cube.update()'s per-frame alpha interpolation, here effectively
  // alpha=1 since the settle loop above already finished), sets it as the block's new saved origin
  // (updateOrigin=true - unlike the updateOrigin=false calls used elsewhere for temp/preview purposes, we
  // explicitly want this baked in for good), freezes it static, removes the now-unneeded temporary
  // constraints, then restores the camera/visibility and tears down like a normal multiselect confirm.
  finishChainSettle(blocks, constraints) {
    constraints.forEach(constraint => World.remove(app.engine.world, constraint));

    blocks.forEach(obj => {
      var settledPosition = { x: obj.body.position.x, y: -obj.body.position.y, z: obj.position.z };
      var settledRotation = -obj.body.angle;
      obj.setPosition(settledPosition, true);
      obj.setRotation(settledRotation, true);
      obj.setStatic(true);
      obj.visible = true;
      obj.body.collisionFilter.group = obj._chainOriginalCollisionGroup ?? 0;
      delete obj._chainOriginalCollisionGroup;
    });

    this.hideChainSettleOverlay();
    this.setOrbitInteractionEnabled(true);
    // Every candidate's own origin now holds its final baked position/rotation/scale/static state (above) -
    // resetLevel() cleanly returns the whole level (chain blocks and everything else) to that baseline,
    // zeroing velocity/angular velocity, same as any normal level-restart (see Level.resetLevel).
    app.level.resetLevel();
    app.levelHistory.save('Created chain');
    this.cleanupMultiselect();
  }

  // ----- Chain settle loading overlay (a plain DOM overlay - mirrors ensureMarqueeElement's raw-DOM pattern,
  // no Vue involved) - translucent, no buttons/interaction, just animated white "Loading..." text. Class
  // 'popup' piggybacks on the existing isEditorPopupOpen() gate (see canPerformEditorAction/canConfirmAction)
  // so no other editor action can start while it's showing, on top of the action.confirm/cancel no-ops above. -----

  ensureChainSettleOverlay() {
    if (this.chainSettleOverlay) return this.chainSettleOverlay;
    var el = document.createElement('div');
    el.className = 'popup';
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.display = 'none';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.background = 'rgba(0, 0, 0, 0.5)';
    el.style.zIndex = '9999';
    el.style.pointerEvents = 'none';
    var text = document.createElement('div');
    text.style.color = '#ffffff';
    text.style.fontSize = '1.5em';
    text.style.fontFamily = 'Comfortaa-Bold'; // match the app's standard UI font (.ui-origin), not appended inside it
    document.body.appendChild(el);
    el.appendChild(text);
    this.chainSettleOverlay = el;
    this.chainSettleOverlayText = text;
    return el;
  }

  showChainSettleOverlay() {
    var el = this.ensureChainSettleOverlay();
    el.style.display = 'flex';
    var dots = 0;
    this.chainSettleOverlayText.textContent = 'Loading';
    this.chainSettleOverlayInterval = setInterval(() => {
      dots = (dots + 1) % 4;
      this.chainSettleOverlayText.textContent = 'Loading' + '.'.repeat(dots);
    }, 400);
  }

  hideChainSettleOverlay() {
    if (this.chainSettleOverlay) this.chainSettleOverlay.style.display = 'none';
    if (this.chainSettleOverlayInterval) { clearInterval(this.chainSettleOverlayInterval); this.chainSettleOverlayInterval = null; }
  }

  // Checkpoint property panel "Set as start position" button: session-only playtest override, never serialized
  // (see keybinds.md and playCurrentLevel() in OriginPageLevelEditor.vue).
  setTempSpawnFromCheckpoint(checkpoint) {
    if (checkpoint == null || checkpoint.getClass() !== 'checkpoint') return;
    this.tempSpawnPosition = { x: checkpoint.position.x, y: checkpoint.position.y, z: checkpoint.position.z };
    this.tempSpawnRotation = { x: checkpoint.rotation.x, y: checkpoint.rotation.y, z: checkpoint.rotation.z };
  }

  // Re-applies the temp spawn override (if any) to the live player position/rotation - used on initial play
  // and on every Retry so "R" respects it too. updateOrigin=false keeps this session-only, never touching
  // the player's real positionOrigin/rotationOrigin (the values that actually get serialized to level JSON).
  applyTempSpawn() {
    if (this.tempSpawnPosition == null) return;
    app.player.setPosition(this.tempSpawnPosition, false);
    app.player.setRotation(this.tempSpawnRotation, false);
  }

  // "B,B"/"B,N": flip the selection across its own XZ/YZ plane; never falls back to app.selectedObject during multiselect since it's stale once M is active.
  flipSelection(plane) {
    if (this.exclusiveAction?.name === 'multiselect') {
      if (this.exclusiveAction.stage === 'transform') this.flipMultiselectGroup(plane);
      return;
    }
    this.flipSingleObject(plane);
  }

  flipSingleObject(plane) {
    if (app.selectedObject == null) return;
    this.applyFlip(app.selectedObject, plane);
    app.selectedObject.updateMatrixWorld();
    app.selectedObject.updateHelper();
    app.levelHistory.save('Flipped object');
  }

  // Flips every selected block's position around the live control block center, plus each block's own flip - folds into the transform's one history entry, same as Q/I/D above.
  flipMultiselectGroup(plane) {
    var action = this.exclusiveAction;
    if (action.selected.length === 0) return;
    var ctrl = action.controlBlock;
    if (ctrl == null) return;

    action.selected.forEach((obj, i) => {
      if (plane === 'xz') obj.position.y = 2 * ctrl.position.y - obj.position.y;
      else obj.position.x = 2 * ctrl.position.x - obj.position.x;
      obj.setPosition(obj.position);
      this.applyFlip(obj, plane);
      obj.updateMatrixWorld();
      obj.updateHelper();

      // Keep the transform snapshot in sync so a later drag or cancel doesn't silently discard the flip.
      var o = action.originalStats[i];
      o.x = obj.position.x; o.y = obj.position.y; o.z = obj.position.z;
      o.rx = obj.rotation.x; o.ry = obj.rotation.y; o.rz = obj.rotation.z;
    });
    this.updateRender();
  }

  // Toggles a 180° flip flag for the given plane; purely visual since Matter.js's 2D body only reads rotation.z.
  applyFlip(obj, plane) {
    if (plane === 'xz') obj.setRotation({ x: obj.rotation.x === 0 ? Math.PI : 0, y: obj.rotation.y, z: obj.rotation.z });
    else obj.setRotation({ x: obj.rotation.x, y: obj.rotation.y === 0 ? Math.PI : 0, z: obj.rotation.z });
  }

  saveLevel() {
    this.detachControls();
    app.resetScene();
    app.level.deselectLevel();
    app.level.saveLevelData();
    // Remember the history point we saved at, so exiting right after doesn't re-prompt "save this level?".
    this.savedHistoryIndex = app.levelHistory.historyIndex;
  }

  exitLevel() {
    // Only prompt to save when there are edits AND they're unsaved since the last Ctrl+S/save-button.
    var hasEdits = app.levelHistory.history.length > 2;
    var unsaved = app.levelHistory.historyIndex !== this.savedHistoryIndex;
    if (hasEdits && unsaved) {
      // Dispatch new popup from event
      window.dispatchEvent(new CustomEvent('openPopup', {
        detail: {
          text: 'popup.text.save_level',
          inputs: [
            { value: 'popup.button.cancel', type: 'button', callback: () => { window.dispatchEvent(new CustomEvent('closePopup')); }},
            { value: 'popup.button.no', type: 'button', callback: () => { this.saveAndExitLevelEditor(false); window.dispatchEvent(new CustomEvent('closePopup')); }},
            { value: 'popup.button.yes', type: 'button', callback: () => { this.saveAndExitLevelEditor(true); window.dispatchEvent(new CustomEvent('closePopup')); }},
          ]
        }
      }));
    }
    else this.saveAndExitLevelEditor(false);
  }

  saveAndExitLevelEditor(saveLevel) {
    // Safety net: resolve any active exclusive action on exit so it can't leave editor actions gated permanently.
    this.cancelAction();

    this.controlsOrbit.enabled = false;
    this.controlsOrbit.reset();
    this.detachControls();
    this.clearCustomPivot(); // don't carry a stale pivot/proxy into the next editor session
    app.play = false;
    if (saveLevel == true) this.saveLevel();
    app.level.clearLevel();
    app.levelHistory.clear();
    this.savedHistoryIndex = null; // next editor session starts "unsaved"
    app.player.removeCheckpoint();
    app.player.setPosition({ x: 0, y: 0, z: 0 });
    this.controlsOrbit.enabled = false;
    window.dispatchEvent(new CustomEvent('setPage', { detail: 'level-manager' }));
  }

  undo() {
    this.detachControls();
    app.levelHistory.undo();
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
  }

  redo() {
    app.levelHistory.redo();
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
  }

  rewind() {
    // Exiting to a clean edit state - never re-teleport to the temp spawn override here
    app.level.retryLevel(true, false);
    app.level.deselectLevel();
    app.levelEditor.detachControls();
    app.pauseLevel();
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
  }

  saveSelectedObject() {
    if (this.selectedMode === 'putty') {

    }
    else {
      // Duplicate before saving
      if (this.keys['ShiftLeft']) {
        this.duplicateSelectedObject();
      }
    }

    // Copy properties before transforming
    var target = app.selectedObject;
    if (target) {
      target.position0 = target.position.clone();
      target.scale0 = target.scale.clone();
      target.rotation0 = target.rotation.clone();
    }
  }

  // "0": resets the selected object's z to the "current Z" textbox value (not always 0).
  resetZAxis() {
    if (app.selectedObject) {
      app.selectedObject.position.z = this.currentZ;
      this.updateSelectedObject();
      // Push the new position to the Vue-side coords display, same as the click-select path does.
      window.dispatchEvent(new CustomEvent('setSelectedObject', { detail: app.selectedObject }));
    }
  }

  // Called from the level-editor UI's "current Z" textbox; new blocks spawn here, and "0" resets to here.
  setCurrentZ(value) {
    this.currentZ = value;
  }

  // "[" resets camera Z + rotation to default, relative to the current Z-plane (see keybinds.md "Current Z").
  // Uses controlsOrbit.reset() (same mechanism as the "Restart level" rewind) instead of raw camera writes,
  // since OrbitControls recomputes the camera quaternion from its own internal state every frame and would
  // otherwise silently fight/overwrite a direct camera.rotation.set() (causing a black-screen desync).
  resetCameraZRotation() {
    var targetX = this.controlsOrbit.target.x;
    var targetY = this.controlsOrbit.target.y;
    this.controlsOrbit.reset();
    this.controlsOrbit.target.x = targetX;
    this.controlsOrbit.target.y = targetY;
    app.camera.position.x = targetX;
    app.camera.position.y = targetY;
    app.camera.position.z += this.currentZ;
    this.controlsOrbit.update();
    app.camera.updateMatrixWorld();
    this.updateRender();
  }

  // "]" popup: type an exact camera X or Y directly.
  setCameraX(value) {
    app.camera.position.x = parseFloat(value) || 0;
    app.camera.updateMatrixWorld();
    this.updateRender();
  }

  setCameraY(value) {
    app.camera.position.y = parseFloat(value) || 0;
    app.camera.updateMatrixWorld();
    this.updateRender();
  }

  updateSelectedObject() {
    var target = app.selectedObject;

    // Update offset for duplication
    if (this.keys['ShiftLeft']) {
      this.duplicateOffset.copy(target.position).sub(target.position0);
    }
    else {
      // Reset duplication position
      this.duplicateOffset.set(0, 16, 0);
    }

    // Add/remove the physics body based on the object's z depth
    this.updateObjectPhysicsState(target);

    // Update body position
    target.setPosition(target.getPosition());

    // Update body scale (reset transformation first)
    var tempAngle = target.rotation.z;
    target.setRotation(0, false);
    target.setBodyScale(target.scale.x / target.scale0?.x || 1, target.scale.y / target.scale0?.y || 1);
    target.setRotation(tempAngle, false); // Revert angle
    target.setScale(target.getScale());

    // Refresh body rotation
    target.setRotation(target.getRotation());
    app.levelHistory.save('Object updated');
  }

  attachControls(target) {
    if (!target) return;
    // Rotate mode with a custom pivot set: attach the gizmo to an invisible proxy at the pivot instead of the
    // object itself, then remap the real object from the proxy's rotation each frame (see updatePivotRotation()).
    var usePivotProxy = this.selectedMode === 'rotate' && this.customPivot != null && target === app.selectedObject && this.isMultiselectTransform() == false;
    if (usePivotProxy) this.attachPivotProxy(target);
    else {
      this.detachPivotProxy();
      this.controlsTransform.attach(target);
      this.controlsPutty.attach(target);
    }
    this.applyControlsModeState();
  }

  attachPivotProxy(target) {
    if (this.pivotProxy == null) {
      this.pivotProxy = new Object3D();
      app.scene.add(this.pivotProxy);
    }
    this.pivotProxy.position.set(this.customPivot.x, this.customPivot.y, this.customPivot.z);
    this.pivotProxy.rotation.set(0, 0, 0);
    this.pivotProxy.updateMatrixWorld();
    this.pivotProxyTarget = target;
    this.pivotProxySnapshot = {
      x: target.position.x, y: target.position.y, z: target.position.z,
      rx: target.rotation.x, ry: target.rotation.y, rz: target.rotation.z
    };
    this.controlsPutty.detach();
    this.controlsTransform.attach(this.pivotProxy);
  }

  detachPivotProxy() {
    this.pivotProxyTarget = null;
    this.pivotProxySnapshot = null;
  }

  detachControls() {
    this.detachPivotProxy();
    this.controlsTransform.detach();
    this.controlsPutty.detach();
    this.applyControlsModeState();
  }

  applyControlsModeState() {
    const mode = this.selectedMode || 'translate';
    const hasSelection = this.controlsTransform.object != null;
    const isPuttyActive = hasSelection && mode == 'putty';

    this.controlsPutty.getHelper().visible = isPuttyActive;
    this.controlsPutty.enabled = isPuttyActive;
    this.controlsTransform.getHelper().visible = hasSelection && mode != 'putty';
    this.controlsTransform.enabled = mode != 'putty';

    if (mode != 'putty') {
      this.controlsTransform.setMode(mode);
      if (mode == 'translate') {
        this.controlsTransform.showX = true;
        this.controlsTransform.showY = true;
        this.controlsTransform.showZ = true;
      }
      else if (mode == 'scale') {
        this.controlsTransform.showX = true;
        this.controlsTransform.showY = true;
        this.controlsTransform.showZ = true;
      }
      else if (mode == 'rotate') {
        this.controlsTransform.showX = this.controlsTransform.showAll; // Default false
        this.controlsTransform.showY = this.controlsTransform.showAll; // Default false
        this.controlsTransform.showZ = true;
      }
    }
  }

  // "H" toggles hover-preview: while on, hovering any object shows the active tool's gizmo without clicking.
  toggleHoverPreview() {
    this.hoverPreviewEnabled = !this.hoverPreviewEnabled;
    // Never re-attach mid-drag (would yank the gizmo out from under an active drag) - endHoverDrag() finishes this once the drag ends.
    if (this.hoverPreviewEnabled == false && this.isHoverDragBlocked() == false) this.clearHoverPreview();
  }

  // Whether a drag is already in progress (on either control), so hover shouldn't retarget the gizmo mid-drag.
  isHoverDragBlocked() {
    return this.controlsTransform.dragging === true || this.puttyDragging === true;
  }

  // Whether the cursor is currently over the active gizmo itself (its own picker geometry), not the hovered block.
  isMouseOverGizmo() {
    return this.controlsTransform.axis != null || this.puttyHovering === true;
  }

  // Re-point the gizmo at whatever's under the cursor while hover-preview is on; no-op if nothing changed.
  updateHoverPreview(e) {
    if (this.hoverPreviewEnabled == false) return;
    if (this.isEditorPaused() == false) return;
    if (this.isHoverDragBlocked()) return; // don't interrupt an in-progress drag elsewhere
    if (this.exclusiveAction != null || this.isVanillaClickingSuppressed()) return; // stay out of other editor modes

    var target = app.mouse.clickObject(e);
    var current = this.hoverPreviewObject || app.selectedObject;
    if (target === current) return;

    if (target) {
      this.hoverPreviewObject = target;
      this.attachControls(target);
    }
    // Stay attached while the cursor is over the gizmo itself, even though it's no longer over the block.
    else if (this.isMouseOverGizmo() == false) this.clearHoverPreview();
  }

  // Drop the hover-only attach, falling back to the real selection (if any) or nothing.
  clearHoverPreview() {
    this.hoverPreviewObject = null;
    if (app.selectedObject) this.attachControls(app.selectedObject);
    else this.detachControls();
  }

  // A drag starting on a hover-only attach borrows app.selectedObject for its duration (body-sync relies on it).
  beginHoverDrag() {
    if (this.hoverPreviewObject && app.selectedObject !== this.hoverPreviewObject) {
      this.hoverDragActive = true;
      this.hoverDragRestoreTo = app.selectedObject;
      app.selectedObject = this.hoverPreviewObject;
    }
  }

  // Hands app.selectedObject back once a borrowed hover-drag finishes.
  endHoverDrag() {
    if (this.hoverDragActive == false) return;
    app.selectedObject = this.hoverDragRestoreTo;
    this.hoverDragActive = false;
    this.hoverDragRestoreTo = null;
    // "H" was toggled off mid-drag: finish the deferred cleanup now that it's safe to re-attach.
    if (this.hoverPreviewEnabled == false) this.clearHoverPreview();
  }

  setMode(mode) {
    // Swap Putty axis if putty mode is selected again
    if (mode == 'putty' && this.selectedMode == 'putty') {
      const currentAxis = this.controlsPutty.axis || 'X';
      const currentIndex = this.puttyAxes.indexOf(currentAxis);
      const nextIndex = (currentIndex + 1) % this.puttyAxes.length;
      
      // Update putty controls axis and color
      this.controlsPutty.axis = this.puttyAxes[nextIndex];
      this.controlsPutty.updateHelper();
    }

    // Update mode state
    this.selectedMode = mode;
    this.applyControlsModeState();
    this.attachControls(app.selectedObject);

    // Dispatch level editor mode change
    window.dispatchEvent(new CustomEvent('setSelectedMode', { detail: mode }));
  }

  selectObjectType(type, checkNull = true, saveHistory = true) {
    // Swap object by type
    if (app.selectedObject != null && checkNull == true) {
      app.selectedObject = app.level.changeObjectType(app.selectedObject, type);
      app.selectedObject.select(true);
      app.levelEditor.attachControls(app.selectedObject);
      if (saveHistory == true) app.levelHistory.save('Changed object to ' + type);
      window.dispatchEvent(new CustomEvent('setSelectedObject', { detail: app.selectedObject }));
    }

    // Set new selected object type
    app.levelEditor.selectedObjectType = type;
  }

  toggleSelectedObjectStaticState() {
    app.selectedObject.toggleStatic();
    app.selectedObject = app.level.refreshObject(app.selectedObject);
    app.selectedObject.select(true);
    app.levelEditor.attachControls(app.selectedObject);
    app.levelHistory.save('Updated object state');
    window.dispatchEvent(new CustomEvent('setSelectedObject', { detail: app.selectedObject }));
  }

  // Whether a popup/dialog is open under either UI theme (`.dialog`/`.popup`, excluding the always-in-DOM `.settings` panel).
  isEditorPopupOpen() {
    var blockers = document.querySelectorAll('.dialog:not(.settings), .popup:not(.settings)');
    for (var i = 0; i < blockers.length; i++) {
      if (window.getComputedStyle(blockers[i]).display != 'none') return true;
    }
    return false;
  }

  isEditorPaused() {
    return app.state == 'level-editor' && app.play == false;
  }

  // Gates starting a new exclusive editor action: paused, no popup, and nothing else holding exclusiveAction.
  canPerformEditorAction() {
    return this.isEditorPaused() && this.exclusiveAction == null && this.isEditorPopupOpen() == false;
  }

  // Gates "C" confirm: unlike canPerformEditorAction(), doesn't check exclusiveAction since confirm's job is to resolve it.
  canConfirmAction() {
    return this.isEditorPaused() && this.isEditorPopupOpen() == false;
  }

  // Claims the exclusive-action slot for a multi-step editor action; `confirm`/`cancel` default to releasing the slot.
  // `purpose` optionally distinguishes an action reusing another's mechanism for a different end result
  // (e.g. "P" chain reuses the "multiselect" name/staging but sets purpose 'chain' - see armChainMode()).
  startExclusiveAction(name, { confirm, cancel, purpose } = {}) {
    this.exclusiveAction = {
      name: name,
      purpose: purpose || null,
      confirm: confirm || (() => this.endExclusiveAction()),
      cancel: cancel || (() => this.endExclusiveAction())
    };
    window.dispatchEvent(new CustomEvent('levelEditorActionStarted', { detail: { name, purpose: purpose || null } }));
    return this.exclusiveAction;
  }

  endExclusiveAction() {
    var name = this.exclusiveAction?.name;
    this.exclusiveAction = null;
    if (name) window.dispatchEvent(new CustomEvent('levelEditorActionEnded', { detail: { name } }));
  }

  // Updates the active exclusive action's stage and announces the change
  setExclusiveActionStage(stage) {
    if (this.exclusiveAction == null) return;
    this.exclusiveAction.stage = stage;
    window.dispatchEvent(new CustomEvent('levelEditorActionStageChanged', { detail: { name: this.exclusiveAction.name, stage } }));
  }

  // "C"/"V" keybinds: resolve whatever's currently claiming exclusiveAction; no-op when nothing is active.
  confirmAction() {
    if (this.exclusiveAction) this.exclusiveAction.confirm();
  }

  cancelAction() {
    if (this.exclusiveAction) this.exclusiveAction.cancel();
  }

  // "A" (held) shows the block-type picker: hovering live-previews a type, releasing commits it with one history entry.
  enterSelectBlockTypeMode() {
    if (this.canPerformEditorAction() == false) return;

    var action = this.startExclusiveAction('select-block-type', {
      confirm: () => this.exitSelectBlockTypeMode(),
      cancel: () => this.cancelSelectBlockTypeMode()
    });
    action.originalType = this.selectedObjectType;
    action.hoveredType = null;
  }

  // Live-previews `type` on the selected object without touching levelHistory; no-op if unchanged.
  hoverBlockType(type) {
    if (this.exclusiveAction?.name !== 'select-block-type') return;
    if (this.exclusiveAction.hoveredType === type) return;
    this.exclusiveAction.hoveredType = type;
    window.dispatchEvent(new CustomEvent('selectObjectType', { detail: { type, checkNull: true, saveHistory: false } }));
  }

  // Reverts the live preview to the type active before the submode was armed.
  clearHoveredBlockType() {
    if (this.exclusiveAction?.name !== 'select-block-type') return;
    this.hoverBlockType(this.exclusiveAction.originalType);
  }

  // "A" released: commit the currently-previewed type with one history entry, only if it differs from the original.
  exitSelectBlockTypeMode() {
    if (this.exclusiveAction?.name !== 'select-block-type') return;
    var action = this.exclusiveAction;
    if (action.hoveredType != null && action.hoveredType !== action.originalType) {
      app.levelHistory.save('Changed object to ' + action.hoveredType);
    }
    this.endExclusiveAction();
  }

  // "V" cancel: revert the live preview to the original type and end the submode without saving history.
  cancelSelectBlockTypeMode() {
    if (this.exclusiveAction?.name !== 'select-block-type') return;
    this.hoverBlockType(this.exclusiveAction.originalType);
    this.endExclusiveAction();
  }

  // Adds or removes an object's physics body from the live Matter world based on z depth (only z==0 collides).
  updateObjectPhysicsState(target) {
    if (target.position.z == 0) {
      target.body.collisionFilter.mask = -1;
      if (!Composite.get(app.engine.world, target.body.id, 'body')) {
        World.add(app.engine.world, target.body);
        app.scene.add(target.helper);
        target.helper.updateMatrixWorld();
      }
    }
    else {
      target.body.collisionFilter.mask = 0; // Disable physics
      if (Composite.get(app.engine.world, target.body.id, 'body')) {
        World.remove(app.engine.world, target.body);
        app.scene.remove(target.helper);
      }
    }
  }

  // Marks blocks decorative/non-colliding by nudging z off 0 and syncing the physics body immediately; `objects` defaults to the current selection.
  toggleIntangibility(objects) {
    if (objects == null) objects = app.selectedObject ? [app.selectedObject] : [];
    if (objects.length === 0) return;
    if (this.canPerformEditorAction() == false && this.isMultiselectTransform() == false) return;

    var changed = false;
    objects.forEach(obj => {
      if (obj.positionOrigin.z == 0) {
        obj.positionOrigin.z = -1e-6;
        obj.position.z = -1e-6;
      }
      else if (obj.positionOrigin.z == -1e-6) {
        obj.positionOrigin.z = 0;
        obj.position.z = 0;
      }
      else return;

      changed = true;
      this.updateObjectPhysicsState(obj);
      obj.updateMatrixWorld();
      window.dispatchEvent(new CustomEvent('objectChange', { detail: obj }));
    });

    // Outside multiselect, save one entry per toggle; inside a group transform it's folded into the transform's entry instead.
    if (changed && this.isMultiselectTransform() == false) app.levelHistory.save('Toggled intangibility');

    this.updateRender();
    this.controlsTransform.dispatchEvent({ type: 'change' });
  }
}

export { LevelEditor };