import { HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { Composite, Bodies, Body, Engine, Events } from 'matter-js';
import { Animation } from './Animation.js';
import { Utility } from './Utility.js';
import { Timer } from './Timer.js';
import { Assets } from './Assets.js';
import { Interval } from './Interval.js';
import { Graphics } from './Graphics.js';
import { StorageManager } from './StorageManager.js';
import { Collision } from './Collision.js';
import { Background } from './Background.js';
import { Level } from './Level.js';
import { convertLevel } from './LevelCompatibility.js';
import { PhysicsGrid } from './PhysicsGrid.js';
import { RenderGrid } from './RenderGrid.js';
import { LevelHistory } from './LevelHistory.js';
import { Player } from './entities/Player.js';
import { Mouse } from './Mouse.js';
import { LevelEditor } from './LevelEditor.js';
import { Multiplayer } from './Multiplayer.js';
import { Network } from './Network.js';
import { setDeterministicMath } from './math/DeterministicMath.js';
import themeSettings from '../json/themeSettings.json';
import { getThemePreset } from './ThemePresets.js';

class App {
  constructor() {
    this.window = window;
    this.document = document;
    this.BOX_SIZE = 16;
    this.screenWidth = this.window.innerWidth;
    this.screenHeight = this.window.innerHeight;
    this.engine = Engine.create();
    this.util = new Utility();
    this.state = 'home';
    this.animation = new Animation();
    this.storage = new StorageManager();
    this.updateMath(this.storage.getSettings()); // Before any physics body is built
    this.collision = new Collision();
    this.player = new Player({ x: 0, y: 0, z: 0 });
    this.play = false;
    this.fov = 75; // Default 75
    this.scene = new Scene();
    this.mouse = new Mouse();

    // Set global variables for mods
    this.window.Matter = { Composite: Composite, Bodies: Bodies, Body: Body };
    
    // Set time components
    this.timer = new Timer();
    this.interval = new Interval();
    this.lagTime = 0; // Anti-lag: physics time the engine loop dropped on slow frames, still to catch up
    this.lagBudget = 12; // Anti-lag: max milliseconds per frame spent on physics before catching up stops
    this.tickTime = 0; // Duration of the last physics tick (ms)
    this.then = new Date().getTime();
    this.now = this.then;
    this.delta = 0;
    
    // Initialize level components
    this.assets = new Assets();
    this.level = new Level();
    this.levelHistory = new LevelHistory();
    this.scene.add(this.level);
    this.scene.add(this.level.helpers);
    this.scene.add(this.player.light); // Out of the player so hiding it never changes the light count (see Player.syncLight)

    // Only bodies near moving ones are collision-checked, and only what the camera sees is drawn while playing
    this.physicsGrid = new PhysicsGrid(this.engine);
    this.renderGrid = new RenderGrid(this.level);
    this.scene.onBeforeRender = (renderer, scene, camera) => {
      this.updateCameraFar(camera);
      this.player.syncLight();
      if (this.isRenderGridActive()) this.renderGrid.begin(camera, this.getActiveEditorObjects());
    };
    this.scene.onAfterRender = () => this.renderGrid.end();

    // Initialize camera
    this.camera = new PerspectiveCamera(this.fov, this.screenWidth / this.screenHeight, 1, 5000); // Extended only for a zoomed out editor camera (see updateCameraFar)
    this.camera.tilt = 0;
    this.camera.position.x = 0;
    this.camera.position.y = 0;
    this.camera.position.zDefault = 180;
    this.camera.position.z = this.camera.position.zDefault;

    // Disable automatic matrix world updates for performance
    this.scene.matrixWorldAutoUpdate = false;

    // Add lighting to scene
    this.light = new HemisphereLight('#ffffff', '#000000', 1 * Math.PI); // PI was added after three.js r155
    this.light.position.set(0.25, 0.5, 1);
    this.scene.add(this.light);
    this.light.updateMatrixWorld();

    // Add background to scene
    this.background = new Background();
    this.scene.add(this.background);

    // Initialize network
    this.network = new Network();
    this.multiplayer = new Multiplayer(this.network);
    this.scene.add(this.multiplayer.players);

    // Initialize events
    this.eventRenderUpdated = new CustomEvent('renderUpdated', { detail: { delta: 0, alpha: 0 } });
    this.eventEngineUpdated = new CustomEvent('engineUpdated', { detail: { delay: 0, engine: this.engine } });
    this.eventCameraUpdated = new CustomEvent('cameraUpdated', { detail: this.camera });
  }

  async init(canvas, callback = function(){}) {
    // Set version - deliberately separate from manifest.json's own version field (which browser
    // extension stores etc. require and manage independently) so the displayed/saved version never
    // silently follows the wrong file (see versioning.md).
    fetch('./json/version.json')
      .then(response => response.json())
      .then(data => this.version = data.version);

    // Initialize graphics
    this.graphics = new Graphics(canvas);
    this.graphics.setCamera(this.camera);
    this.graphics.setScene(this.scene);
    this.graphics.cssScene = this.multiplayer.players; // Multiplayer name tags are the only text labels in the scene
    this.graphics.setSelectedObjects([this.level]);
    
    // Initialize level editor
    this.levelEditor = new LevelEditor(this.camera, canvas);
    this.scene.add(this.levelEditor.controlsTransform.getHelper());
    this.scene.add(this.levelEditor.controlsPutty.getHelper());

    // Add overlay DOM elements (level UI text + jump indicator), reused across every page/theme
    this.levelUIText = document.createElement('div');
    this.levelUIText.id = 'level-ui-text';
    this.levelUIText.className = 'level-ui-text-overlay';
    document.body.appendChild(this.levelUIText);
    this.jumpIndicator = document.createElement('div');
    this.jumpIndicator.id = 'jump-indicator';
    this.jumpIndicator.className = 'jump-indicator';
    document.body.appendChild(this.jumpIndicator);

    // Add event listeners
    this.canvas = canvas;
    this.canvas.classList.add('hidden'); // Default hidden with CSS
    this.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); }, false);
    this.canvas.addEventListener('pointerdown', function(e){ this.mouse.mouseDown(e); }.bind(this), false);
    this.canvas.addEventListener('pointermove', function(e){ this.mouse.mouseMove(e); }.bind(this), false);
    this.canvas.addEventListener('pointerup', function(e){ this.mouse.mouseUp(e); }.bind(this), false);
    this.canvas.addEventListener('wheel', function(e){ this.mouse.wheel(e); }.bind(this), false);
    this.window.addEventListener('resize', function(e) { this.resizeWindow(e); }.bind(this));
    this.window.addEventListener('message', e => this.onMessage(e));
    Events.on(this.engine, 'collisionStart', function(e) { this.collision.checkPlayerCollision(e); }.bind(this));
    Events.on(this.engine, 'collisionEnd', function(e) { this.collision.checkCollisionEnd(e); }.bind(this));


    // Load assets, then load game
    this.assets.load(function() {
      // Level lists read thumbnails synchronously, so wait for them to load
      this.storage.thumbnailsReady.then(function() {
        this.load(callback);
        this.updateSettings(null); // Update settings
      }.bind(this));
    }.bind(this));
  }

  load(callback = function(){}) {
    var storageSettings = this.storage.getSettings();

    // Start music
    this.assets.audio.play(storageSettings.audio.music, { queue: true });

    // Initialize background with model
    this.background.setTarget(this.player);
    this.background.init();

    // Start game loop
    this.resizeWindow(null);

    // Add physics & render loops
    this.interval.add(loop => this.updateEngine(loop), 1000 / 60);
    this.interval.add(loop => { this.updateAntiLag(loop); this.updateRender(loop); }); // Only real frames catch up
    this.interval.add(loop => this.updateNetwork(loop), 1000 / 8);
    this.multiplayer.setTick(8);
    this.interval.start();

    // Run game callback
    callback();
  }

  updateEngine({ delay }) {
    // Update engine to loop engine rate
    if (this.play == true) {
      // Deterministic mode: jump buffer counts physics ticks instead of render-frame wall-clock time
      var isDeterministic = this.storage.readSettings().invalidatingSettings.deterministic === true;
      if (isDeterministic) this.player.updateJumpBuffer(delay);

      // Deterministic mode: the level timer counts physics ticks (before the step, so a finishing tick is included)
      if (isDeterministic) this.timer.tick(delay);

      // Update player object
      this.player.updateControls();
      this.player.updateForce();
      this.player.renderSpeed(this);
      this.player.updateRope();

      // Update world engine
      var tickStart = performance.now();
      Engine.update(this.engine, delay);
      this.tickTime = performance.now() - tickStart;
      this.player.jumpPending = false; // Any pending jump force was applied (and cleared) by this tick

      // Deterministic mode: fall-out kills and death respawn run on physics ticks, not render frames/setTimeout
      if (isDeterministic) {
        this.updateOutOfBounds();
        this.player.updateKillTimer();
      }

      // Dispatch engine event
      this.eventEngineUpdated.detail.delay = delay;
      window.dispatchEvent(this.eventEngineUpdated);
    }
  }

  // Anti-lag: the engine loop steps at most once per frame, so run the ticks it dropped before rendering
  updateAntiLag({ delta, timestamp }) {
    var engineLoop = this.interval.get(0);
    var isAntiLag = this.storage.readSettings().general.antiLag === true;
    if (isAntiLag == false || this.play != true || engineLoop.paused === true) { this.lagTime = 0; return; }

    // Owed time is capped at 5 ticks so long stalls (ex: a hidden tab) don't snowball
    var dropped = Math.max(0, delta - engineLoop.delay * this.interval.speed);
    this.lagTime = Math.min(this.lagTime + dropped, engineLoop.delay * 5);

    // Catch up only while another tick fits in the frame's physics budget, so heavy levels keep their frame rate
    while (this.lagTime >= engineLoop.delay && performance.now() - timestamp + this.tickTime <= this.lagBudget) {
      this.lagTime -= engineLoop.delay;
      this.updateEngine(engineLoop);
    }
  }

  updateRender({ delta, alpha }) {
    // Loop through scene for all children
    if (this.play == true) {
      // Update from new position
      this.updateChildren(delta, alpha);
      this.updateCamera();
      this.timer.render();
      
      // Update game objects
      this.player.updateMatrixWorld();
      this.player.renderRope(alpha);
      this.background.update(delta, alpha, app.backgroundMotion == false);
      this.background.updateMatrixWorld();
      this.animation.update(delta, alpha);
      this.graphics.update(delta);

      // Dispatch render event
      this.eventRenderUpdated.detail.delta = delta;
      this.eventRenderUpdated.detail.alpha = alpha;
      window.dispatchEvent(this.eventRenderUpdated);
    }

    // Update network animations (tweens)
    this.multiplayer.render(delta, alpha);
    this.multiplayer.players.updateMatrixWorld();

    // Level UI text is only meant to be seen during actual gameplay, not while editing
    if (this.levelUIText) this.levelUIText.style.display = this.play ? '' : 'none';

    this.updateJumpIndicator();

    // Re-check the visual grid's visibility every frame - LevelEditor.updateRender() (which normally
    // drives this) is only called from editor-only interactions, so it never re-runs once Play starts.
    if (this.levelEditor) this.levelEditor.renderGrid();
  }

  updateChildren(delta, alpha) {
    // Loop through the level's moving objects (static ones never move, so they're not even visited)
    var children = this.level.getDynamicObjects();
    var index = children.length - 1;
    while (index >= 0) {
      var child = children[index];

      // Update child if it has a collision box (skip static objects as they don't move)
      if (child.body != null && child.isFrozen() == false && child.isStatic() == false) {
        child.update(delta, alpha);
        child.updateMatrixWorld();
      }
      index--; // Update iterator
    }
  }

  // Deterministic-mode counterpart of Cube.update's out-of-bounds check, using the previous engine position
  updateOutOfBounds() {
    var children = this.level.getDynamicObjects();
    var index = children.length - 1;
    while (index >= 0) {
      var child = children[index];
      if (child.body != null && child.isFrozen() == false && child.isStatic() == false) child.checkOutOfBounds(-child.body.positionPrev.y);
      index--;
    }
  }

  updateNetwork({ delta, alpha }) {
    // Update network
    this.multiplayer.update(delta, alpha);
  }

  resizeWindow(e) {
    this.screenWidth = this.window.innerWidth;
    this.screenHeight = this.window.innerHeight;
    this.camera.aspect = this.screenWidth / this.screenHeight;
    this.camera.updateProjectionMatrix();
    this.graphics.setSize(this.screenWidth, this.screenHeight);
    this.updateJumpIndicator();
  }

  resetScene(render = true) {
    app.camera.position.z = app.camera.position.zDefault;
    this.player.removeRope();
    this.level.removeParticles();
    this.level.resetLevel();
    if (render == true) this.updateRender({ delta: 0, alpha: 0 }, 0); // Callers that render again afterwards skip this one
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
  }

  updateJumpIndicator() {
    var settings = this.storage.readSettings();
    // Only shown during live gameplay (open menus also hide it via CSS, see #jump-indicator in Main.scss)
    if (settings.invalidatingSettings.jumpIndicator !== true || this.play !== true) {
      this.jumpIndicator.classList.remove('active');
      return;
    }

    // Offset to the right of screen center by a fraction of screen height (~40px at 1080p), vertically aligned with the player
    this.jumpIndicator.style.left = (this.screenWidth / 2 + this.screenHeight * 0.037) + 'px';
    this.jumpIndicator.style.top = (this.screenHeight / 2) + 'px';

    if (this.player.hasJump() && this.player.visible === true) this.jumpIndicator.classList.add('active');
    else this.jumpIndicator.classList.remove('active');
  }

  updateCamera() {
    this.camera.position.x = this.player.position.x;
    this.camera.position.y = this.player.position.y + this.camera.tilt;
    this.camera.updateMatrixWorld();

    // Dispatch render event
    window.dispatchEvent(this.eventCameraUpdated);
  }

  updateSettings(settings) {
    // Compare new settings with local storage
    var storageSettings = this.storage.getSettings();
    if (settings == null) settings = storageSettings;

    // Add missing keys from storage
    this.storage.fillMissingSettings(settings, storageSettings);
    this.validateThemeSettings(settings.theme);

    // Each preset dropdown re-applies its own group's defaults, the main preset also picks an editor preset (applied below)
    var isUISwitchInLevel = false;
    if (settings.theme.preset != storageSettings.theme.preset) {
      Object.assign(settings.theme, this.getMainThemeDefaults(settings.theme.preset));
      isUISwitchInLevel = this.state == 'campaign' || this.state == 'level-editor';
    }
    if (settings.theme.editorPreset != storageSettings.theme.editorPreset) {
      Object.assign(settings.theme, this.getEditorThemeDefaults(settings.theme.editorPreset));
    }
    if (settings.theme.popupPreset != storageSettings.theme.popupPreset) {
      Object.assign(settings.theme, this.getPopupThemeDefaults(settings.theme.popupPreset));
    }

    // Store locally, outdated settings are rejected and not applied
    if (this.storage.setSettings(settings) === false) return false;

    // Update application from settings
    this.assets.audio.setMasterVolume(settings.audio.volume, 'master');
    this.assets.audio.setMasterVolume(settings.audio.volumeEffects, 'effects');
    this.assets.audio.setMasterVolume(settings.audio.volumeMusic, 'music');
    this.updateQuality(settings.graphics.quality);
    this.mouse.setSnap(settings.levelEditor.snap);
    this.player.setSkin(settings.general.skin);
    this.player.setInputBuffer(settings.invalidatingSettings.inputBuffer);
    this.updateCameraMotion(settings.graphics.cameraRotation, settings.graphics.backgroundMotion);
    this.updateCameraZoom(settings.invalidatingSettings.zoom);
    this.updateMath(settings);
    this.applyThemeStyles(settings);
    window.dispatchEvent(new CustomEvent('updateStatsVisibility'));
    window.dispatchEvent(new CustomEvent('updateScale', { detail: settings.graphics.scale }));

    // Checkpoint glitch: switching UI mid-level hard exits to the main menu but keeps the checkpoint (like vanilla)
    if (isUISwitchInLevel) {
      if (this.state == 'level-editor') window.dispatchEvent(new CustomEvent('hardExitLevelEditor')); // The editor page stops its playtest, then asks to save
      window.dispatchEvent(new CustomEvent('closeSettings')); // Closing resumes a campaign level, so exit afterwards
      if (this.state == 'campaign') this.exitCampaign(true, 'home');
    }
    return true;
  }

  // Main Theme preset (group 2) from themePresets.json, Funk re-rolls its colours each time it's selected
  getMainThemeDefaults(preset) {
    var defaults = getThemePreset('main', preset);
    if (preset == 'funk') {
      this.randomizeThemeColors(defaults, ['bgColor1', 'bgColor2', 'bgColor3', 'accentColor', 'optionAccentColor', 'optionAccentColor2',
        'statsIconColor', 'skinsBgColor', 'editorButtonBgColor', 'editorButtonCraneColor', 'editorButtonBlocksColor', 'multiplayerBgColor',
        'playButtonBgColor', 'playButtonPlatformColor', 'menuBgColor1', 'menuBgColor2', 'menuBgColor3', 'menuBgColor4']);
    }
    return defaults;
  }

  // Random fully-saturated, max-lightness hex colour (HSL S=100/L=50) - a random hue every call, for the Funk preset
  getRandomVividColor(lightness = 50) {
    return this.util.hslToHex(this.util.randomNumber(0, 360), 100, lightness);
  }

  // Funk: gives each listed theme colour its own random vivid hue
  randomizeThemeColors(theme, keys, lightness = 50) {
    keys.forEach(key => theme[key] = this.getRandomVividColor(lightness));
    return theme;
  }

  // Level Editor Theme preset (group 3), Funk keeps its textbox background at 1/4 lightness so it still reads as a background
  getEditorThemeDefaults(preset) {
    var defaults = getThemePreset('editor', preset);
    if (preset == 'funk') {
      this.randomizeThemeColors(defaults, ['editorToolbarColor1', 'editorToolbarColor2', 'editorIconDeselectedColor', 'editorIconSelectedColor',
        'editorIconHighlightColor', 'editorIconShadowColor', 'editorTextboxFontColor']);
      this.randomizeThemeColors(defaults, ['editorTextboxBgColor'], 25);
    }
    return defaults;
  }

  // Translucent Popup Theme preset (group 4)
  getPopupThemeDefaults(preset) {
    var defaults = getThemePreset('popup', preset);
    if (preset == 'funk') this.randomizeThemeColors(defaults, ['popupBgColor', 'popupTextColor']);
    return defaults;
  }

  // Numeric theme settings that are the wrong type or outside their fixed range (ex: saved in older units) fall back to the preset default
  validateThemeSettings(theme) {
    var defaults = Object.assign({}, this.getMainThemeDefaults(theme.preset), this.getEditorThemeDefaults(theme.editorPreset), this.getPopupThemeDefaults(theme.popupPreset));
    for (var key in themeSettings) {
      var range = themeSettings[key];
      var value = theme[key];
      if (typeof value !== 'number' || isNaN(value) || value < range.min || value > range.max) theme[key] = defaults[key];
    }
  }

  // Numeric theme setting as a CSS value, with its unit from themeSettings.json
  getThemeValue(theme, key) {
    return theme[key] + themeSettings[key].unit;
  }

  // Push current theme settings to CSS custom properties so Main.scss can consume them live
  applyThemeStyles(settings) {
    var root = document.documentElement.style;
    var highlightColor = (settings.theme.editorIconHighlightColorIsExplicit && settings.theme.editorIconHighlightColor)
      ? settings.theme.editorIconHighlightColor
      : this.util.hexMidpoint('#000000', settings.theme.accentColor);

    // Style switches from theme settings, read by Main.scss
    document.documentElement.setAttribute('data-theme-flat-style', settings.theme.flatStyle == true);
    document.documentElement.setAttribute('data-theme-shadows', settings.theme.shadows != false);

    root.setProperty('--theme-bg-color-1', settings.theme.bgColor1);
    root.setProperty('--theme-bg-color-2', settings.theme.bgColor2);
    root.setProperty('--theme-bg-color-3', settings.theme.bgColor3);
    // Scales each element's own vanilla rounding/icon size (see Main.scss), 1 = vanilla exactly
    root.setProperty('--theme-corner-scale', this.getThemeValue(settings.theme, 'cornerRadius'));
    root.setProperty('--theme-icon-scale', this.getThemeValue(settings.theme, 'iconSize'));
    root.setProperty('--theme-accent-color', settings.theme.accentColor);
    root.setProperty('--theme-option-accent-color', settings.theme.optionAccentColor);
    root.setProperty('--theme-option-accent-color-2', settings.theme.optionAccentColor2);
    root.setProperty('--theme-option-accent-color-2-alt', this.util.shadeHex(settings.theme.optionAccentColor2, 3, 0, 0));
    root.setProperty('--theme-stats-icon-color', settings.theme.statsIconColor);
    root.setProperty('--theme-button-color', settings.theme.buttonColor);
    root.setProperty('--theme-control-color', settings.theme.controlColor);
    root.setProperty('--theme-control-text-color', settings.theme.controlTextColor);
    root.setProperty('--theme-uncompleted-level-color', settings.theme.uncompletedLevelColor);

    // Home-button svg recolouring: each shade is the art's exact HSL offset from its element's one base colour
    // Menu buttons can drop the art for a plain colour block instead
    document.documentElement.setAttribute('data-theme-menu-button-art', settings.theme.menuButtonArt != false);
    root.setProperty('--theme-menu-button-bg', this.util.hexToRgba(settings.theme.menuButtonColor, settings.theme.menuButtonOpacity));
    root.setProperty('--theme-skins-bg-color', settings.theme.skinsBgColor);
    root.setProperty('--theme-skins-bg-color-dark', this.util.shadeHex(settings.theme.skinsBgColor, -11.73, 0, 0));
    root.setProperty('--theme-skins-bg-color-mid', this.util.shadeHex(settings.theme.skinsBgColor, -2.35, 0, 0));
    root.setProperty('--theme-editor-button-bg-color', settings.theme.editorButtonBgColor);
    root.setProperty('--theme-editor-button-crane-color', settings.theme.editorButtonCraneColor);
    root.setProperty('--theme-editor-button-crane-color-light', this.util.shadeHex(settings.theme.editorButtonCraneColor, -0.1, 0, 11.6));
    root.setProperty('--theme-editor-button-blocks-color', settings.theme.editorButtonBlocksColor);
    root.setProperty('--theme-editor-button-blocks-color-light', this.util.shadeHex(settings.theme.editorButtonBlocksColor, -22.3, 0, 14.1));
    root.setProperty('--theme-editor-button-blocks-color-lighter', this.util.shadeHex(settings.theme.editorButtonBlocksColor, -22, 0, 27.5));
    var multiplayerBase = settings.theme.multiplayerBgColor;
    var multiplayerShade1 = this.util.shadeHex(multiplayerBase, 0.3, 5.4, -11.8);
    var multiplayerShade2 = this.util.shadeHex(multiplayerBase, 2, 28.2, -21.6);
    var multiplayerShade3 = this.util.shadeHex(multiplayerBase, 8.8, 28.2, -26.5);
    root.setProperty('--theme-multiplayer-bg-color', multiplayerBase);
    root.setProperty('--theme-multiplayer-bg-color-shade-1', multiplayerShade1);
    root.setProperty('--theme-multiplayer-bg-color-shade-2', multiplayerShade2);
    root.setProperty('--theme-multiplayer-bg-color-shade-3', multiplayerShade3);
    // Lightest layer at the back, reversing puts the darkest there instead
    var multiplayerLayers = [multiplayerBase, multiplayerShade1, multiplayerShade2, multiplayerShade3];
    if (settings.theme.reverseMultiplayerShades == true) multiplayerLayers.reverse();
    root.setProperty('--theme-multiplayer-layer-1', multiplayerLayers[0]);
    root.setProperty('--theme-multiplayer-layer-2', multiplayerLayers[1]);
    root.setProperty('--theme-multiplayer-layer-3', multiplayerLayers[2]);
    root.setProperty('--theme-multiplayer-layer-4', multiplayerLayers[3]);
    root.setProperty('--theme-play-button-bg-color', settings.theme.playButtonBgColor);
    root.setProperty('--theme-play-button-bg-color-dark', this.util.shadeHex(settings.theme.playButtonBgColor, 0.2, -17.2, -10.4));
    root.setProperty('--theme-play-button-platform-color', settings.theme.playButtonPlatformColor);
    root.setProperty('--theme-play-button-platform-color-dark', this.util.shadeHex(settings.theme.playButtonPlatformColor, 0.1, 0, -11.6));
    root.setProperty('--theme-play-button-stripe-color', settings.theme.playButtonStripeColor);
    root.setProperty('--theme-play-button-stripe-opacity', this.getThemeValue(settings.theme, 'playButtonStripeOpacity'));
    root.setProperty('--theme-play-button-icon-color', settings.theme.playButtonIconColor);
    root.setProperty('--theme-play-button-icon-shade-color', settings.theme.playButtonIconShadeColor);
    root.setProperty('--theme-menu-bg-color-1', settings.theme.menuBgColor1);
    root.setProperty('--theme-menu-bg-color-2', settings.theme.menuBgColor2);
    root.setProperty('--theme-menu-bg-color-3', settings.theme.menuBgColor3);
    root.setProperty('--theme-menu-bg-color-4', settings.theme.menuBgColor4);

    root.setProperty('--theme-editor-toolbar-color-1', settings.theme.editorToolbarColor1);
    root.setProperty('--theme-editor-toolbar-color-2', settings.theme.editorToolbarColor2);
    root.setProperty('--theme-editor-toolbar-bg', this.util.hexToRgba(settings.theme.editorToolbarColor1, settings.theme.editorToolbarOpacity));
    root.setProperty('--theme-editor-toolbar-bg-2', this.util.hexToRgba(settings.theme.editorToolbarColor2, settings.theme.editorToolbarOpacity));
    root.setProperty('--theme-editor-icon-size', this.getThemeValue(settings.theme, 'editorIconSize'));
    root.setProperty('--theme-editor-icon-deselected-color', settings.theme.editorIconDeselectedColor);
    root.setProperty('--theme-editor-icon-selected-color', settings.theme.editorIconSelectedColor);
    root.setProperty('--theme-editor-icon-highlight-color', this.util.hexToRgba(highlightColor, settings.theme.editorIconHighlightOpacity));
    var iconShadowOpacity = settings.theme.shadows != false ? settings.theme.editorIconShadowOpacity : 0; // The Shadows switch turns these off too
    root.setProperty('--theme-editor-icon-shadow-color', this.util.hexToRgba(settings.theme.editorIconShadowColor, iconShadowOpacity));
    root.setProperty('--theme-editor-textbox-bg-color', settings.theme.editorTextboxBgColor);
    root.setProperty('--theme-editor-textbox-font-color', settings.theme.editorTextboxFontColor);

    // Translucent Popup group: every nested translucent "fancy popup" layer reuses this one bg colour, just stacked
    root.setProperty('--theme-popup-bg', this.util.hexToRgba(settings.theme.popupBgColor, settings.theme.popupOpacity));
    root.setProperty('--theme-popup-text-color', settings.theme.popupTextColor);
  }

  updateGravity(angle) { // between -1, and 1 directionally
    var vector = this.util.getVectorFromAngle(angle);
    var gravity = app.engine.world.gravity;
    var scale = 1;
    gravity.x = vector.x;
    gravity.y = vector.y;

    // Animate camera
    if (angle != null && app.cameraRotation == true) {
      angle *= -1;
      scale = (Math.abs((angle + Math.PI) % (Math.PI)) / (Math.PI / 2)) + 1; // 0deg = 1, 90deg = 2

      // Turn the short way (at most 180deg) from the current rotation
      var turn = Math.PI * 2;
      var from = app.camera.rotation.z % turn;
      var delta = (((angle - from) % turn) + turn * 1.5) % turn - Math.PI;
      if (app.cameraRotationTween) app.cameraRotationTween.stop();
      app.camera.rotation.z = from;
      app.cameraRotationTween = app.animation.tween({ object: app.camera.rotation, to: { z: from + delta }, duration: 250 }).start();
      app.background.animateScale(scale);
    }
    else {
      app.camera.rotation.z = 0;
      app.background.animateScale(1);
    }
  }

  // Stop any camera rotation animation and instantly unrotate the camera
  resetCameraRotation() {
    if (this.cameraRotationTween) this.cameraRotationTween.stop();
    this.cameraRotationTween = null;
    this.camera.rotation.z = 0;
  }

  updateQuality(quality) {
    if (quality <= 0) quality = 1;
    this.graphics.setPixelRatio(this.window.devicePixelRatio / (10 / quality));
    //a.graphics.smaaPass.enabled = (quality == 10); // Enable if max graphics
  }

  updateCameraMotion(cameraRotation, backgroundMotion) {
    app.cameraRotation = cameraRotation;
    app.backgroundMotion = backgroundMotion;
  }

  saveOrbitState() {
    // Keep the game camera perpendicular while preserving z tilt from gravity.
    if (this.state == 'level-editor') {
      // Save the camera straight in front of the player so resetting the orbit never skews its rotation
      this.camera.position.set(this.player.position.x, this.player.position.y + this.camera.tilt, this.camera.position.zDefault);
      this.camera.rotation.x = 0;
      this.camera.rotation.y = 0;
      this.camera.updateMatrixWorld();
      this.levelEditor.controlsOrbit.target.copy(this.player.position);
      this.levelEditor.controlsOrbit.saveState();
    }
  }

  // Culling applies while playing and while editing (edits made since the last save stay drawn through the editor's active objects)
  isRenderGridActive() {
    return this.play == true || (this.levelEditor != null && this.levelEditor.isEditorPaused());
  }

  getActiveEditorObjects() {
    return (this.state == 'level-editor' && this.levelEditor != null) ? this.levelEditor.getActiveObjects() : [];
  }

  // Drops what the culling grids and caches still hold of a cleared level, so its blocks can be freed
  releaseLevelReferences() {
    this.renderGrid.clear();
    this.physicsGrid.clear();
    this.levelOrder = null;
    this.levelOrderVersion = null;
  }

  // Level objects the camera may see, in level order (so picking ties resolve as before), or null when culling isn't active
  getVisibleLevelObjects() {
    if (!this.isRenderGridActive() || this.renderGrid.enabled == false) return null;
    if (this.levelOrderVersion !== this.level.staticVersion) {
      this.levelOrder = new Map(this.level.children.map((child, index) => [child, index]));
      this.levelOrderVersion = this.level.staticVersion;
    }
    var order = this.levelOrder;
    var objects = this.renderGrid.getVisibleObjects(this.camera, this.getActiveEditorObjects());
    return objects.sort((a, b) => (order.has(a) ? order.get(a) : Infinity) - (order.has(b) ? order.get(b) : Infinity));
  }

  // Vanilla's 5000 draw distance (so far background blocks stay hidden), pushed out only when the editor camera is zoomed out past it
  updateCameraFar(camera) {
    var distance = camera.position.z;
    if (this.play != true && this.levelEditor) distance = Math.max(distance, camera.position.distanceTo(this.levelEditor.controlsOrbit.target));
    var far = Math.max(5000, distance + 1000);
    if (camera.far !== far) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }

  updateCameraZoom(zoom) {
    // Skip camera update if level has a locked zoom
    if (this.level.zoom !== undefined) return;

    // While editing, only move the camera if it's in its reset state, otherwise just update where it resets to
    var isEditing = this.state == 'level-editor' && this.play == false;
    if (isEditing && this.levelEditor.isCameraReset() == false) {
      this.camera.position.zDefault = zoom;
      this.levelEditor.controlsOrbit.position0.z = zoom;
      return;
    }
    this.camera.position.zDefault = zoom;
    this.camera.position.z = zoom;
    this.saveOrbitState();
    this.graphics.render();
  }

  updateMath(settings) {
    // Deterministic mode runs on the selected engine's exact Math results, otherwise the browser's own
    var isDeterministic = settings.invalidatingSettings.deterministic === true;
    setDeterministicMath(isDeterministic ? settings.general.deterministicMath : null);
  }

  exitCampaign(keepCheckpoint = false, page = 'level-picker') {
    app.play = false;
    app.resetScene();
    app.level.clearLevel();
    app.updateCameraZoom(app.storage.readSettings().invalidatingSettings.zoom); // Don't carry the level's zoom over
    app.player.cancelRestart(); // A pending death respawn must not fire after leaving
    if (keepCheckpoint == false) app.player.removeCheckpoint();
    app.player.setPosition({ x: 0, y: 0, z: 0 });
    window.dispatchEvent(new CustomEvent('setPage', { detail: page }));
    window.dispatchEvent(new CustomEvent('closePopup'));
  }

  startLevel() {
    app.play = true;
    app.timer.start();
    app.player.resumeRestart(); // Continue a death respawn held by the editor's pause (fresh starts already cancelled it)

    // Adjust camera zoom and save a straight-on camera as the orbit reset state
    app.camera.position.zDefault = app.level.zoom || app.storage.readSettings().invalidatingSettings.zoom;
    app.camera.position.z = app.camera.position.zDefault;
    app.saveOrbitState();

    // Play jump sound
    this.assets.audio.play('jump');
  }

  onMessage = e => {
    const { type, ...args } = e.data;
    if (app[type]) {
      // Run app function with arguments
      const options = Array.isArray(args.detail) ? [...args.detail] : [args.detail];
      app[type](...options);
    }
    else {
      // Dispatch custom event
      window.dispatchEvent(new CustomEvent(type, args));
    }
  }

  async playLevel(options) {
    // Resolve missing JSON data
    if (options.json == null) {
      // Resolve missing path by title
      if (options.path == null) {
        options.path = './json/levels/' + options.title + '.json';
      }
  
      // Fetch level json data
      try {
        // Encode the file name
        const pathArray = options.path.split('/');
        const fileName = pathArray.pop();
        const encodedPath = pathArray.join('/') + '/' + encodeURIComponent(fileName);

        // Fetch and parse JSON
        const response = await fetch(encodedPath);
        options.json = await response.json();
      }
      catch (error) {
        console.error(error);
      }
    }

    // Load level if json exists
    if (options.json) {
      app.player.cancelRestart(); // clear stale kill()-timer/physics-bias carryover from a prior level, same as retryLevel() does
      if (app.storage.readSettings().invalidatingSettings.deterministic === true) app.player.resetDeterministicPhysics();

      convertLevel(options.json);
      var storageSettings = this.storage.getSettings();
      var title = options.json.name;
      var source = options.source; // Exact level entry played from a menu, title lookups can't tell duplicates apart
      var description = this.level.getDescriptionByTitle(title, source)
      var author = options.json.properties.author || this.level.getAuthorByTitle(title, source); // Level's own author overrides the pack's
      var theme = this.level.getTheme(options.json.properties.theme);
      var zoom = options.json.properties.zoom || storageSettings.invalidatingSettings.zoom;
      if (theme == null) theme = this.level.getPackTheme(title, source);
      if (theme == null) theme = app.level.getTheme('classic');
      // Old Backgrounds: force the classic background and default block colour on every level
      var oldBackgrounds = storageSettings.theme.oldBackgrounds == true;
      var levelJSON = options.json;
      if (oldBackgrounds) {
        var levelDefaults = [theme.color, options.json.properties.defaultBlockColor].filter(color => color).map(color => color.toLowerCase()); // The level's own default colours
        theme = app.level.getTheme('classic');
        // Blocks explicitly set to a level default colour get classic's too, on a copy so the source data stays untouched
        levelJSON = Object.assign({}, options.json, { children: options.json.children.map(child => {
          var isDefault = child.class != 'player' && typeof child.color == 'string' && levelDefaults.includes(child.color.toLowerCase());
          return isDefault ? Object.assign({}, child, { color: theme.color }) : child;
        })});
      }
      app.level.entityFactory.color = theme.color;
      app.camera.position.z = zoom;
      app.camera.position.zDefault = zoom;

      // Set optional fog
      if (theme.fog) {
        app.graphics.fog.color.set(theme.fog.color);
        app.graphics.fog.near = theme.fog.near || 0.01;
        app.graphics.fog.far = theme.fog.far || 240;
      }
      else {
        app.graphics.fog.color.set('#ffffff');
        app.graphics.fog.near = app.graphics.fog.far = 9999;
      }

      app.background.setTheme(theme.model);
      app.updateGravity();
      app.play = true;
      app.timer.reset();
      app.level.clearLevel();
      app.level.importFromJSON(levelJSON);
      // Apply level's custom default color override, if set (loaded above by importFromJSON), unless Old Backgrounds keeps classic's
      if (app.level.defaultBlockColor && !oldBackgrounds) app.level.entityFactory.color = app.level.defaultBlockColor;
      app.level.publishedFileId = options.publishedFileId; // Steam level ID
      app.saveOrbitState();
      app.background.visible = true;
      app.startLevel();
      app.resetScene();

      // Dispatch level start event
      window.dispatchEvent(new CustomEvent('levelStart', {
        detail: {
          title: title,
          description: description
        }
      }));
      
      // Send event to show credits
      setTimeout(function() {
        if (author) {
          window.dispatchEvent(new CustomEvent('setCredit', { detail: { text: 'Level by ' + author }}));
        }
      }, 500);
    }

    // Return level existence state
    return options.json;
  }

  pauseLevel() {
    app.timer.pause();
    app.play = false;
    app.player.pauseRestart(); // Menus hold the death respawn too
  }

  resumeLevel() {
    app.timer.resume();
    app.play = true;
    app.player.resumeRestart();
    window.dispatchEvent(new CustomEvent('closePopup'));
  }

  showCanvas() {
    app.canvas.classList.remove('hidden');
  }

  hideCanvas() {
    app.canvas.classList.add('hidden');
  }

  isInputBufferValid() {
    var settings = app.storage.readSettings();
    var inputBufferIsDisabled = settings.invalidatingSettings.inputBuffer === 0;
    return inputBufferIsDisabled;
  }

  isDebugValid() {
    var settings = app.storage.readSettings();
    var debugIsDisabled = settings.invalidatingSettings.hitboxes === false;
    return debugIsDisabled;
  }

  isZoomValid() {
    var zoom = app.camera.position.z;
    // Editor camera zooms freely while editing, so check the zoom playtesting will use
    if (app.state == 'level-editor' && app.play == false) zoom = app.level.zoom || app.camera.position.zDefault;
    var zoomIsValid = app.level.zoom ? (zoom == app.level.zoom) : (zoom == 180);
    return zoomIsValid;
  }

  isDeterministicValid() {
    var settings = app.storage.readSettings();
    return settings.invalidatingSettings.deterministic !== true;
  }

  isJumpIndicatorValid() {
    var settings = app.storage.readSettings();
    return settings.invalidatingSettings.jumpIndicator !== true;
  }

  isVerified() {
    return this.isInputBufferValid() && this.isDebugValid() && this.isZoomValid() && this.isDeterministicValid() && this.isJumpIndicatorValid();
  }
}

export { App };