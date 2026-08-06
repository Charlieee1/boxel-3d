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
import { LevelHistory } from './LevelHistory.js';
import { Player } from './entities/Player.js';
import { Mouse } from './Mouse.js';
import { LevelEditor } from './LevelEditor.js';
import { Multiplayer } from './Multiplayer.js';
import { Network } from './Network.js';

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
    this.then = new Date().getTime();
    this.now = this.then;
    this.delta = 0;
    
    // Initialize level components
    this.assets = new Assets();
    this.level = new Level();
    this.levelHistory = new LevelHistory();
    this.scene.add(this.level);
    
    // Initialize camera
    this.camera = new PerspectiveCamera(this.fov, this.screenWidth / this.screenHeight, 1, 5000);
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
    
    // Load assets, then load game
    this.assets.load(function() {
      this.load(callback);
      this.updateSettings(null); // Update settings
    }.bind(this));
  }

  load(callback = function(){}) {
    var storageSettings = this.storage.getSettings();

    // Start music
    this.assets.audio.play(storageSettings.music, { queue: true });

    // Initialize background with model
    this.background.setTarget(this.player);
    this.background.init();

    // Start game loop
    this.resizeWindow(null);

    // Add physics & render loops
    this.interval.add(loop => this.updateEngine(loop), 1000 / 60);
    this.interval.add(loop => this.updateRender(loop));
    this.interval.add(loop => this.updateNetwork(loop), 1000 / 8);
    this.multiplayer.setTick(8);
    this.interval.start();

    // Run game callback
    callback();
  }

  updateEngine({ delay }) {
    // Update engine to loop engine rate
    if (this.play == true) {
      // Update player object
      this.player.updateControls();
      this.player.updateForce();
      this.player.renderSpeed(this);
      this.player.updateRope();

      // Update world engine
      Engine.update(this.engine, delay);

      // Dispatch engine event
      this.eventEngineUpdated.detail.delay = delay;
      window.dispatchEvent(this.eventEngineUpdated);
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
      this.background.update(delta, alpha, app.motion == false);
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
    // Loop through all children and update all 3D objects
    var index = this.level.children.length - 1;
    while (index >= 0) {
      var child = this.level.children[index];

      // Update child if it has a collision box (skip static objects as they don't move)
      if (child.body != null && child.isFrozen() == false && child.isStatic() == false) {
        child.update(delta, alpha);
        child.updateMatrixWorld();
      }
      index--; // Update iterator
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

  resetScene() {
    app.camera.position.z = app.camera.position.zDefault;
    this.player.removeRope();
    this.level.removeParticles();
    this.level.resetLevel();
    this.updateRender({ delta: 0, alpha: 0 }, 0);
    window.dispatchEvent(new CustomEvent('setSelectedObject'));
  }

  updateJumpIndicator() {
    var settings = this.storage.getSettings();
    // Only relevant while actually in a level: playing (campaign/editor playtest), or paused
    // via campaign's own pause menu (state stays 'campaign' while paused). Editing in the level
    // editor (paused, not playtesting) and anywhere outside a level (menus, level-manager) hide it.
    var inLevel = this.play === true || this.state === 'campaign';
    if (settings.showJumpIndicator !== true || inLevel === false) {
      this.jumpIndicator.classList.remove('active');
      return;
    }

    // Offset to the right of screen center, vertically aligned with the player
    this.jumpIndicator.style.left = (this.screenWidth / 2 + 40) + 'px';
    this.jumpIndicator.style.top = (this.screenHeight / 2) + 'px';

    if (this.player.jumpReady === true && this.player.visible === true) this.jumpIndicator.classList.add('active');
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
    Object.keys(storageSettings).forEach(function (key) {
      if (settings[key] == null) {
        settings[key] = storageSettings[key];
      }
    });

    // Each of the 3 preset dropdowns independently re-applies only its own group's defaults
    if (settings.themePreset != storageSettings.themePreset) {
      Object.assign(settings, this.getMainThemeDefaults(settings.themePreset));
    }
    if (settings.themeEditorPreset != storageSettings.themeEditorPreset) {
      Object.assign(settings, this.getEditorThemeDefaults(settings.themeEditorPreset));
    }
    if (settings.themePopupPreset != storageSettings.themePopupPreset) {
      Object.assign(settings, this.getPopupThemeDefaults(settings.themePopupPreset));
    }

    // Update application from settings
    this.assets.audio.setMasterVolume(settings.volume, 'master');
    this.assets.audio.setMasterVolume(settings.volumeEffects, 'effects');
    this.assets.audio.setMasterVolume(settings.volumeMusic, 'music');
    this.updateQuality(settings.quality);
    this.mouse.setSnap(settings.snap);
    this.player.setSkin(settings.skin);
    this.player.setInputBuffer(settings.buffer);
    this.storage.setSettings(settings); // Store locally
    this.updateCameraMotion(settings.motion);
    this.updateCameraZoom(settings.zoom);
    this.applyThemeStyles(settings);
    window.dispatchEvent(new CustomEvent('updateStatsVisibility'));
    window.dispatchEvent(new CustomEvent('updateScale', { detail: settings.scale }));
  }

  // Main Theme preset: group 2 (general UI) only - group 3/4 are driven independently by their own dropdowns
  getMainThemeDefaults(preset) {
    // Group 2 defaults match Main.scss's actual pink/orange/yellow UI (verified fallbacks), not invented dark grey
    var bubble = {
      themeBgColor1: '#1e1e1e', themeBgColor2: '#FF8A4C', themeBgColor3: '#FF674C',
      themeCornerRadius: 8, themeIconSize: 1,
      themeAccentColor: '#eb2b6d', themeOptionAccentColor: '#4ca9ff', themeOptionAccentColor2: '#FFC24C',
      // Blue instead of the theme's orange accent - stands out against the flashy Bubble UI
      themeStatsIconColor: '#4CA9FF',
      // Home-button svg recolouring - Bubble defaults match each svg's original art exactly (no visible change)
      themeSkinsBgColor: '#FF8A4C',
      themeEditorButtonBgColor: '#4CA9FF', themeEditorButtonCraneColor: '#FFC24C', themeEditorButtonBlocksColor: '#4C7DFF',
      themeMultiplayerBgColor: '#A8E148',
      themePlayButtonBgColor: '#FF4C8A', themePlayButtonPlatformColor: '#FFD687',
      themeMenuBgColor1: '#7908EB', themeMenuBgColor2: '#9B08EB', themeMenuBgColor3: '#B122FF', themeMenuBgColor4: '#C04CFF'
    };

    // Classic/Legacy match this repo's actual old (Origin.scss) UI colours, not invented ones
    var classic = Object.assign({}, bubble, {
      themeBgColor1: '#252526',
      // Background 2/3 reuse Bubble's blue accent and a darker blue, instead of invented greys
      themeBgColor2: '#4ca9ff', themeBgColor3: '#1d4264', themeCornerRadius: 4,
      // Darker red accent; option-accent is a darker version of Bubble's blue, option-accent-2 is the dark purple
      themeAccentColor: '#8f193a', themeOptionAccentColor: '#316ea6', themeOptionAccentColor2: '#ffffff',
      // Skins/pause-menu background primary colour
      themeSkinsBgColor: '#FF80C0',
      // Level editor button: lighter purple crane, darker background (same hue/saturation, lower lightness - not desaturated)
      themeEditorButtonCraneColor: '#C25CFF', themeEditorButtonBgColor: '#004A8F',
      // Multiplayer button background swaps green for the repo's existing "classic" pack purple
      themeMultiplayerBgColor: '#990799',
      // Play button: platforms lightened (same hue/saturation as the classic block colour, higher lightness);
      // background matches the multiplayer button's own darkest derived shade
      themePlayButtonPlatformColor: '#C408C0', themePlayButtonBgColor: '#1B0017',
      // Menu background (background-purple.svg): ordered lightest (front) to darkest (back). Mid uses an
      // interpolated tone (not one of the 3 given colours) since two of them were too close in lightness to
      // tell apart - Front gets the lightest of the original 3, Far (nearest the darkest Back) gets the darkest
      themeMenuBgColor1: '#270925', themeMenuBgColor2: '#630960', themeMenuBgColor3: '#840E6F', themeMenuBgColor4: '#A31577'
    });
    var legacy = Object.assign({}, classic, { themeCornerRadius: 0 });

    if (preset == 'funk') {
      // Funk: every colour re-rolled at random (full hue wheel, max brightness) each time it's selected
      var rnd = () => this.getRandomVividColor();
      return Object.assign({}, bubble, {
        themeBgColor1: rnd(), themeBgColor2: rnd(), themeBgColor3: rnd(),
        themeCornerRadius: 8,
        themeAccentColor: rnd(), themeOptionAccentColor: rnd(), themeOptionAccentColor2: rnd(),
        themeStatsIconColor: rnd(),
        themeSkinsBgColor: rnd(),
        themeEditorButtonBgColor: rnd(), themeEditorButtonCraneColor: rnd(), themeEditorButtonBlocksColor: rnd(),
        themeMultiplayerBgColor: rnd(),
        themePlayButtonBgColor: rnd(), themePlayButtonPlatformColor: rnd(),
        themeMenuBgColor1: rnd(), themeMenuBgColor2: rnd(), themeMenuBgColor3: rnd(), themeMenuBgColor4: rnd()
      });
    }

    return { bubble: bubble, classic: classic, legacy: legacy }[preset] || bubble;
  }

  // Random fully-saturated, max-lightness hex colour (HSL S=100/L=50) - a random hue every call, for the Funk preset
  getRandomVividColor(lightness = 50) {
    return this.util.hslToHex(this.util.randomNumber(0, 360), 100, lightness);
  }

  // Level Editor Theme preset: group 3 only (dark/light)
  getEditorThemeDefaults(preset) {
    var dark = {
      themeEditorToolbarColor1: '#1a1a1a', themeEditorToolbarColor2: '#0e0e0e', themeEditorToolbarOpacity: 0.5,
      themeEditorIconSize: 1.5, themeEditorIconDeselectedColor: '#999999', themeEditorIconSelectedColor: '#ffffff',
      themeEditorIconHighlightColor: null, themeEditorIconHighlightColorIsExplicit: false, themeEditorIconHighlightOpacity: 1,
      themeEditorIconShadowColor: '#000000', themeEditorIconShadowOpacity: 0.15,
      themeEditorTextboxBgColor: '#262626', themeEditorTextboxFontColor: '#ffffff'
    };

    // Light: inverted backgrounds/text/icon colours, same sizing/opacity/shadow mechanics as dark
    var light = Object.assign({}, dark, {
      themeEditorToolbarColor1: '#e5e5e5', themeEditorToolbarColor2: '#ffffff',
      themeEditorIconDeselectedColor: '#666666', themeEditorIconSelectedColor: '#000000',
      themeEditorIconHighlightColor: null, themeEditorIconHighlightColorIsExplicit: false,
      themeEditorTextboxBgColor: '#ffffff', themeEditorTextboxFontColor: '#000000'
    });

    if (preset == 'funk') {
      // Funk: every colour re-rolled at random (full hue wheel, max brightness) each time it's selected -
      // textbox background is the one exception, kept at 1/4 lightness so it still reads as a background
      var rnd = () => this.getRandomVividColor();
      return Object.assign({}, dark, {
        themeEditorToolbarColor1: rnd(), themeEditorToolbarColor2: rnd(), themeEditorToolbarOpacity: 1,
        themeEditorIconDeselectedColor: rnd(), themeEditorIconSelectedColor: rnd(),
        themeEditorIconHighlightColor: rnd(), themeEditorIconHighlightColorIsExplicit: true, themeEditorIconHighlightOpacity: 1,
        themeEditorIconShadowColor: rnd(), themeEditorIconShadowOpacity: 1,
        themeEditorTextboxBgColor: this.getRandomVividColor(25), themeEditorTextboxFontColor: rnd()
      });
    }

    return { dark: dark, light: light }[preset] || dark;
  }

  // Translucent Popup Theme preset: group 4 only (dark/light)
  getPopupThemeDefaults(preset) {
    var dark = { themePopupOpacity: 0.5, themePopupBgColor: '#000000', themePopupTextColor: '#ffffff' };
    var light = { themePopupOpacity: 0.5, themePopupBgColor: '#ffffff', themePopupTextColor: '#000000' };
    // Funk: no opacity (fully solid), random max-brightness colours re-rolled each time it's selected
    if (preset == 'funk') {
      return { themePopupOpacity: 1, themePopupBgColor: this.getRandomVividColor(), themePopupTextColor: this.getRandomVividColor() };
    }
    return { dark: dark, light: light }[preset] || dark;
  }

  // Push current theme settings to CSS custom properties so Main.scss can consume them live
  applyThemeStyles(settings) {
    var root = document.documentElement.style;
    var highlightColor = (settings.themeEditorIconHighlightColorIsExplicit && settings.themeEditorIconHighlightColor)
      ? settings.themeEditorIconHighlightColor
      : this.util.hexMidpoint('#000000', settings.themeAccentColor);

    // Bubble's art was hand-tuned with larger corner rounding on some elements than the single
    // themeCornerRadius slider gives by default - Main.scss uses this attribute to special-case those
    // elements back to their correct fixed rounding only while the Bubble preset is selected
    document.documentElement.setAttribute('data-theme-preset', settings.themePreset);

    root.setProperty('--theme-bg-color-1', settings.themeBgColor1);
    root.setProperty('--theme-bg-color-2', settings.themeBgColor2);
    root.setProperty('--theme-bg-color-3', settings.themeBgColor3);
    root.setProperty('--theme-corner-radius', settings.themeCornerRadius + 'px');
    root.setProperty('--theme-icon-size', settings.themeIconSize + 'em');
    root.setProperty('--theme-accent-color', settings.themeAccentColor);
    root.setProperty('--theme-option-accent-color', settings.themeOptionAccentColor);
    root.setProperty('--theme-option-accent-color-2', settings.themeOptionAccentColor2);
    root.setProperty('--theme-stats-icon-color', settings.themeStatsIconColor);

    // Home-button svg recolouring - each "shade"/gradient stop is derived from the one base setting per element,
    // via the exact hue/saturation/lightness offset the original hand-authored art used between its own tones
    // (an HSL shift, not an RGB mix toward black/white, which looked muddy/brown on warm hues)
    root.setProperty('--theme-skins-bg-color', settings.themeSkinsBgColor);
    root.setProperty('--theme-skins-bg-color-dark', this.util.shadeHex(settings.themeSkinsBgColor, -11.73, 0, 0));
    root.setProperty('--theme-skins-bg-color-mid', this.util.shadeHex(settings.themeSkinsBgColor, -2.35, 0, 0));
    root.setProperty('--theme-editor-button-bg-color', settings.themeEditorButtonBgColor);
    root.setProperty('--theme-editor-button-crane-color', settings.themeEditorButtonCraneColor);
    root.setProperty('--theme-editor-button-crane-color-light', this.util.shadeHex(settings.themeEditorButtonCraneColor, 0, 0, 11));
    root.setProperty('--theme-editor-button-blocks-color', settings.themeEditorButtonBlocksColor);
    root.setProperty('--theme-editor-button-blocks-color-light', this.util.shadeHex(settings.themeEditorButtonBlocksColor, -23, 0, 14));
    root.setProperty('--theme-editor-button-blocks-color-lighter', this.util.shadeHex(settings.themeEditorButtonBlocksColor, -22, 0, 27));
    var multiplayerBase = settings.themeMultiplayerBgColor;
    var multiplayerShade1 = this.util.shadeHex(multiplayerBase, 1, 5, -12);
    var multiplayerShade2 = this.util.shadeHex(multiplayerBase, 2, 28, -21);
    var multiplayerShade3 = this.util.shadeHex(multiplayerBase, 9, 28, -26);
    root.setProperty('--theme-multiplayer-bg-color', multiplayerBase);
    root.setProperty('--theme-multiplayer-bg-color-shade-1', multiplayerShade1);
    root.setProperty('--theme-multiplayer-bg-color-shade-2', multiplayerShade2);
    root.setProperty('--theme-multiplayer-bg-color-shade-3', multiplayerShade3);
    // Bubble keeps the original front-to-back layer order (lightest at back); Classic/Legacy flip it (darkest at back)
    var multiplayerLayers = (settings.themePreset == 'bubble')
      ? [multiplayerBase, multiplayerShade1, multiplayerShade2, multiplayerShade3]
      : [multiplayerShade3, multiplayerShade2, multiplayerShade1, multiplayerBase];
    root.setProperty('--theme-multiplayer-layer-1', multiplayerLayers[0]);
    root.setProperty('--theme-multiplayer-layer-2', multiplayerLayers[1]);
    root.setProperty('--theme-multiplayer-layer-3', multiplayerLayers[2]);
    root.setProperty('--theme-multiplayer-layer-4', multiplayerLayers[3]);
    root.setProperty('--theme-play-button-bg-color', settings.themePlayButtonBgColor);
    root.setProperty('--theme-play-button-bg-color-dark', this.util.shadeHex(settings.themePlayButtonBgColor, 0, -17, -10));
    root.setProperty('--theme-play-button-platform-color', settings.themePlayButtonPlatformColor);
    root.setProperty('--theme-play-button-platform-color-dark', this.util.shadeHex(settings.themePlayButtonPlatformColor, 0, 0, -11));
    root.setProperty('--theme-menu-bg-color-1', settings.themeMenuBgColor1);
    root.setProperty('--theme-menu-bg-color-2', settings.themeMenuBgColor2);
    root.setProperty('--theme-menu-bg-color-3', settings.themeMenuBgColor3);
    root.setProperty('--theme-menu-bg-color-4', settings.themeMenuBgColor4);

    root.setProperty('--theme-editor-toolbar-color-1', settings.themeEditorToolbarColor1);
    root.setProperty('--theme-editor-toolbar-color-2', settings.themeEditorToolbarColor2);
    root.setProperty('--theme-editor-toolbar-bg', this.util.hexToRgba(settings.themeEditorToolbarColor1, settings.themeEditorToolbarOpacity));
    root.setProperty('--theme-editor-toolbar-bg-2', this.util.hexToRgba(settings.themeEditorToolbarColor2, settings.themeEditorToolbarOpacity));
    root.setProperty('--theme-editor-icon-size', settings.themeEditorIconSize + 'em');
    root.setProperty('--theme-editor-icon-deselected-color', settings.themeEditorIconDeselectedColor);
    root.setProperty('--theme-editor-icon-selected-color', settings.themeEditorIconSelectedColor);
    root.setProperty('--theme-editor-icon-highlight-color', this.util.hexToRgba(highlightColor, settings.themeEditorIconHighlightOpacity));
    root.setProperty('--theme-editor-icon-shadow-color', this.util.hexToRgba(settings.themeEditorIconShadowColor, settings.themeEditorIconShadowOpacity));
    root.setProperty('--theme-editor-textbox-bg-color', settings.themeEditorTextboxBgColor);
    root.setProperty('--theme-editor-textbox-font-color', settings.themeEditorTextboxFontColor);

    // Translucent Popup group: every nested translucent "fancy popup" layer reuses this one bg colour, just stacked
    root.setProperty('--theme-popup-bg', this.util.hexToRgba(settings.themePopupBgColor, settings.themePopupOpacity));
    root.setProperty('--theme-popup-text-color', settings.themePopupTextColor);
  }

  updateGravity(angle) { // between -1, and 1 directionally
    var vector = this.util.getVectorFromAngle(angle);
    var gravity = app.engine.world.gravity;
    var scale = 1;
    gravity.x = vector.x;
    gravity.y = vector.y;

    // Animate camera
    if (angle != null && app.motion == true) {
      angle *= -1;
      if (angle < 0) app.camera.rotation.z = (app.camera.rotation.z - (Math.PI * 2)) % (Math.PI * 2);
      scale = (Math.abs((angle + Math.PI) % (Math.PI)) / (Math.PI / 2)) + 1; // 0deg = 1, 90deg = 2
      app.animation.tween({ object: app.camera.rotation, to: { z: angle }, duration: 250 }).start();
      app.background.animateScale(scale);
    }
    else {
      app.camera.rotation.z = 0;
      app.background.animateScale(1);
    }
  }

  updateQuality(quality) {
    if (quality <= 0) quality = 1;
    this.graphics.setPixelRatio(this.window.devicePixelRatio / (10 / quality));
    //a.graphics.smaaPass.enabled = (quality == 10); // Enable if max graphics
  }

  updateCameraMotion(motion) {
    app.motion = motion;
  }

  saveOrbitState() {
    // Keep the game camera perpendicular while preserving z tilt from gravity.
    if (this.state == 'level-editor') {
      this.camera.rotation.x = 0;
      this.camera.rotation.y = 0;
      this.camera.updateMatrixWorld();
      this.levelEditor.controlsOrbit.target.copy(this.player.position);
      this.levelEditor.controlsOrbit.saveState();
    }
  }

  updateCameraZoom(zoom) {
    // Skip camera update if level has a locked zoom
    if (this.level.zoom !== undefined) return;
    this.camera.position.zDefault = zoom;
    this.camera.position.z = zoom;
    this.saveOrbitState();
    this.graphics.render();
  }

  exitCampaign() {
    app.play = false;
    app.resetScene();
    app.level.clearLevel();
    app.player.removeCheckpoint();
    app.player.setPosition({ x: 0, y: 0, z: 0 });
    window.dispatchEvent(new CustomEvent('setPage', { detail: 'level-picker' }));
    window.dispatchEvent(new CustomEvent('closePopup'));
  }

  startLevel() {
    app.play = true;
    app.timer.start();

    // Adjust camera zoom
    if (app.level.zoom) {
      app.camera.position.zDefault = app.level.zoom;
      app.camera.position.z = app.level.zoom;
      app.saveOrbitState();
    }

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
      var storageSettings = this.storage.getSettings();
      var title = options.json.name;
      var description = this.level.getDescriptionByTitle(title)
      var author = this.level.getAuthorByTitle(title);
      var theme = this.level.getTheme(options.json.theme);
      var zoom = options.json.zoom || app.camera.position.zDefault;
      if (theme == null) theme = this.level.getPackTheme(title);
      if (theme == null) theme = app.level.getTheme('classic');
      // Old Backgrounds: force classic theme for official levels only, community packs keep their authored theme
      if (storageSettings.themeOldBackgrounds == true && this.level.isFromCommunityPack(title) === false) theme = app.level.getTheme('classic');
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
      app.level.importFromJSON(options.json);
      // Apply level's custom default color override, if set (loaded above by importFromJSON)
      if (app.level.defaultBlockColor) app.level.entityFactory.color = app.level.defaultBlockColor;
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
  }

  resumeLevel() {
    app.timer.resume();
    app.play = true;
    window.dispatchEvent(new CustomEvent('closePopup'));
  }

  showCanvas() {
    app.canvas.classList.remove('hidden');
  }

  hideCanvas() {
    app.canvas.classList.add('hidden');
  }

  isInputBufferValid() {
    var settings = app.storage.getSettings();
    var inputBufferIsDisabled = settings.buffer === 0;
    return inputBufferIsDisabled;
  }

  isDebugValid() {
    var settings = app.storage.getSettings();
    var debugIsDisabled = settings.debug === false;
    return debugIsDisabled;
  }

  isZoomValid() {
    var zoom = app.camera.position.z;
    var zoomIsValid = app.level.zoom ? (zoom == app.level.zoom) : (zoom == 180);
    return zoomIsValid;
  }

  isDeterministicValid() {
    var settings = app.storage.getSettings();
    return settings.deterministic !== true;
  }

  isVerified() {
    return this.isInputBufferValid() && this.isDebugValid() && this.isZoomValid() && this.isDeterministicValid();
  }
}

export { App };