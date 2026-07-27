<script setup>
  import { onMounted, onUnmounted, ref } from 'vue';
  import ButtonSettings from './ButtonSettings.vue';
  import Controls from './Controls.vue';
  import FancyPopup from './FancyPopup.vue';
  import ThemedIcon from './ThemedIcon.vue';
  import { themes } from '../js/Data.js';

  const emit = defineEmits(['setPage']);
  const drawMode = ref('draw');
  const objectType = ref(app.levelEditor.selectedObjectType || 'cube');
  const objectTypeVisible = ref(true);
  const selectedObject = ref();
  const selectedTheme = ref(app.level.theme);
  const selectedMode = ref(app.levelEditor.controlsTransform.mode);
  const coordinates = ref('0, 0, 0');
  const currentZ = ref(app.levelEditor.currentZ || 0); // "current Z": new blocks spawn here, "0" key resets to here
  const defaultColor = ref(app.level.defaultBlockColor || app.level.getTheme(app.level.theme).color); // effective default new-block color
  const levelPropertiesPopupVisible = ref(false);
  const zoomValue = ref(app.level.zoom || 180);
  const disableManualCheckpointRespawnValue = ref(app.level.disableManualCheckpointRespawn || false);
  const levelUITextValue = ref(app.level.levelUIText || '');
  const resetPropertiesPopupVisible = ref(false);
  const isClosed = ref(true); // Popup animation state
  const isClosing = ref(false);
  const isInputEnabled = ref(true);
  const textOverlay = ref();
  const textOverlayRows = [];
  const blockTypePickerVisible = ref(false);
  const hoveredBlockType = ref(null);

  // Populates the "A" block-type picker's 4x4 grid, matching the toolbar's object-type column; `null` = empty tile.
  const BLOCK_TYPE_GRID = [
    { type: 'cube', label: 'Cube', icon: 'cube.svg' },
    { type: 'tip', label: 'Tip', icon: 'tip.svg' },
    { type: 'bounce', label: 'Bounce', icon: 'bounce.svg' },
    { type: 'checkpoint', label: 'Checkpoint', icon: 'checkpoint.svg' },
    { type: 'spike', label: 'Spike', icon: 'spike.svg' },
    { type: 'resize', label: 'Resize', icon: 'grow.svg' },
    { type: 'direction', label: 'Direction', icon: 'direction.svg' },
    { type: 'gravity', label: 'Gravity', icon: 'gravity.svg' },
    { type: 'grapple', label: 'Grapple', icon: 'grapple.svg' },
    { type: 'finish', label: 'Finish', icon: 'finish.svg' },
    { type: 'reset', label: 'Reset', icon: 'reset.svg' },
    { type: 'control', label: 'Control', icon: 'control.svg' },
    { type: 'power', label: 'Power', icon: 'power.svg' },
    { type: 'teleport', label: 'Teleport', icon: 'teleport.svg' },
    null,
    null
  ];

  // Default property set and per-block-type overrides for the object-options properties panel
  const BLOCK_PROPERTIES_CONFIG = {
    default: {
      static: true,
      friction: true,
      text: true,
      color: true,
      opacity: true,
      deathBlock: false
    },
    overrides: {
      'cube': { text: false, deathBlock: true },
      'tip': { friction: false },
      'bounce': { text: false },
      'checkpoint': { friction: false, text: false },
      'spike': { text: false },
      'resize': { friction: false, text: false },
      'direction': { text: false },
      'gravity': { friction: false, text: false },
      'grapple': { text: false },
      'finish': { text: false },
      'reset': { friction: false, text: false },
      'control': { friction: false, text: false },
      'power': { friction: false, text: false },
      'teleport': { friction: false },
      'player': { static: false, text: false, color: false }
    }
  };

  // Whether a given block type shows a given property control in the properties panel
  function isPropertyEnabled(blockClass, propertyName) {
    const blockOverrides = BLOCK_PROPERTIES_CONFIG.overrides[blockClass] || {};
    const blockConfig = { ...BLOCK_PROPERTIES_CONFIG.default, ...blockOverrides };
    return blockConfig[propertyName] !== false;
  }

  // Blocking editor states shown in the overlay; key-held submodes are omitted
  const EXCLUSIVE_ACTION_LABELS = {
    'multiselect': 'Multiselect',
    'fast-build': 'Fast Build',
    'thin-build': 'Thin Build',
    'cut-out': 'Cut Out',
    'set-pivot': 'Set Pivot'
  };

  // Stages shown as a second row layered above a blocking state's base label
  const EXCLUSIVE_ACTION_STAGE_LABELS = {
    'fast-build': { create: 'Create', scale: 'Scale', rotate: 'Rotate', move: 'Move' },
    // "anchor" only occurs for "P" chain, which reuses this same 'multiselect' name/staging (see LevelEditor.armChainMode()).
    'multiselect': { marquee: 'Box Select', refine: 'Refine', transform: 'Transform', anchor: 'Mark Anchors' }
  };

  // Third row shown during multiselect transform + scale mode, reflecting the current scale-lock cycle
  const SCALE_LOCK_LABELS = {
    'free': 'Scale (Unlocked)',
    'xy-locked': 'Scale (Locked XY)',
    'xyz-locked': 'Scale (Locked XYZ)'
  };

  let currentActionLabel = null; // exact text of the currently shown exclusive-action row, for precise removal
  let stageRowActive = false; // whether the top (stage) row is currently shown
  let currentStageLabel = null; // exact text of the currently shown stage row, for precise removal
  let scaleLockRowActive = false; // whether the scale-lock row is currently shown
  let currentScaleLockLabel = null; // exact text of the currently shown scale-lock row, for precise removal
  let flipChordRowActive = false; // whether the "Flip (Pending)" row is currently shown

  // Arms/clears the "B,_" flip chord row; kept separate from the addRow/removeRow stack since it can start/end independently of any other row.
  function onFlipChordArmed() {
    if (flipChordRowActive) return;
    addRow('Flip (Pending)');
    flipChordRowActive = true;
  }

  function onFlipChordCleared() {
    if (!flipChordRowActive) return;
    removeRowByText('Flip (Pending)');
    flipChordRowActive = false;
  }

  // Shows/hides the persistent "Force Build" row; independent of the addRow/removeRow LIFO stack, like the flip-chord row.
  let forceBuildRowActive = false;

  function onForceBuildEnabled() {
    if (forceBuildRowActive) return;
    addRow('Force Build');
    forceBuildRowActive = true;
  }

  function onForceBuildDisabled() {
    if (!forceBuildRowActive) return;
    removeRowByText('Force Build');
    forceBuildRowActive = false;
  }

  // Shows/hides the persistent "Vertex Snap"/"Centre Snap" row (","), same independent-of-the-stack mechanism as Force Build.
  let snapModeRowActive = false;
  let currentSnapModeLabel = null;

  function onSnapModeChanged(e) {
    if (snapModeRowActive) {
      removeRowByText(currentSnapModeLabel);
      snapModeRowActive = false;
      currentSnapModeLabel = null;
    }
    var label = e.detail.mode === 'vertex' ? 'Vertex Snap' : e.detail.mode === 'centre' ? 'Centre Snap' : null;
    if (label) {
      addRow(label);
      currentSnapModeLabel = label;
      snapModeRowActive = true;
    }
  }

  // Shows/hides/refreshes the scale-lock row based on current mode + multiselect transform state
  function updateScaleLockRow() {
    if (scaleLockRowActive) {
      removeRowByText(currentScaleLockLabel);
      currentScaleLockLabel = null;
      scaleLockRowActive = false;
    }
    if (app.levelEditor.isMultiselectTransform() && selectedMode.value === 'scale') {
      var mode = app.levelEditor.exclusiveAction?.scaleMode || 'free';
      currentScaleLockLabel = SCALE_LOCK_LABELS[mode];
      addRow(currentScaleLockLabel);
      scaleLockRowActive = true;
    }
  }

  function onLevelEditorActionStarted(e) {
    if (e.detail.name === 'select-block-type') blockTypePickerVisible.value = true;
    // "P" chain reuses the 'multiselect' action name/staging (purpose 'chain') - show "Chain" instead of "Multiselect".
    const label = (e.detail.name === 'multiselect' && e.detail.purpose === 'chain') ? 'Chain' : EXCLUSIVE_ACTION_LABELS[e.detail.name];
    if (label) {
      addRow(label);
      currentActionLabel = label;
    }
  }

  function onLevelEditorActionEnded(e) {
    if (e.detail.name === 'select-block-type') {
      blockTypePickerVisible.value = false;
      hoveredBlockType.value = null;
    }
    if (!EXCLUSIVE_ACTION_LABELS[e.detail.name]) return;
    if (scaleLockRowActive) {
      removeRowByText(currentScaleLockLabel);
      currentScaleLockLabel = null;
      scaleLockRowActive = false;
    }
    if (stageRowActive) {
      removeRowByText(currentStageLabel);
      currentStageLabel = null;
      stageRowActive = false;
    }
    // levelEditorActionEnded's detail carries only `name` (not `purpose`), so use the label tracked at start time rather than recomputing it.
    if (currentActionLabel) {
      removeRowByText(currentActionLabel);
      currentActionLabel = null;
    }
  }

  // Mouse hover on a picker tile: updates the highlight and drives the live type-preview in LevelEditor.js.
  function hoverBlockType(type) {
    hoveredBlockType.value = type;
    if (type != null) app.levelEditor.hoverBlockType(type);
    else app.levelEditor.clearHoveredBlockType();
  }

  // ESC/overlay-click close: revert the live preview and end the submode without saving history, same as the "V" cancel action.
  function closeBlockTypePicker() {
    app.levelEditor.cancelSelectBlockTypeMode();
  }

  function onLevelEditorActionStageChanged(e) {
    const stageLabel = EXCLUSIVE_ACTION_STAGE_LABELS[e.detail.name]?.[e.detail.stage];
    if (!stageLabel) return;
    if (scaleLockRowActive) {
      removeRowByText(currentScaleLockLabel);
      currentScaleLockLabel = null;
      scaleLockRowActive = false;
    }
    if (stageRowActive) removeRowByText(currentStageLabel);
    addRow(stageLabel);
    currentStageLabel = stageLabel;
    stageRowActive = true;
    updateScaleLockRow();
  }

  function addRow(text) {
    if (typeof text !== 'string' || text.length === 0) {
      console.error('addRow: text must be a non-empty string');
      return;
    }
    if (!textOverlay.value) {
      console.error('addRow: text overlay is not mounted');
      return;
    }

    textOverlayRows.push(text);
    textOverlay.value.textContent = textOverlayRows.join('\n');
  }

  function removeRow() {
    if (textOverlayRows.length === 0) {
      console.error('removeRow: no rows to remove');
      return;
    }
    if (!textOverlay.value) {
      console.error('removeRow: text overlay is not mounted');
      return;
    }

    textOverlayRows.pop();
    textOverlay.value.textContent = textOverlayRows.join('\n');
  }

  // Removes a specific row by its text instead of only the last one, so it can be cleared independently of the stack.
  function removeRowByText(text) {
    const index = textOverlayRows.lastIndexOf(text);
    if (index === -1 || !textOverlay.value) return;
    textOverlayRows.splice(index, 1);
    textOverlay.value.textContent = textOverlayRows.join('\n');
  }

  function addEventListeners() {
    window.addEventListener('exitLevel', resetBackground);
    window.addEventListener('setSelectedObject', setSelectedObject);
    window.addEventListener('objectChange', updateCoordinatesFromEvent);
    window.addEventListener('selectObjectType', selectObjectType);
    window.addEventListener('setTransformMode', setTransformMode);
    window.addEventListener('popupOpened', popupOpened);
    window.addEventListener('popupClosed', popupClosed);
    window.addEventListener('popupClosing', popupClosing);
    window.addEventListener('pointerdown', pointerdown);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('levelEditorActionStarted', onLevelEditorActionStarted);
    window.addEventListener('levelEditorActionEnded', onLevelEditorActionEnded);
    window.addEventListener('levelEditorActionStageChanged', onLevelEditorActionStageChanged);
    window.addEventListener('flipChordArmed', onFlipChordArmed);
    window.addEventListener('flipChordCleared', onFlipChordCleared);
    window.addEventListener('themeSelected', onThemeSelected);
    window.addEventListener('forceBuildEnabled', onForceBuildEnabled);
    window.addEventListener('forceBuildDisabled', onForceBuildDisabled);
    window.addEventListener('snapModeChanged', onSnapModeChanged);
  }

  function removeEventListeners() {
    window.removeEventListener('exitLevel', resetBackground);
    window.removeEventListener('setSelectedObject', setSelectedObject);
    window.removeEventListener('objectChange', updateCoordinatesFromEvent);
    window.removeEventListener('selectObjectType', selectObjectType);
    window.removeEventListener('setTransformMode', setTransformMode);
    window.removeEventListener('popupOpened', popupOpened);
    window.removeEventListener('popupClosed', popupClosed);
    window.removeEventListener('pointerdown', pointerdown);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('levelEditorActionStarted', onLevelEditorActionStarted);
    window.removeEventListener('levelEditorActionEnded', onLevelEditorActionEnded);
    window.removeEventListener('levelEditorActionStageChanged', onLevelEditorActionStageChanged);
    window.removeEventListener('flipChordArmed', onFlipChordArmed);
    window.removeEventListener('flipChordCleared', onFlipChordCleared);
    window.removeEventListener('themeSelected', onThemeSelected);
    window.removeEventListener('forceBuildEnabled', onForceBuildEnabled);
    window.removeEventListener('forceBuildDisabled', onForceBuildDisabled);
    window.removeEventListener('snapModeChanged', onSnapModeChanged);
  }

  function popupOpened() {
    isClosed.value = false;
    isInputEnabled.value = false;
  }
  
  function popupClosed() {
    isClosed.value = true;
    isClosing.value = false;
  }

  function popupClosing() {
    isClosing.value = true;
    setTimeout(function() {
      isInputEnabled.value = true;
    }, 50);
  }

  function setDrawMode(mode) {
    drawMode.value = mode;
    app.mouse.setMode(mode);
  }

  function exitLevel() {
    app.levelEditor.exitLevel();
  }

  function saveLevel() {
    app.levelEditor.saveLevel();
  }

  // Polls every 10s (not a derived setInterval delay) so changing the slider mid-session takes effect immediately.
  let autosaveInterval = null;
  let lastAutosaveTime = 0;

  function checkAutosave() {
    if (app.play == true) return; // Matches Ctrl+S, which is paused-only.
    var minutes = app.storage.getSettings().autosave;
    if (!minutes || minutes <= 0) return;
    if (Date.now() - lastAutosaveTime >= minutes * 60000) {
      lastAutosaveTime = Date.now();
      saveLevel();
    }
  }

  function saveThumbnail() {
    app.pauseLevel();
    app.storage.screenshot({ width: 1280, height: 720, save: true });
  }

  function selectTheme(name) {
    // Deselect before recoloring level children
    rewind();
    app.level.deselectLevel();
    app.levelEditor.controlsTransform.detach();
    app.levelEditor.controlsPutty.detach();

    // Capture the old theme's default color first, so only blocks still matching it recolor
    const oldTheme = app.level.getTheme(app.level.theme);

    // Store current theme settings
    const theme = app.level.getTheme(name);
    selectedTheme.value = name;
    app.background.setTheme(theme.model);
    app.level.entityFactory.color = theme.color;
    if (app.level.defaultBlockColor) app.level.entityFactory.color = app.level.defaultBlockColor;
    app.level.theme = name;

    // Recreate current level with new theme data
    const json = app.level.exportToJSON();

    // Only recolor children still matching the old theme's default; manually-set colors are preserved
    json.children.forEach(child => {
      if (child.color && oldTheme && child.color === oldTheme.color) child.color = theme.color;
    });

    app.level.clearLevel();
    app.level.importFromJSON(json);
    app.levelHistory.save('Updated level theme');

    // Dispatch event
    window.dispatchEvent(new CustomEvent('themeSelected', { detail: theme }));
  }

  function undo() {
    app.levelEditor.undo();
  }

  function redo() {
    app.levelEditor.redo();
  }

  function rewind() {
    pauseLevel();
    app.levelEditor.rewind();
    app.levelEditor.controlsOrbit.target.copy(app.player.position);
  }

  function pauseLevel() {
    objectTypeVisible.value = true;
    app.pauseLevel();
    // Restore every object (including the player) to its real saved state - undoes playtest physics drift
    // and any "Set as start position" temp spawn override, same reset retryLevel() uses to start a fresh run.
    app.resetScene();
    app.level.deselectLevel();
    app.levelEditor.controlsOrbit.enabled = true;
    app.levelEditor.controlsOrbit.reset();
    app.levelEditor.controlsOrbit.target.copy(app.player.position);
    app.updateCamera();
    app.background.visible = false;
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
  }
  
  function playCurrentLevel() {
    objectTypeVisible.value = false;
    app.background.visible = true;
    app.level.deselectLevel();
    app.levelEditor.controlsOrbit.enabled = false;
    app.levelEditor.controlsOrbit.reset();
    app.levelEditor.controlsTransform.detach();
    app.levelEditor.controlsPutty.detach();
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
    // Playtest at the temporary "Set as start position" override if one is set (session-only, never saved - see the checkpoint panel button below)
    app.levelEditor.applyTempSpawn();
    app.startLevel();
  }

  function resetBackground() {
    objectTypeVisible.value = true;
  }

  function selectObjectType(e) {
    objectType.value = e.detail.type;
    app.levelEditor.selectObjectType(e.detail.type, e.detail.checkNull, e.detail.saveHistory);
  }

  function setSelectedObject(e) {
    if (e.detail) updateCoordinates(e.detail.position);
    selectedObject.value = e.detail;
  }

  function toggleSelectedObjectStaticState() {
    app.levelEditor.toggleSelectedObjectStaticState();
  }

  // Checkpoint property panel button: session-only playtest spawn override (see playCurrentLevel above).
  function setTempSpawnFromCheckpoint() {
    app.levelEditor.setTempSpawnFromCheckpoint(selectedObject.value);
  }

  function setTransformMode(e) {
    selectedMode.value = e.detail;
    app.levelEditor.setMode(e.detail);
    updateScaleLockRow();
  }

  function updateCoordinatesFromEvent(e) {
    const position = e.detail.position;
    updateCoordinates(position);
  }

  function updateCoordinatesFromMouse(e) {
    const position = app.mouse.getPosition(e);
    position.x = app.mouse.snapToValue(position.x, app.mouse.snap);
    position.y = app.mouse.snapToValue(position.y, app.mouse.snap);
    position.z = app.mouse.snapToValue(position.z, app.mouse.snap);
    updateCoordinates(position);
  }

  function updateCoordinates(position) {
    coordinates.value = `${ position.x }, ${ position.y }, ${ position.z }`;
  }

  function updatePositionFromEvent(e) {
    const points = e.target.value.split(',').map(point => point = parseInt(point) || 0);
    const position = { x: points[0] || 0, y: points[1] || 0, z: points[2] || 0 };
    if (selectedObject.value) {
      selectedObject.value.setPosition(position);
      app.levelEditor.updateSelectedObject();
      app.levelHistory.save('Updated object position');
    }
  }

  // "Current Z" textbox: new blocks spawn here, and "0" resets the selection here (level-editor only, no effect on gameplay).
  function updateCurrentZFromEvent(e) {
    const value = parseInt(e.target.value) || 0;
    currentZ.value = value;
    app.levelEditor.setCurrentZ(value);
  }

  function updateFriction(e) {
    selectedObject.value.setFriction(e.target.value);
    app.levelHistory.save('Updated object properties');
  }

  function updateColor(e) {
    selectedObject.value.setColors(e.target.value);
    app.levelHistory.save('Updated object properties');
  }

  function updateOpacity(e) {
    selectedObject.value.setOpacity(e.target.value);
    app.levelHistory.save('Updated object opacity');
  }

  function toggleDeathBlock() {
    selectedObject.value.setDeathBlock(!selectedObject.value.getDeathBlock());
    app.levelHistory.save('Updated death block');
  }

  // Level Properties popup: sets the level's persisted default new-block color and refreshes the live runtime cache
  function updateDefaultColor(e) {
    app.level.defaultBlockColor = e.target.value;
    app.level.entityFactory.color = e.target.value;
    defaultColor.value = e.target.value;
    app.levelHistory.save('Updated default block color');
  }

  // Level Properties popup: clears the default block color back to the current theme's color
  function clearDefaultColor() {
    app.level.defaultBlockColor = null;
    const theme = app.level.getTheme(app.level.theme);
    app.level.entityFactory.color = theme.color;
    defaultColor.value = theme.color;
    app.levelHistory.save('Cleared default block color');
  }

  // Level Properties popup: sets the level's zoom
  function updateZoom(e) {
    const value = parseInt(e.target.value) || 180;
    zoomValue.value = value;
    app.level.zoom = value;
    app.levelHistory.save('Updated zoom');
  }

  // Level Properties popup: clears zoom back to the default (180)
  function clearZoom() {
    app.level.zoom = undefined;
    zoomValue.value = 180;
    app.levelHistory.save('Cleared zoom');
  }

  // Level Properties popup: toggles whether manual checkpoint respawn (C key/button) is disabled
  function updateDisableManualCheckpointRespawn(e) {
    app.level.disableManualCheckpointRespawn = e.target.checked;
    disableManualCheckpointRespawnValue.value = e.target.checked;
    app.levelHistory.save('Updated manual checkpoint respawn setting');
  }

  // Level Properties popup: clears manual checkpoint respawn back to the default (false, i.e. enabled)
  function clearDisableManualCheckpointRespawn() {
    app.level.disableManualCheckpointRespawn = false;
    disableManualCheckpointRespawnValue.value = false;
    app.levelHistory.save('Cleared manual checkpoint respawn setting');
  }

  // Level Properties popup: updates the level's overlay text (rendered via innerHTML, HTML tags allowed intentionally)
  function updateLevelUIText(e) {
    const text = e.target.value;
    app.level.levelUIText = text;
    levelUITextValue.value = text;
    if (app.levelUIText) app.levelUIText.innerHTML = text;
    app.levelHistory.save('Updated level UI text');
  }

  // Level Properties popup: clears the level's overlay text
  function clearLevelUIText() {
    app.level.levelUIText = '';
    levelUITextValue.value = '';
    if (app.levelUIText) app.levelUIText.innerHTML = '';
    app.levelHistory.save('Cleared level UI text');
  }

  // Reset block properties popup: opens the checkbox list for the selected reset block
  function openResetPropertiesPopup() {
    resetPropertiesPopupVisible.value = true;
  }

  // Reset block properties popup: toggles a single reset flag for the selected reset block
  function updateResetConfig(key, e) {
    selectedObject.value.setResetConfig({ [key]: e.target.checked });
    app.levelHistory.save('Updated reset block properties');
  }

  // Level Properties popup: clears theme back to the default ('classic')
  function clearTheme() {
    app.level.theme = undefined;
    selectedTheme.value = 'classic';
    app.levelHistory.save('Cleared theme');
  }

  // Keeps the default-color swatch synced when a theme switch changes the effective default
  function onThemeSelected(e) {
    defaultColor.value = app.level.defaultBlockColor || e.detail.color;
  }

  function changeText() {
    // Dispatch new popup from event
    window.dispatchEvent(new CustomEvent('openPopup', {
      detail: {
        text: 'Edit',
        inputs: [
          { value: app.selectedObject.text, type: 'text', callback: updateText },
          { value: 'Cancel', type: 'button' },
          { value: 'Close', type: 'button' }
        ]
      }
    }));
  }

  // "]" popup: type an exact camera X/Y; each input applies immediately on change, no confirm step needed.
  function openSetCameraPositionPopup() {
    window.dispatchEvent(new CustomEvent('openPopup', {
      detail: {
        text: 'Set Camera Position',
        inputs: [
          { label: 'X', type: 'text', value: Math.round(app.camera.position.x), callback: (e) => app.levelEditor.setCameraX(e.target.value) },
          { label: 'Y', type: 'text', value: Math.round(app.camera.position.y), callback: (e) => app.levelEditor.setCameraY(e.target.value) },
          { value: 'Close', type: 'button' }
        ]
      }
    }));
  }

  function duplicateSelectedObject() {
    app.levelEditor.duplicateSelectedObject(app.levelEditor.duplicateOffset);
    setSelectedObject({ detail: app.selectedObject });
    window.dispatchEvent(new CustomEvent('setSelectedObject', { detail: app.selectedObject }));
  }

  function deleteSelectedObject() {
    app.levelEditor.deleteSelectedObject();
  }

  function updateText(e) {
    app.selectedObject.setText(e.target.value);
    app.levelHistory.save('Updated tip');
  }

  function pointerdown(e) {
    // Make sure popup is closed
    if (isClosed.value == true || isClosing.value === true) {
      // Enable input immediately
      isInputEnabled.value = true;
    }
  }

  function keydown(e) {
    // Track key state for editor transforms (Shift-duplicate) and putty lock.
    app.levelEditor.keys[e.code] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') app.levelEditor.controlsPutty.lockRotation = true;

    // Ignore keyboard shortcuts when typing in an input field
    const targetTagName = e?.target?.tagName;
    if (targetTagName === 'INPUT' || targetTagName === 'TEXTAREA') return;

    // Make sure popup is closed
    if (isClosed.value == true || isClosing.value === true) {
      // Jump if one of the keys is pressed
      var jumpKeys = ['Space', 'Enter', 'ArrowUp', 'KeyW'];

      // Hold Q to drag-move blocks directly (works while playing and editing)
      if (e.code === 'KeyQ') app.levelEditor.enableDragMove();

      if (app.play == true) {
        if (e.code == 'Escape' || e.code == 'KeyE') {
          e.preventDefault();
          pauseLevel();
        }
        else if (e.code == 'KeyA' || e.code == 'ArrowLeft') {
          app.player.setControls('left', -1);
        }
        else if (e.code == 'KeyD' || e.code == 'ArrowRight') {
          app.player.setControls('right', 1);
        }
        else if (e.code == 'KeyR') {
          app.level.retryLevel();
        }
        else if (e.code == 'KeyC') {
          app.player.restart();
        }
        else {
          if (isInputEnabled.value === true && jumpKeys.includes(e.code)) {
            // Jump if one of the keys is pressed
            app.player.jump();
          }

          // Enable input immediately
          isInputEnabled.value = true;
        }
      }
      else {
        // Any key other than B/N invalidates a pending "B,_" chord immediately, so a stale wait never lingers.
        if (e.code !== 'KeyB' && e.code !== 'KeyN' && app.levelEditor.chordPending !== null) {
          app.levelEditor.chordPending = null;
          window.dispatchEvent(new CustomEvent('flipChordCleared'));
        }

        if (e.code == 'Digit0') {
          app.levelEditor.resetZAxis();
        }
        else if (e.code == 'Escape' || e.code == 'KeyE') {
          e.preventDefault();
          exitLevel();
        }
        else if (e.code == 'KeyD') {
          duplicateSelectedObject();
        }
        else if (e.code == 'KeyG' || e.code == 'KeyT') {
          setTransformMode({ detail: 'translate' });
        }
        else if (e.code == 'KeyF') {
          setTransformMode({ detail: 'putty' });
        }
        else if (e.code == 'KeyR') {
          // Toggle rotation axis visibility before setting mode
          if (app.levelEditor.controlsTransform.mode == 'rotate') {
            app.levelEditor.controlsTransform.showAll = !app.levelEditor.controlsTransform.showAll;
          }
          setTransformMode({ detail: 'rotate' });
        }
        else if (e.code == 'KeyS') {
          if (e.ctrlKey == true) {
            e.preventDefault();
            app.levelEditor.saveLevel();
          }
          else if (app.levelEditor.isMultiselectTransform() && app.levelEditor.selectedMode === 'scale') {
            app.levelEditor.cycleMultiselectScaleMode();
            updateScaleLockRow();
          }
          else setTransformMode({ detail: 'scale' });
        }
        else if (e.code == 'KeyX') {
          app.levelEditor.deleteSelectedObject();
        }
        else if (e.code == 'KeyZ' && e.ctrlKey) {
          if (e.shiftKey == false) app.levelEditor.undo();
          if (e.shiftKey == true) app.levelEditor.redo();
        }
        // Toggle intangibility (Ctrl/Cmd-guarded to avoid the devtools shortcut)
        else if (e.code == 'KeyI' && e.ctrlKey == false && e.metaKey == false) {
          if (app.levelEditor.isMultiselectTransform()) app.levelEditor.toggleGroupIntangibility();
          else app.levelEditor.toggleIntangibility();
        }
        // Confirm / cancel the active exclusive action
        else if (e.code == 'KeyC' && app.levelEditor.canConfirmAction()) {
          app.levelEditor.confirmAction();
        }
        else if (e.code == 'KeyV') {
          app.levelEditor.cancelAction();
        }
        // Arm the select-block-type submode (Ctrl/Cmd-guarded vs "select all")
        else if (e.code == 'KeyA' && e.ctrlKey == false && e.metaKey == false) {
          app.levelEditor.enterSelectBlockTypeMode();
        }
        // Fast build / multiselect toggles
        else if (e.code == 'KeyK' && e.ctrlKey == false && e.metaKey == false) {
          app.levelEditor.toggleFastBuild();
        }
        else if (e.code == 'KeyM' && e.ctrlKey == false && e.metaKey == false) {
          app.levelEditor.toggleMultiselect();
        }
        else if (e.code == 'KeyL' && e.ctrlKey == false && e.metaKey == false) {
          app.levelEditor.toggleThinBuild();
        }
        else if (e.code == 'KeyH' && e.ctrlKey == false && e.metaKey == false) {
          app.levelEditor.toggleHoverPreview();
        }
        // Flip chord (B,B = XZ, B,N = YZ); repeat-guarded so held-key auto-repeat can't flood history.
        else if (e.code == 'KeyB' && e.ctrlKey == false && e.metaKey == false && e.repeat == false) {
          app.levelEditor.handleChordB();
        }
        else if (e.code == 'KeyN' && e.ctrlKey == false && e.metaKey == false && e.repeat == false) {
          if (e.shiftKey == true) {
            app.levelEditor.deselectCurrentObject();
          }
          else {
            app.levelEditor.handleChordN();
          }
        }
        else if (e.code == 'BracketLeft') {
          app.levelEditor.resetCameraZRotation();
        }
        else if (e.code == 'BracketRight') {
          openSetCameraPositionPopup();
        }
        else if (e.code == 'Slash' && e.ctrlKey == false && e.metaKey == false) {
          e.preventDefault();
          app.levelEditor.enterCutOutMode();
        }
        else if (e.code == 'Comma' && e.ctrlKey == false && e.metaKey == false) {
          app.levelEditor.cycleSnapMode();
        }
        else if (e.code == 'Period' && e.ctrlKey == false && e.metaKey == false) {
          app.levelEditor.armCustomPivot();
        }
        else if (e.code == 'KeyP' && e.ctrlKey == false && e.metaKey == false) {
          app.levelEditor.armChainMode();
        }
      }
    }

    app.levelEditor.updateRender();
  }

  function keyup(e) {
    // Clear key state and release the editor's Shift-driven modes.
    app.levelEditor.keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') app.levelEditor.controlsPutty.lockRotation = false;
    if (e.code === 'KeyQ') app.levelEditor.disableDragMove();

    // Releasing "A" commits the block-type picker's currently hovered tile.
    if (e.code === 'KeyA' && app.levelEditor.exclusiveAction?.name === 'select-block-type') {
      app.levelEditor.exitSelectBlockTypeMode();
    }

    // Stop player movement (during play).
    if (e.code == 'KeyA' || e.code == 'ArrowLeft') {
      app.player.setControls('left', 0);
    }
    else if (e.code == 'KeyD' || e.code == 'ArrowRight') {
      app.player.setControls('right', 0);
    }

    app.levelEditor.updateRender();
  }

  onMounted(function() {
    // Run function after being mounted (visible)
    app.canvas.classList.remove('hidden');
    addEventListeners();
    lastAutosaveTime = Date.now();
    autosaveInterval = setInterval(checkAutosave, 10000);

    // Dispatch ready event to listeners
    window.dispatchEvent(new CustomEvent('pageMounted', { detail: 'level-editor' }));
  })

  onUnmounted(function() {
    // Run function after being unmounted (removed);
    app.canvas.classList.add('hidden');
    removeEventListeners();
    clearInterval(autosaveInterval);
  });
