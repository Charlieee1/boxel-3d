import { Vector2, Vector3 } from 'three';
import { Composite, World } from 'matter-js';
import { PuttyControls } from './PuttyControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

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

    // Drag-to-move (hold Q): grab a block under the cursor and slide it; not gated by `exclusiveAction` below.
    this.dragMove = {
      enabled: false,        // true while Q is held
      state: 'static',       // 'static' | 'moving'
      offset: { x: 0, y: 0 }, // grab point relative to the block origin (unsnapped)
      moved: false           // true once the grabbed block has actually been repositioned
    };

    // The one editor action allowed to run at a time; null when idle, else { name, confirm(), cancel() }.
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
      // During a group transform the attached object is the control block, not a real object — skip body-sync/save.
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
    this.updateRender();
  }

  // Whether an editor mode (drag-move, fast/thin build, multiselect marquee/refine) suppresses vanilla clicking; transform stage is not suppressed.
  isVanillaClickingSuppressed() {
    return this.dragMove.enabled
      || this.exclusiveAction?.name === 'fast-build'
      || this.exclusiveAction?.name === 'thin-build'
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
    // Camera stays movable while building — the stages track free mouse movement so orbit doesn't conflict.
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

  thinBuildPointerMove(e) {
    var action = this.exclusiveAction;
    if (action.block == null) return; // no block yet: still waiting for pointerdown

    var pos = app.mouse.getPosition(e);
    var origin = action.origin;
    var dx = pos.x - origin.x;
    var dy = pos.y - origin.y;
    var length = Math.hypot(dx, dy);
    var angle = Math.atan2(dy, dx);
    if (app.mouse.snap > 1) {
      angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12); // 15 degree steps
      length = app.mouse.snapToValue(length, app.mouse.snap);
    }
    length = Math.max(length, app.mouse.snap); // never collapse to a zero-length block
    var endX = origin.x + Math.cos(angle) * length;
    var endY = origin.y + Math.sin(angle) * length;

    app.level.setObjectProperties(action.block, {
      position: { x: 0.5 * (origin.x + endX), y: 0.5 * (origin.y + endY), z: 0 },
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

  startMultiselect() {
    var action = this.startExclusiveAction('multiselect', {
      confirm: () => this.enterMultiselectRefine(),
      cancel: () => this.cleanupMultiselect()
    });
    this.setExclusiveActionStage('marquee');
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
    this.setExclusiveActionStage('refine');
    action.confirm = () => this.enterMultiselectTransform();
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

    // Select it so the transform gizmo attaches.
    app.level.deselectLevel();
    app.selectedObject = block;
    block.select(true);
    this.attachControls(block);

    this.setExclusiveActionStage('transform');
    action.confirm = () => this.confirmMultiselectTransform();
    action.cancel = () => this.cancelMultiselectTransform();
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
    // Objects are already at their transformed positions — drop the control block and collapse history into one entry.
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
            // During a group transform, copy the clicked block's color onto every selected block (never the control block).
            if (this.isMultiselectTransform()) {
              var action = this.exclusiveAction;
              if (target !== action.controlBlock) {
                // No history entry here — recoloring is folded into the transform's own single entry on confirm/cancel.
                action.selected.forEach(obj => obj.setColors(target.color));
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
    // During multiselect, "D" acts on the whole group (transform stage only) — return before the selectedObject deref below.
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
  startExclusiveAction(name, { confirm, cancel } = {}) {
    this.exclusiveAction = {
      name: name,
      confirm: confirm || (() => this.endExclusiveAction()),
      cancel: cancel || (() => this.endExclusiveAction())
    };
    window.dispatchEvent(new CustomEvent('levelEditorActionStarted', { detail: { name } }));
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