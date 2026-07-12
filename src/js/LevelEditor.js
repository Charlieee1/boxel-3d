import { Vector2, Vector3 } from 'three';
import { Composite, World } from 'matter-js';
import { PuttyControls } from './PuttyControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Maps each key in the select-block-type submode (hold A) to its target type.
// Order matches the toolbar's object-type column (OriginPageLevelEditor.vue).
const BLOCK_TYPE_KEYS = {
  Backquote: 'cube',
  Digit1: 'tip',
  Digit2: 'bounce',
  Digit3: 'checkpoint',
  Digit4: 'spike',
  Digit5: 'resize',
  Digit6: 'direction',
  Digit7: 'gravity',
  Digit8: 'grapple',
  Digit9: 'finish',
  Digit0: 'reset',
  Minus: 'control',
  Equal: 'power',
  Backslash: 'teleport'
};

// Scratch vector reused for world -> screen projection (multiselect marquee).
const _screenVec = new Vector3();

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
    this.puttyAxes = ['X', 'Y', 'Z'];

    // Drag-to-move (hold Q): grab a block under the cursor and slide it directly.
    // Works regardless of editor/play state — intentionally not gated by
    // `exclusiveAction` below.
    this.dragMove = {
      enabled: false,        // true while Q is held
      state: 'static',       // 'static' | 'moving'
      offset: { x: 0, y: 0 } // grab point relative to the block origin (unsnapped)
    };

    // The one editor action allowed to run at a time (ex: select-block-type).
    // Null when idle; otherwise `{ name, confirm(), cancel() }`. Change it via
    // startExclusiveAction()/endExclusiveAction(), not direct assignment.
    this.exclusiveAction = null;

    // Initialize helper visibility from current mode.
    this.applyControlsModeState();

    // Putty constrols events
    this.controlsPutty.addEventListener('dragstart', () => { this.controlsOrbit.enabled = false; this.saveSelectedObject(); });
    this.controlsPutty.addEventListener('dragend', () => { this.controlsOrbit.enabled = true; this.updateSelectedObject(); });
    this.controlsPutty.addEventListener('objectChange', () => {
      this.controlsPutty.moved = true;
      window.dispatchEvent(new CustomEvent('objectChange', { detail: app.selectedObject }));
    });

    // Transform controls events
    this.controlsTransform.addEventListener('mouseDown', () => { this.controlsOrbit.enabled = false; this.saveSelectedObject(); });
    this.controlsTransform.addEventListener('mouseUp', () => {
      this.controlsOrbit.enabled = true;
      // During a group transform the attached object is the temporary control
      // block, not a real level object — skip the per-object body-sync/save.
      if (this.isMultiselectTransform()) return;
      this.updateSelectedObject();
    });
    this.controlsTransform.addEventListener('objectChange', () => {
      this.controlsTransform.moved = true;
      // Remap the whole selection as the group control block is dragged.
      if (this.isMultiselectTransform()) this.updateGroupTransform();
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
  }

  pointerDown(e) {
    this.down.set(e.clientX, e.clientY);
    this.drag = true;
    this.controlsOrbit.rotateSpeed = 0; // Deactivate camera by default
    this.controlsOrbit.panSpeed = 0;
    if (this.dragMove.enabled) this.dragMoveDown(e);
    else if (this.isMultiselectSelectionStage()) this.multiselectPointerDown(e);
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

    // Restore orbit camera speeds once the drag passes the click threshold, so
    // the camera stays movable during multiselect (marquee disables only LEFT).
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
    this.updateRender();
  }

  // Whether an editor mode has taken over clicking (drag-to-move, fast build,
  // multiselect marquee/refine) — Mouse.js skips its own draw/erase/jump/rope
  // handling while one is active. The multiselect transform stage is not
  // suppressed: its control block is selected by normal editor clicking.
  isVanillaClickingSuppressed() {
    return this.dragMove.enabled
      || this.exclusiveAction?.name === 'fast-build'
      || this.isMultiselectSelectionStage();
  }

  isMultiselectMarquee() {
    return this.exclusiveAction?.name === 'multiselect' && this.exclusiveAction.stage === 'marquee';
  }

  isMultiselectRefine() {
    return this.exclusiveAction?.name === 'multiselect' && this.exclusiveAction.stage === 'refine';
  }

  // Both selection stages (marquee + refine) drive the pointer handlers; the
  // transform stage is driven by the gizmo instead.
  isMultiselectSelectionStage() {
    return this.isMultiselectMarquee() || this.isMultiselectRefine();
  }

  isMultiselectTransform() {
    return this.exclusiveAction?.name === 'multiselect' && this.exclusiveAction.stage === 'transform';
  }

  // Enable/disable the orbit camera's pan/rotate/zoom, so editor modes that take
  // over the pointer (drag-to-move, fast build, multiselect) manipulate blocks.
  setOrbitInteractionEnabled(enabled) {
    this.controlsOrbit.enablePan = enabled;
    this.controlsOrbit.enableRotate = enabled;
    this.controlsOrbit.enableZoom = enabled;
  }

  // Enable/disable just the LEFT orbit button (default pan). The marquee stage
  // disables LEFT to draw the marquee, leaving middle/right/wheel for the camera.
  setOrbitLeftEnabled(enabled) {
    this.controlsOrbit.mouseButtons.LEFT = enabled ? 2 : null; // 2 = pan
  }

  // Drag-to-move (hold Q): grab whatever block is under the pointer and slide it,
  // offset-locked to the point you grabbed it at.
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
    // In multiselect transform, Q grabs the group control block so the whole
    // selection moves together (grabbing a member would desync the remap).
    var object = this.isMultiselectTransform() ? this.exclusiveAction.controlBlock : app.mouse.clickObject(e);
    if (object == null) return;

    this.dragMove.state = 'moving';
    app.selectedObject = object;

    // Snap the grab point, then store its (unsnapped) offset from the block origin
    var snap = app.mouse.snap;
    var point = app.mouse.getPositionOnPlane(e, object.position.z);
    var grabX = point ? app.mouse.snapToValue(point.x, snap) : object.position.x;
    var grabY = point ? app.mouse.snapToValue(point.y, snap) : object.position.y;
    this.dragMove.offset.x = grabX - object.position.x;
    this.dragMove.offset.y = grabY - object.position.y;
  }

  dragMoveMove(e) {
    if (this.dragMove.state == 'static') return;
    if (app.selectedObject == null) return;

    var object = app.selectedObject;
    var snap = app.mouse.snap;
    var point = app.mouse.getPositionOnPlane(e, object.position.z);
    if (point == null) return;

    object.setPosition({
      x: app.mouse.snapToValue(point.x, snap) - this.dragMove.offset.x,
      y: app.mouse.snapToValue(point.y, snap) - this.dragMove.offset.y,
      z: object.position.z
    });

    // If the grabbed object is the multiselect control block, remap the group.
    if (this.isMultiselectTransform() && object === this.exclusiveAction.controlBlock) {
      this.updateGroupTransform();
    }

    this.updateRender();
  }

  dragMoveUp() {
    if (this.dragMove.state == 'static') return;
    this.dragMove.state = 'static';
    // Keep the group control block selected (so its gizmo stays) when Q was used
    // to move the group; otherwise clear the transient drag selection.
    app.selectedObject = this.isMultiselectTransform() ? this.exclusiveAction.controlBlock : null;
  }

  // Fast build (hold K to toggle): click to place a block, drag to scale it,
  // click, drag to rotate, click, drag to reposition, click — which finalizes
  // the block and starts placing the next. Repeat until K (or V, cancel).
  // Progresses through action.stage ('create' -> 'scale' -> 'rotate' -> 'move'
  // -> 'create'), driven by the pointerDown/Move/Up handlers.
  toggleFastBuild() {
    // While fast build is active, "K" steps back one stage (like an undo of the
    // last click) rather than toggling off — unless there's no block currently
    // being built, in which case it disables fast build.
    if (this.exclusiveAction?.name === 'fast-build') {
      this.fastBuildStepBack();
      return;
    }
    if (this.canPerformEditorAction() == false) return;

    var action = this.startExclusiveAction('fast-build', {
      confirm: function() {}, // "C" does nothing during fast build
      cancel: () => this.endFastBuild()
    });
    action.stage = 'create';
    action.block = null;
    action.origin = null;
    // Camera stays movable while building (pan/zoom/rotate) — the size/rotate/
    // move stages track free mouse movement, so leaving orbit enabled doesn't
    // conflict, and lets the user reframe the view between placements.
  }

  fastBuildStepBack() {
    var action = this.exclusiveAction;

    // No block mid-placement -> "K" disables fast build entirely.
    if (action.stage == 'create' || action.block == null) {
      this.endFastBuild();
      return;
    }

    // Otherwise walk back one stage. Stepping back out of 'scale' discards the
    // just-placed block and returns to waiting for a placement click.
    if (action.stage == 'scale') {
      app.level.removeObject(action.block, true);
      action.block = null;
      action.origin = null;
      action.stage = 'create';
    }
    else if (action.stage == 'rotate') {
      action.stage = 'scale';
    }
    else if (action.stage == 'move') {
      action.stage = 'rotate';
    }
  }

  endFastBuild() {
    // Discard whatever's mid-placement (a block only exists once past 'create')
    if (this.exclusiveAction?.block) app.level.removeObject(this.exclusiveAction.block, true);
    this.endExclusiveAction();
  }

  fastBuildPointerUp(e) {
    // A "click" (not a camera drag/orbit) advances to the next stage, using the
    // editor's own click-vs-drag tolerance (isSnapped()).
    if (this.controlsOrbit.moved || this.isSnapped() == false) return;

    var action = this.exclusiveAction;
    if (action.stage == 'create') {
      this.fastBuildCreateBlock(e);
      action.stage = 'scale';
    }
    else if (action.stage == 'scale') {
      action.stage = 'rotate';
    }
    else if (action.stage == 'rotate') {
      action.stage = 'move';
    }
    else if (action.stage == 'move') {
      // Finalize this block and go straight into placing the next one
      action.block = null;
      action.origin = null;
      action.stage = 'create';
    }
  }

  fastBuildCreateBlock(e) {
    var action = this.exclusiveAction;
    var pos = app.mouse.getPosition(e);
    pos.x = app.mouse.snapToValue(pos.x, app.mouse.snap);
    pos.y = app.mouse.snapToValue(pos.y, app.mouse.snap);

    var type = this.selectedObjectType;
    var block = app.level.entityFactory.createObject(type);
    app.level.setObjectProperties(block, {
      class: type,
      isStatic: true,
      position: { x: pos.x, y: pos.y, z: 0 },
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
      var pos2 = app.mouse.getPosition(e);
      pos2.x = app.mouse.snapToValue(pos2.x, app.mouse.snap);
      pos2.y = app.mouse.snapToValue(pos2.y, app.mouse.snap);
      var origin = action.origin;

      app.level.setObjectProperties(action.block, {
        position: { x: 0.5 * (origin.x + pos2.x), y: 0.5 * (origin.y + pos2.y), z: 0 },
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
      var pos = app.mouse.getPosition(e);
      pos.x = app.mouse.snapToValue(pos.x, app.mouse.snap);
      pos.y = app.mouse.snapToValue(pos.y, app.mouse.snap);
      action.block.setPosition({ x: pos.x, y: pos.y, z: action.block.position.z });
    }

    action.block.updateMatrixWorld();
    action.block.updateHelper();
  }

  // ============================== Multiselect ==============================
  // Drag a 2D marquee rectangle on screen and every object whose projected
  // center falls inside it is captured, then transform the whole group.
  //
  // Three stages, "C" advancing each:
  //   1. 'marquee'   — drag the 2D rectangle to (re)select captured objects
  //   2. 'refine'    — click individual objects to add/remove them
  //   3. 'transform' — translucent control block + gizmo remaps the group
  // "V" (or "M") cancels from any stage. The camera stays movable throughout
  // (marquee disables only the LEFT orbit button; refine/transform keep it).

  toggleMultiselect() {
    if (this.exclusiveAction?.name === 'multiselect') {
      this.cancelAction();
      return;
    }
    if (this.canPerformEditorAction() == false) return;
    this.startMultiselect();
  }

  startMultiselect() {
    var action = this.startExclusiveAction('multiselect', {
      confirm: () => this.enterMultiselectRefine(),
      cancel: () => this.cleanupMultiselect()
    });
    action.stage = 'marquee';
    action.selected = [];
    action.marquee = { active: false, dragged: false, x1: 0, y1: 0, x2: 0, y2: 0 };
    action.controlBlock = null;
    action.originalStats = null;
    action.groupBox = null;
    action.historyIndex = null;
    this.setOrbitLeftEnabled(false); // left = marquee; middle/right/wheel = camera
  }

  // Stage 2: precise add/remove by clicking individual objects.
  enterMultiselectRefine() {
    var action = this.exclusiveAction;
    if (action.stage !== 'marquee') return;
    action.stage = 'refine';
    action.confirm = () => this.enterMultiselectTransform();
    action.cancel = () => this.cleanupMultiselect();
    this.setOrbitLeftEnabled(true); // left-click toggles, left-drag pans the camera
    this.hideMarquee();
  }

  // Shared teardown for every exit path (cancel at any stage, group delete, and
  // the editor-exit safety net). Leaves the level in its current live state.
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

    // Only the marquee stage draws/previews a rectangle; in refine, a left-drag
    // is a camera pan (handled by orbit), so we just remember it was a drag.
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
      // Stage 2: a plain click toggles the object under the cursor (a drag was a
      // camera pan and is ignored).
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
    // White, or cyan if the block is already white, for contrast. updateOrigin=
    // false so the block's stored colorOrigin stays its real color.
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

    // The translucent control block is the indicator now — drop the highlights
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

    // Preserve the pre-transform history point so confirm/cancel resolve to one
    // clean entry regardless of how many gizmo drags (or duplications) happen.
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

    // Keep the box translucent through normal selection so it never hides the
    // group behind it, and keep it cyan (baseSelect would recolor it white on
    // select). This only adjusts the block's appearance — it does NOT change
    // clicking; the box is selected/deselected by normal editor clicks.
    var baseSelect = block.select.bind(block);
    block.select = state => { baseSelect(state); block.shapes.setColors('#00ffff', false); block.shapes.setOpacities(0.2); };

    // Select it so the transform gizmo attaches.
    app.level.deselectLevel();
    app.selectedObject = block;
    block.select(true);
    this.attachControls(block);

    action.stage = 'transform';
    action.confirm = () => this.confirmMultiselectTransform();
    action.cancel = () => this.cancelMultiselectTransform();
    this.setOrbitLeftEnabled(true); // left-drag pans; the gizmo captures its handles

    window.dispatchEvent(new CustomEvent('setSelectedObject', { detail: block }));
    this.updateRender();
  }

  // Remap every selected object from the control block's current transform:
  // relative position scaled by the box factors, rotated by the control block's
  // rotation, then translated to it.
  updateGroupTransform() {
    var action = this.exclusiveAction;
    if (this.isMultiselectTransform() == false) return;
    var ctrl = action.controlBlock;
    if (ctrl == null) return;
    var box = action.groupBox;

    var factorX = ctrl.scale.x / box.boxX;
    var factorY = ctrl.scale.y / box.boxY;
    var factorZ = ctrl.scale.z / box.boxZ;

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
    // Objects are already at their transformed positions — just drop the control
    // block and collapse the intermediate history into one clean entry.
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

    // Duplicate each selected object; the copies (offset for visibility) become
    // the new selection and a fresh transform stage is built around them. The
    // originals keep whatever transform was applied so far.
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

  // "I" during a group transform toggles intangibility for the whole selection.
  // The group snapshot's z is kept in sync so the ongoing proportional remap
  // preserves the change (and it survives save/reload).
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
  }

  mouseDown(e) {
    app.mouse.setPosition('down', app.mouse.getPosition(e));

    // Update snap settings for putty controls
    this.controlsPutty.moved = false;
    this.controlsPutty.snap = app.mouse.snap;
    
    // Update transform controls snap settings
    this.controlsTransform.moved = false;
    this.controlsTransform.setTranslationSnap(app.mouse.snap);
    this.controlsTransform.setScaleSnap(app.mouse.snap);
    this.controlsTransform.setRotationSnap(app.mouse.snap > 1 ? (Math.PI / 12) : null); // 15 degrees or granular (null)
  }

  mouseMove(e) {
    app.mouse.setPosition('move', app.mouse.getPosition(e));
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
        if (target) {
          // Copy selected object color to target color
          if (e.shiftKey === true) {
            // During a group transform, copy the clicked block's color onto
            // every block in the selection — never onto the blue control block.
            if (this.isMultiselectTransform()) {
              var action = this.exclusiveAction;
              if (target !== action.controlBlock) {
                action.selected.forEach(obj => obj.setColors(target.color));
                app.levelHistory.save('Copied color to selection');
                this.updateRender();
              }
              return;
            }
            if (app.selectedObject) {
              target.setColors(app.selectedObject.color);
              app.levelHistory.save('Copied color');
              this.updateRender();
              return;
            }
          }

          if (this.controlsTransform.moved == false &&
            this.controlsOrbit.moved == false &&
            this.controlsPutty.moved == false) {
            app.level.deselectLevel();
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
            var objectData = {
              class: objectType,
              color: app.level.entityFactory.color,
              isStatic: true,
              position: { 
                x: app.mouse.snapToValue(app.mouse.down.x, app.mouse.snap), 
                y: app.mouse.snapToValue(app.mouse.down.y, app.mouse.snap), 
                z: 0 
              },
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
    // During multiselect, "D" acts on the whole group (transform stage) and is a
    // no-op during marquee selection — return before the app.selectedObject
    // deref below (which is the control block or null under multiselect).
    if (this.exclusiveAction?.name === 'multiselect') {
      if (this.exclusiveAction.stage === 'transform') this.duplicateMultiselectGroup();
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
    // During multiselect, "X" deletes the whole group (transform stage only).
    if (this.exclusiveAction?.name === 'multiselect') {
      if (this.exclusiveAction.stage === 'transform') this.deleteMultiselectGroup();
      return;
    }

    if (app.selectedObject) {
      app.level.removeObject(app.selectedObject, true);
      app.levelEditor.detachControls();
      app.levelHistory.save('Deleted object');
      window.dispatchEvent(new CustomEvent('setSelectedObject'));
    }
  }

  saveLevel() {
    this.detachControls();
    app.resetScene();
    app.level.deselectLevel();
    app.level.saveLevelData();
    // Remember the history point we saved at, so exiting right after a save
    // doesn't re-prompt "save this level?" (see exitLevel).
    this.savedHistoryIndex = app.levelHistory.historyIndex;
  }

  exitLevel() {
    // Only prompt to save when there are edits AND they're unsaved since the
    // last Ctrl+S / save-button (previously it prompted after any edit, even
    // right after saving).
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
    // Safety net: if the editor is exited (ex: Escape) while an exclusive
    // action is active, resolve it so it can't leave editor actions gated
    // permanently — there's no other exit path once its owning key state is
    // torn down (it's all inline in keyDown/keyUp, no separate listener).
    this.cancelAction();

    this.controlsOrbit.enabled = false;
    this.controlsOrbit.reset();
    this.detachControls();
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
    app.level.retryLevel(true);
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

  resetZAxis() {
    if (app.selectedObject) {
      app.selectedObject.position.z = 0;
      this.updateSelectedObject();
    }
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
    this.controlsTransform.attach(target);
    this.controlsPutty.attach(target);
    this.applyControlsModeState();
  }

  detachControls() {
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

  selectObjectType(type, checkNull = true) {
    // Swap object by type
    if (app.selectedObject != null && checkNull == true) {
      app.selectedObject = app.level.changeObjectType(app.selectedObject, type);
      app.selectedObject.select(true);
      app.levelEditor.attachControls(app.selectedObject);
      app.levelHistory.save('Changed object to ' + type);
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

  // Whether a popup/dialog is currently open under either UI theme (Origin's
  // `.dialog` or Bubble's `.popup`). `.settings` is excluded because Bubble's
  // settings panel keeps the `popup` class while staying in the DOM (v-show),
  // so the visibility check guards against it and similar overlays.
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

  // Gates starting a new exclusive editor action: must be paused in the editor,
  // no popup open, and nothing else already holding exclusiveAction.
  canPerformEditorAction() {
    return this.isEditorPaused() && this.exclusiveAction == null && this.isEditorPopupOpen() == false;
  }

  // Gates the "C" confirm keybind. Unlike canPerformEditorAction(), it does not
  // check exclusiveAction — confirm's job is to resolve the active action. Still
  // requires the paused editor (KeyC collides with respawn) and no open popup.
  canConfirmAction() {
    return this.isEditorPaused() && this.isEditorPopupOpen() == false;
  }

  // Claims the exclusive-action slot for a multi-step editor action. Returns the
  // record so the caller can attach extra cleanup state. `confirm`/`cancel`
  // default to just releasing the slot.
  startExclusiveAction(name, { confirm, cancel } = {}) {
    this.exclusiveAction = {
      name: name,
      confirm: confirm || (() => this.endExclusiveAction()),
      cancel: cancel || (() => this.endExclusiveAction())
    };
    return this.exclusiveAction;
  }

  endExclusiveAction() {
    this.exclusiveAction = null;
  }

  // "C"/"V" keybinds: resolve whatever's currently claiming exclusiveAction.
  // No-ops when nothing is active.
  confirmAction() {
    if (this.exclusiveAction) this.exclusiveAction.confirm();
  }

  cancelAction() {
    if (this.exclusiveAction) this.exclusiveAction.cancel();
  }

  // "A" arms a one-shot submode where the next key from BLOCK_TYPE_KEYS picks an
  // object type directly, without clicking the toolbar. Dispatches the same
  // `selectObjectType` event a toolbar click would, so it also changes the
  // selected object's type if one is selected.
  enterSelectBlockTypeMode() {
    if (this.canPerformEditorAction() == false) return;

    var action = this.startExclusiveAction('select-block-type', {
      confirm: () => this.exitSelectBlockTypeMode(),
      cancel: () => this.exitSelectBlockTypeMode()
    });

    // Suppress "0" -> reset Z axis while "0" is reserved for picking block
    // type index 10 (reset cube) below. Restored in exitSelectBlockTypeMode.
    action.resetZAxisOriginal = this.resetZAxis;
    this.resetZAxis = function() {};
  }

  exitSelectBlockTypeMode() {
    if (this.exclusiveAction?.name !== 'select-block-type') return;
    this.resetZAxis = this.exclusiveAction.resetZAxisOriginal;
    this.endExclusiveAction();
  }

  // While the select-block-type submode is armed, picks the object type mapped
  // to `code` (if any) and defers the exit to keyUp. Returns whether the key was
  // consumed as a pick.
  pickBlockType(code) {
    if (this.exclusiveAction?.name !== 'select-block-type') return false;
    var blockType = BLOCK_TYPE_KEYS[code];
    if (blockType == null) return false;
    window.dispatchEvent(new CustomEvent('selectObjectType', { detail: { type: blockType, checkNull: true } }));
    this.exclusiveAction.pendingExit = true;
    return true;
  }

  // Adds or removes an object's physics body from the live Matter world based on
  // its z depth: only z == 0 objects collide (matches Level.addObject).
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

  // Marks a block as decorative/non-colliding by nudging its z off the 0 plane,
  // removing/re-adding the physics body immediately so it stops colliding the
  // moment you toggle it. `objects` defaults to the current selection;
  // multiselect passes the whole group.
  toggleIntangibility(objects) {
    if (objects == null) objects = app.selectedObject ? [app.selectedObject] : [];
    if (objects.length === 0) return;
    if (this.canPerformEditorAction() == false && this.isMultiselectTransform() == false) return;

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

      this.updateObjectPhysicsState(obj);
      obj.updateMatrixWorld();
      window.dispatchEvent(new CustomEvent('objectChange', { detail: obj }));
    });

    this.updateRender();
    this.controlsTransform.dispatchEvent({ type: 'change' });
  }
}

export { LevelEditor };