</script>

<template>
  <div class="level-editor">
    <div class="row top">
      <div class="col options-level">
        <a class="item" :class="{ selected: drawMode == 'draw' }" @click="setDrawMode('draw')" action="draw" title="Draw cubes"><ThemedIcon src="./svg/pencil.svg" /></a>
        <a class="item" :class="{ selected: drawMode == 'erase' }" @click="setDrawMode('erase')" action="erase" title="Erase cubes"><ThemedIcon src="./svg/eraser.svg" /></a>
        <a class="item" @click="exitLevel" title="Exit level editor (ESC)"><ThemedIcon src="./svg/home.svg" /></a>
        <a class="item" @click="saveLevel" title="Save level (Ctrl + S)"><ThemedIcon src="./svg/save.svg" /></a>
        <a class="item" @click="saveThumbnail" title="Save Screenshot"><ThemedIcon src="./svg/eye.svg" /></a>
        <a class="item" @click="undo" title="Undo edit (Ctrl + Z)"><ThemedIcon src="./svg/undo.svg" /></a>
        <a class="item" @click="redo" title="Redo edit (Ctrl + Shift + Z)"><ThemedIcon src="./svg/redo.svg" /></a>
        <a class="item" @click="rewind" title="Restart level"><ThemedIcon src="./svg/rewind.svg" /></a>
        <a class="item" @click="pauseLevel" title="Pause level"><ThemedIcon src="./svg/pause.svg" /></a>
        <a class="item" @click="playCurrentLevel" title="Play level"><ThemedIcon src="./svg/play.svg" /></a>
        <a class="item auto" title="Play level" v-if="selectedObject">
          <input class="coordinates"
            v-model="coordinates"
            v-on:keyup.enter="$event.target.blur()"
            @change="updatePositionFromEvent($event)"
          >
        </a>
        <a class="item auto" title="Current Z (new blocks spawn here; &quot;0&quot; resets selection here)">
          <input class="current-z"
            v-model="currentZ"
            v-on:keyup.enter="$event.target.blur()"
            @change="updateCurrentZFromEvent($event)"
          >
        </a>
        <a class="item last" :class="{ selected: levelPropertiesPopupVisible == true }" @click="levelPropertiesPopupVisible = !levelPropertiesPopupVisible" title="Level Properties"><ThemedIcon src="./svg/control.svg" /></a>
        <ButtonSettings class="item" />
      </div>
    </div>
    <div class="row left" v-if="drawMode == 'draw' && objectTypeVisible == true">
      <div class="col object-type">
        <a class="item" :class="{ selected: objectType == 'cube' }" @click="selectObjectType({ detail: { type: 'cube' }})" title="Basic cube"><ThemedIcon src="./svg/cube.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'tip' }" @click="selectObjectType({ detail: { type: 'tip' }})" title="Tip cube"><ThemedIcon src="./svg/tip.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'bounce' }" @click="selectObjectType({ detail: { type: 'bounce' }})" title="Bounce cube"><ThemedIcon src="./svg/bounce.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'checkpoint' }" @click="selectObjectType({ detail: { type: 'checkpoint' }})" title="Checkpoint cube"><ThemedIcon src="./svg/checkpoint.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'spike' }" @click="selectObjectType({ detail: { type: 'spike' }})" title="Spike cube"><ThemedIcon src="./svg/spike.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'resize' }" @click="selectObjectType({ detail: { type: 'resize' }})" title="Resize cube"><ThemedIcon src="./svg/grow.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'direction' }" @click="selectObjectType({ detail: { type: 'direction' }})" title="Direction cube"><ThemedIcon src="./svg/direction.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'gravity' }" @click="selectObjectType({ detail: { type: 'gravity' }})" title="Gravity cube"><ThemedIcon src="./svg/gravity.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'grapple' }" @click="selectObjectType({ detail: { type: 'grapple' }})" title="Grapple cube"><ThemedIcon src="./svg/grapple.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'finish' }" @click="selectObjectType({ detail: { type: 'finish' }})" title="Finish cube"><ThemedIcon src="./svg/finish.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'reset' }" @click="selectObjectType({ detail: { type: 'reset' }})" title="Reset cube"><ThemedIcon src="./svg/reset.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'control' }" @click="selectObjectType({ detail: { type: 'control' }})" title="Control cube"><ThemedIcon src="./svg/control.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'power' }" @click="selectObjectType({ detail: { type: 'power' }})" title="Power cube"><ThemedIcon src="./svg/power.svg" /></a>
        <a class="item" :class="{ selected: objectType == 'teleport' }" @click="selectObjectType({ detail: { type: 'teleport' }})" title="Teleport cube"><ThemedIcon src="./svg/teleport.svg" /></a>
      </div>
      <div class="col object-options" v-if="selectedObject != null">
        <div class="properties-section">
          <a
            v-if="isPropertyEnabled(selectedObject.getClass(), 'static')"
            class="item"
            :class="{ selected: selectedObject.isStatic() }"
            @click="toggleSelectedObjectStaticState"
            title="Pin"
          ><ThemedIcon src="./svg/pin.svg" /></a>
          <div v-if="isPropertyEnabled(selectedObject.getClass(), 'color')" class="item">
            <label title="Color">
              <input name="color" type="color" :value="selectedObject.color" @change="updateColor($event)">
            </label>
          </div>
          <div
            v-if="isPropertyEnabled(selectedObject.getClass(), 'friction')"
            class="item"
            :class="{ disabled: selectedObject.isStatic() }"
          >
            <a action="friction" title="Friction"><ThemedIcon class="icon-medium" src="./svg/friction.svg" /></a>
            <div class="slider"><input name="friction" type="range" min="0" max="1" step="0.25" :value="selectedObject.getFriction()" @change="updateFriction($event)"></div>
          </div>
          <div v-if="isPropertyEnabled(selectedObject.getClass(), 'opacity')" class="item item-medium">
            <a action="opacity" title="Opacity"><ThemedIcon class="icon-medium" src="./svg/opacity.svg" /></a>
            <div class="slider"><input name="opacity" type="range" min="0" max="1" step="0.01" :value="selectedObject.getOpacity()" @change="updateOpacity($event)"></div>
          </div>
          <a
            v-if="isPropertyEnabled(selectedObject.getClass(), 'text')"
            class="item"
            :class="{ disabled: selectedObject.textEnabled === false }"
            @click="changeText"
            title="Text"
          ><ThemedIcon src="./svg/type.svg" /></a>
          <a v-if="selectedObject.getClass() === 'checkpoint'" class="item" @click="setTempSpawnFromCheckpoint" title="Set as start position (temporary, for playtesting only)"><ThemedIcon src="./svg/play.svg" /></a>
          <a
            v-if="isPropertyEnabled(selectedObject.getClass(), 'deathBlock')"
            class="item item-medium"
            :class="{ selected: selectedObject.getDeathBlock() }"
            @click="toggleDeathBlock"
            title="Death Block (instant kill on touch)"
          ><ThemedIcon class="icon-medium" src="./svg/skull.svg" /></a>
          <a v-if="selectedObject.getClass() === 'reset'" class="item" @click="openResetPropertiesPopup" title="Configure what this reset block resets"><ThemedIcon src="./svg/gear.svg" /></a>
        </div>
        <div class="properties-separator"></div>
        <div class="operations-section">
          <a class="item" :class="{ selected: selectedMode == 'translate'}" @click="setTransformMode({ detail: 'translate' })" title="Move (T or G)"><ThemedIcon src="./svg/move.svg" /></a>
          <a class="item" :class="{ selected: selectedMode == 'scale'}" @click="setTransformMode({ detail: 'scale' })" title="Scale (S)"><ThemedIcon src="./svg/scale-out-x.svg" /></a>
          <a class="item" :class="{ selected: selectedMode == 'rotate'}" @click="keydown({ code: 'KeyR' });" title="Rotate (R)"><ThemedIcon src="./svg/rotate-clockwise.svg" /></a>
          <a class="item" :class="{ selected: selectedMode == 'putty'}" @click="keydown({ code: 'KeyF' });" title="Putty (F)"><ThemedIcon src="./svg/putty.svg" /></a>
          <a class="item" @click="duplicateSelectedObject" title="Duplicate (D)"><ThemedIcon src="./svg/duplicate.svg" /></a>
          <a class="item" @click="deleteSelectedObject" title="Delete (X)"><ThemedIcon src="./svg/trash.svg" /></a>
        </div>
      </div>
    </div>
    <div class="text-overlay" ref="textOverlay"></div>
    <FancyPopup v-model="blockTypePickerVisible" :on-close="closeBlockTypePicker">
      <div class="grid" @mouseleave="hoverBlockType(null)">
        <div
          v-for="(entry, i) in BLOCK_TYPE_GRID"
          :key="i"
          class="tile"
          :class="{ filled: entry != null, hovered: entry != null && hoveredBlockType == entry.type }"
          @mouseenter="hoverBlockType(entry ? entry.type : null)"
        >
          <template v-if="entry != null">
            <ThemedIcon :src="'./svg/' + entry.icon" />
            <span>{{ entry.label }}</span>
          </template>
        </div>
      </div>
    </FancyPopup>
    <FancyPopup v-model="levelPropertiesPopupVisible" title="Level Properties" class="level-properties-popup">
      <div class="level-properties">
        <div class="property-row">
          <span class="label">Zoom</span>
          <input type="range" min="80" max="280" step="20" :value="zoomValue" @input="updateZoom($event)">
          <span class="value">{{ zoomValue }}</span>
          <a class="delete" @click="clearZoom" title="Reset to default"><ThemedIcon src="./svg/trash.svg" /></a>
        </div>
        <div class="property-row">
          <span class="label">Theme</span>
          <select :value="selectedTheme" @change="selectTheme($event.target.value)">
            <option v-for="(theme, name) in themes" :key="name" :value="name">{{ name }}</option>
          </select>
          <a class="delete" @click="clearTheme" title="Reset to default"><ThemedIcon src="./svg/trash.svg" /></a>
        </div>
        <div class="property-row">
          <span class="label">Default Block Color</span>
          <input type="color" :value="defaultColor" @change="updateDefaultColor($event)">
          <a class="delete" @click="clearDefaultColor" title="Reset to default"><ThemedIcon src="./svg/trash.svg" /></a>
        </div>
        <div class="property-row">
          <span class="label">Disable Manual Respawn</span>
          <input type="checkbox" :checked="disableManualCheckpointRespawnValue" @change="updateDisableManualCheckpointRespawn($event)">
          <a class="delete" @click="clearDisableManualCheckpointRespawn" title="Reset to default"><ThemedIcon src="./svg/trash.svg" /></a>
        </div>
        <div class="property-row">
          <span class="label">Level UI Text</span>
          <textarea :value="levelUITextValue" @change="updateLevelUIText($event)"></textarea>
          <a class="delete" @click="clearLevelUIText" title="Clear"><ThemedIcon src="./svg/trash.svg" /></a>
        </div>
      </div>
    </FancyPopup>
    <FancyPopup v-model="resetPropertiesPopupVisible" title="Reset Block Properties" v-if="selectedObject">
      <div class="level-properties reset-properties" v-if="selectedObject.getClass() === 'reset'">
        <div class="property-row">
          <span class="label">Size</span>
          <input type="checkbox" :checked="selectedObject.getResetConfig().resetSize" @change="updateResetConfig('resetSize', $event)">
        </div>
        <div class="property-row">
          <span class="label">Player Mode</span>
          <input type="checkbox" :checked="selectedObject.getResetConfig().resetPlayerMode" @change="updateResetConfig('resetPlayerMode', $event)">
        </div>
        <div class="property-row">
          <span class="label">Force</span>
          <input type="checkbox" :checked="selectedObject.getResetConfig().resetForce" @change="updateResetConfig('resetForce', $event)">
        </div>
        <div class="property-row">
          <span class="label">Rotation (Z only)</span>
          <input type="checkbox" :checked="selectedObject.getResetConfig().resetRotation" @change="updateResetConfig('resetRotation', $event)">
        </div>
        <div class="property-row">
          <span class="label">Velocity</span>
          <input type="checkbox" :checked="selectedObject.getResetConfig().resetVelocity" @change="updateResetConfig('resetVelocity', $event)">
        </div>
        <div class="property-row">
          <span class="label">Angular Velocity</span>
          <input type="checkbox" :checked="selectedObject.getResetConfig().resetAngularVelocity" @change="updateResetConfig('resetAngularVelocity', $event)">
        </div>
        <div class="property-row">
          <span class="label">Player Checkpoint</span>
          <input type="checkbox" :checked="selectedObject.getResetConfig().resetPlayerCheckpoint" @change="updateResetConfig('resetPlayerCheckpoint', $event)">
        </div>
        <div class="property-row">
          <span class="label">Infinite Jump Mode</span>
          <input type="checkbox" :checked="selectedObject.getResetConfig().resetInfiniteJumpMode" @change="updateResetConfig('resetInfiniteJumpMode', $event)">
        </div>
      </div>
    </FancyPopup>
    <div class="footer">
      <Controls />
    </div>
  </div>
</template>