import { MathUtils } from 'three';
import { Utility } from './Utility.js';
import { saveAs } from 'file-saver';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { runBackwardsCompatibility } from './BackwardsCompatibility.js';

class StorageManager {
  constructor() {
    this.levelPrefix = 'level_';
    this.thumbnailPrefix = 'thumbnail_';
    this.thumbnails = new Map(); // In-memory copy so thumbnails can be read synchronously
    this.thumbnailDB = this.openThumbnailDB();
    var loaded = this.migrateLocalThumbnails().then(() => this.loadThumbnails()).catch(err => console.error(err));
    this.thumbnailsReady = Promise.race([loaded, new Promise(resolve => setTimeout(resolve, 5000))]); // Never block startup on a stuck database
  }

  // Resolves to null when IndexedDB is unavailable, thumbnails then fall back to localStorage
  openThumbnailDB() {
    return new Promise(function(resolve) {
      try {
        var request = indexedDB.open('boxel-3d', 1);
        request.onupgradeneeded = function() { request.result.createObjectStore('thumbnails'); };
        request.onsuccess = function() { resolve(request.result); };
        request.onerror = function() { resolve(null); };
        request.onblocked = function() { resolve(null); };
      }
      catch (err) {
        resolve(null);
      }
    });
  }

  // Runs action(store) in one transaction and resolves when it commits
  thumbnailTransaction(mode, action) {
    return this.thumbnailDB.then(function(db) {
      if (db == null) throw new Error('IndexedDB unavailable');
      return new Promise(function(resolve, reject) {
        var transaction = db.transaction('thumbnails', mode);
        action(transaction.objectStore('thumbnails'));
        transaction.oncomplete = function() { resolve(); };
        transaction.onerror = function() { reject(transaction.error); };
        transaction.onabort = function() { reject(transaction.error); };
      });
    });
  }

  // Move thumbnails from localStorage into IndexedDB, only removing them once the copy has committed
  migrateLocalThumbnails() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key.indexOf(this.thumbnailPrefix) == 0) keys.push(key);
    }
    if (keys.length == 0) return Promise.resolve();
    var prefixLength = this.thumbnailPrefix.length;
    return this.thumbnailTransaction('readwrite', function(store) {
      keys.forEach(function(key) { store.put(localStorage.getItem(key), key.slice(prefixLength)); });
    }).then(function() {
      keys.forEach(function(key) { localStorage.removeItem(key); });
    });
  }

  loadThumbnails() {
    var thumbnails = this.thumbnails;
    return this.thumbnailTransaction('readonly', function(store) {
      store.openCursor().onsuccess = function(e) {
        var cursor = e.target.result;
        if (cursor == null) return;
        thumbnails.set(cursor.key, cursor.value);
        cursor.continue();
      };
    });
  }

  // Store thumbnails in memory and IndexedDB, falling back to localStorage if the database fails
  setThumbnails(entries, clear = false) {
    var thumbnails = this.thumbnails;
    var prefix = this.thumbnailPrefix;
    if (clear) thumbnails.clear();
    entries.forEach(function(entry) { thumbnails.set(entry[0], entry[1]); });
    return this.thumbnailTransaction('readwrite', function(store) {
      if (clear) store.clear();
      entries.forEach(function(entry) { store.put(entry[1], entry[0]); });
    }).catch(function(err) {
      console.error(err);
      entries.forEach(function(entry) {
        try { localStorage.setItem(prefix + entry[0], entry[1]); }
        catch (e) { console.error(e); }
      });
    });
  }

  getAllLocalStorage() {
    var a = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      var v = localStorage.getItem(k);
      a[k] = this.getExportValue(k, v);
    }

    // Thumbnails keep their old localStorage key format so backups stay compatible
    this.thumbnails.forEach((value, key) => { a[this.thumbnailPrefix + key] = value; });
    return a;
  }

  async setAllLocalStorage(data, clear = true) {
    await this.thumbnailsReady;
    if (clear) localStorage.clear(); // Empty out old data
    var thumbnails = [];
    Object.keys(data).forEach(key => {
      if (key.indexOf(this.thumbnailPrefix) == 0) thumbnails.push([key.slice(this.thumbnailPrefix.length), data[key]]);
      else localStorage.setItem(key, data[key]);
    });
    this.onDataImported(); // Convert before awaiting, so nothing can read unconverted settings
    app.updateSettings(null); // Apply imported settings, including the theme
    window.dispatchEvent(new CustomEvent('settingsImported'));
    await this.setThumbnails(thumbnails, clear);
  }

  // Strip the save timestamp from settings before they leave the device
  getExportValue(key, value) {
    if (key != 'settings') return value;
    try {
      var settings = JSON.parse(value);
      delete settings.lastSaved;
      return JSON.stringify(settings);
    }
    catch (err) {
      return value;
    }
  }

  // Upgrade imported data and mark its settings as saved at import time
  onDataImported() {
    runBackwardsCompatibility();
    var stored = localStorage.getItem('settings');
    if (stored == null) return;
    var settings = JSON.parse(stored);
    settings.lastSaved = Date.now();
    localStorage.setItem('settings', JSON.stringify(settings));
  }

  getListOfLevels() {
    var levels = [];
    var length = localStorage.length;
    for (var i = 0; i < length; i++) {
      var key = localStorage.key(i);
      if (key.indexOf(this.levelPrefix) >= 0) {
        levels.push({ key: key, level: JSON.parse(localStorage.getItem(key)) });
      }
    }
    levels.sort((a,b) => (a.level.name > b.level.name) ? 1 : ((b.level.name > a.level.name) ? -1 : 0));
    return levels;
  }

  getLevelData(key) {
    return JSON.parse(localStorage.getItem(key));
  }

  setLevelData(key, level) {
    var index = 1;
    if (key == null) {
      while (localStorage.getItem(this.levelPrefix + index) != null) index++;
      key = 'level_' + index;
    }
    localStorage.setItem(key, JSON.stringify(level));
    return key; // Useful for sharing newly generated level key
  }

  removeLevelData(key) {
    localStorage.removeItem(key);
  }

  updateLevelDataName(key, name) {
    var levelData = this.getLevelData(key);
    levelData.name = name;
    this.setLevelData(key, levelData);
  }

  saveScore(key, score) {
    var settings = this.getSettings();
    if (settings.invalidatingSettings.saveInvalidRuns === false && app.isVerified() === false) return false;

    var scores = this.getScores();
    var oldScore = 999999999; // Default bad score
    var newScore = parseInt(score.replace(/[^\d]/g, ''));
    var hasNewScore = false;
    var data = scores[key];

    // Update old score if it exists
    if (data != null) {
      if (data.indexOf(':') >= 0) data += '0'; // Resolve deprecated ##:##
      oldScore = parseInt(data.replace(/[^\d]/g, ''));
    }

    // Check high score
    if (newScore < oldScore) {
      hasNewScore = true;
      scores[key] = score;
      localStorage.setItem('scores', JSON.stringify(scores));
      this.saveThumbnailAfterPopupOpened(key);
    }

    // Return new score state
    return hasNewScore;
  }

  getScores() {
    var scores = localStorage.getItem('scores');
    if (scores == null) {
      scores = '{}';
      localStorage.setItem('scores', scores);
    }
    return JSON.parse(scores); // Return player scores
  }

  saveThumbnail(key) {
    // Store screenshot
    var screenshot = app.storage.screenshot({ width: 200, height: 200, zoom: 1 });
    app.storage.setThumbnails([[key, screenshot]]); // Mods call this unbound, so use app.storage instead of this
  }

  saveThumbnailAfterPopupOpened(key) {
    // Create event function that removes itself when finished
    const saveThumbnailEvent = () => {
      app.storage.saveThumbnail(key);
      window.removeEventListener('popupOpened', saveThumbnailEvent);
    };

    // Add event listeners
    window.addEventListener('popupOpened', saveThumbnailEvent);
  }

  getThumbnail(key) {
    var thumbnail = this.thumbnails.get(key);
    return thumbnail != null ? thumbnail : localStorage.getItem(this.thumbnailPrefix + key); // localStorage holds them if IndexedDB is unavailable
  }

  // Returns false without saving if the settings were read before the last save
  setSettings(settings) {
    var stored = JSON.parse(localStorage.getItem('settings') || '{}');
    var storedLastSaved = stored.lastSaved || 0;
    if ((settings.lastSaved || 0) < storedLastSaved) {
      console.warn('Ignored saving outdated settings', settings);
      return false;
    }
    settings.lastSaved = Math.max(Date.now(), storedLastSaved + 1);
    localStorage.setItem('settings', JSON.stringify(settings));
    return true;
  }

  // Recursively copy keys missing from target, plain objects only
  fillMissingSettings(target, source) {
    for (var key in source) {
      var value = source[key];
      if (target[key] == null) target[key] = value;
      else if (value != null && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object') {
        this.fillMissingSettings(target[key], value);
      }
    }
    return target;
  }

  getSettings() {
    var util = new Utility();
    var storageSettings = localStorage.getItem('settings');
    var defaultSettings = {
      lastSaved: 0,
      language: 'en',
      levelPacks: 'https://raw.githubusercontent.com/Charlieee1/Boxel-3d-Mods/refs/heads/main/community-levels/community-levels.json',
      selectedLevel: 1,
      levelEditor: {
        autosave: 0,
        snap: 8,
        visualGrid: false
      },
      invalidatingSettings: {
        deterministic: false,
        hitboxes: false,
        inputBuffer: 0,
        jumpIndicator: false,
        saveInvalidRuns: false,
        zoom: 180
      },
      graphics: {
        backgroundMotion: true,
        cameraRotation: true,
        quality: 10,
        scale: 1,
        stats: false
      },
      general: {
        deathParticleColour: '#dc265a',
        disableTextboxes: false,
        reverseControls: true,
        skin: { id: 466, title: "Smile", url: "./png/smile.png" }
      },
      multiplayer: {
        connection: '',
        name: 'Player',
        peer: this.generateHex('')
      },
      theme: {
        accentColor: '#eb2b6d',
        bgColor1: '#1e1e1e',
        bgColor2: '#FF8A4C',
        bgColor3: '#FF674C',
        cornerRadius: 8,
        editorButtonBgColor: '#4ca9ff',
        editorButtonBlocksColor: '#4c7dff',
        editorButtonCraneColor: '#ffc24c',
        editorIconDeselectedColor: '#999999',
        editorIconHighlightColor: null,
        editorIconHighlightColorIsExplicit: false,
        editorIconHighlightOpacity: 1,
        editorIconSelectedColor: '#ffffff',
        editorIconShadowColor: '#000000',
        editorIconShadowOpacity: 0.15,
        editorIconSize: 1.5, // em multiplier, unit appended when applied as a CSS variable
        editorTextboxBgColor: '#262626',
        editorTextboxFontColor: '#ffffff',
        editorPreset: 'dark',
        editorToolbarColor1: '#1a1a1a',
        editorToolbarColor2: '#0e0e0e',
        editorToolbarOpacity: 0.5,
        iconSize: 1, // em multiplier, unit appended when applied as a CSS variable
        menuBgColor1: '#7908eb',
        menuBgColor2: '#9b08eb',
        menuBgColor3: '#b122ff',
        menuBgColor4: '#c04cff',
        multiplayerBgColor: '#a8e148',
        oldBackgrounds: false,
        optionAccentColor: '#4ca9ff',
        optionAccentColor2: '#FFC24C',
        playButtonBgColor: '#ff4c8a',
        playButtonPlatformColor: '#ffd687',
        skinsBgColor: '#ff8a4c',
        statsIconColor: '#4CA9FF',
        popupBgColor: '#000000',
        popupOpacity: 0.5,
        popupPreset: 'dark',
        popupTextColor: '#ffffff',
        preset: 'bubble'
      },
      audio: {
        music: 'boxel-3d-classic',
        volume: util.isExtension() ? 0 : 0.5,
        volumeMusic: 0.5,
        volumeEffects: 1
      }
    };
    var settings = defaultSettings; // Use default

    // Replace with local storage settings
    if (storageSettings != null) {
      settings = JSON.parse(storageSettings);
    }

    // Check if new child settings are null by looping through default
    this.fillMissingSettings(settings, defaultSettings);

    // Reformat old settings
    if (settings.multiplayer.peer.length > 6) settings.multiplayer.peer = this.generateHex('');

    // Return settings object
    return settings;
  }

  async saveLevelToFile() {
    var levelData = app.level.exportToJSON();
    var blob = new Blob([JSON.stringify(levelData)], { type: "application/json" });
    var util = new Utility();

    if (util.isNativeApp()) {
      try {
        const version = new Date().getTime();
        await Filesystem.writeFile({
          path: `${ levelData.name } v${ version }.json`,
          data: JSON.stringify(levelData),
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        alert('Success! Saved to ' + result.uri);
      }
      catch (err) {
        console.error(err);
        alert(JSON.stringify(err));
      }
    }
    else {
      saveAs(blob, levelData.name + '.json');
    }
  }

  screenshot(options) {
    // Set default options
    options = Object.assign({
      width: 640,
      height: 360,
      zoom: 1,
      save: false
    }, options);

    var src = '';
    var widthOrigin = window.innerWidth;
    var heightOrigin = window.innerHeight;
    var zoomOrigin = app.graphics.camera.zoom;
    var pixelRatioOrigin = app.graphics.renderer.getPixelRatio();
    
    // Update camera and renderer for screenshot
    app.graphics.camera.zoom = options.zoom;
    app.graphics.camera.aspect = options.width / options.height;
    app.graphics.camera.updateProjectionMatrix();
    app.graphics.renderer.setPixelRatio(1);
    app.graphics.renderer.setSize(options.width, options.height);
    app.graphics.renderer.render(app.graphics.scene, app.graphics.camera);
    
    // Create a new 2D canvas from the three.js WebGL canvas
    const webglCanvas = app.graphics.renderer.domElement;
    const canvas2d = document.createElement('canvas');
    canvas2d.width = webglCanvas.width;
    canvas2d.height = webglCanvas.height;
    const ctx2d = canvas2d.getContext('2d');
    ctx2d.drawImage(webglCanvas, 0, 0);
    
    // Add verification badge
    if (app.isVerified()) {
      ctx2d.save();
      ctx2d.font = '48px "Material Symbols Rounded", sans-serif';
      ctx2d.fillStyle = '#FFFFFF';
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'top';
      ctx2d.shadowColor = 'rgba(0, 0, 0, 0.25)';
      ctx2d.shadowOffsetX = 0;
      ctx2d.shadowOffsetY = 2;
      ctx2d.shadowBlur = 0;
      ctx2d.fillText(String.fromCharCode(parseInt('ef76', 16)), 10, 10);
      ctx2d.restore();
    }

    // You can now use ctx2d to draw 2D graphics, text, etc.
    src = canvas2d.toDataURL('image/png');
    
    // Save to file
    if (options.save == true) {
      canvas2d.toBlob(blob => saveAs(blob, 'screenshot.png'));
    }
    
    // Reset camera and renderer
    app.graphics.camera.zoom = zoomOrigin;
    app.graphics.camera.aspect = widthOrigin / heightOrigin;
    app.graphics.camera.updateProjectionMatrix();
    app.graphics.renderer.setPixelRatio(pixelRatioOrigin);
    app.graphics.renderer.setSize(widthOrigin, heightOrigin);
    app.graphics.renderer.render(app.graphics.scene, app.graphics.camera);

    // Return src for data save
    return src;
  }

  loadLevelFromFile() {
    var input = document.createElement("input");
    input.setAttribute('type', 'file');
    input.setAttribute('id', 'theFile');
    input.addEventListener('change', handleFileSelect, false);
    function performClick() {
      var evt = document.createEvent("MouseEvents");
      evt.initEvent("click", true, false);
      input.dispatchEvent(evt);
    }
    function handleFileSelect(evt) {
      var files = evt.target.files;
      var f = files[0];
      var reader = new FileReader();
      reader.onload = (function(theFile) {
        return function(e) {
          var name = theFile.name.split('.').slice(0, -1).join('.');
          var levelData = JSON.parse(e.target.result);
          levelData.name = name; // Rename level name to file name
          app.level.clearLevel();
          app.level.importFromJSON(levelData);
        };
      })(f);
      reader.readAsText(f);
    }
    performClick();
  }

  async backupToFile() {
    await app.storage.thumbnailsReady;
    var local = app.storage.getAllLocalStorage();
    var blob = new Blob([JSON.stringify(local)], { type: "application/json" });
    var util = new Utility();

    if (util.isNativeApp()) {
      try {
        const version = new Date().getTime();
        const result = await Filesystem.writeFile({
          path: `boxel_3d_backup_${ version }.json`,
          data: JSON.stringify(local),
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        alert('Success! Saved to ' + result.uri);
      }
      catch (err) {
        console.error(err);
        alert(JSON.stringify(err));
      }
    }
    else {
      saveAs(blob, 'boxel_3d_backup');
    }
  }

  restoreFromFile() {
    // Open confirmation window
    window.dispatchEvent(new CustomEvent('openPopup', {
      detail: {
        text: 'popup.text.restore_file_data',
        inputs: [
          { value: 'popup.button.restore', type: 'button',
            callback: function() {
              var input = document.createElement("input");
              input.setAttribute('type', 'file');
              input.setAttribute('id', 'theFile');
              input.addEventListener('change', handleFileSelect, false);
              function performClick() {
                var evt = document.createEvent("MouseEvents");
                evt.initEvent("click", true, false);
                input.dispatchEvent(evt);
              }
              function handleFileSelect(evt) {
                var files = evt.target.files;
                var f = files[0];
                var reader = new FileReader();
                reader.onload = (function() {
                  return async function(e) {
                    var data = JSON.parse(e.target.result);
                    await app.storage.setAllLocalStorage(data);

                    // Open confirmation window
                    window.dispatchEvent(new CustomEvent('openPopup', {
                      detail: {
                        text: 'popup.text.file_data_restored',
                        inputs: [{ value: 'popup.button.continue', type: 'button'}]
                      }
                    }));
                  };
                })(f);
                reader.readAsText(f);
              }
              performClick();
            }
          },
          { value: 'popup.button.cancel', type: 'button' }
        ]
      }
    }));
  }

  backupToChrome(clearChromeStorage = false) {
    // Open confirmation window
    window.dispatchEvent(new CustomEvent('openPopup', {
      detail: {
        text: 'popup.text.save_data_to_cloud',
        inputs: [
          { value: 'popup.button.backup', type: 'button',
            callback: function() {
              var index = 0;
              if (clearChromeStorage == true) window.chrome?.storage.sync.clear(); //initially clear online storage
              for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                var value = app.storage.getExportValue(key, localStorage.getItem(key));
                var obj = {};
                obj[key] = value;
                window.chrome?.storage.sync.set(obj, function() {
                  index++; // Show message on last item
                  if (index == localStorage.length) {
                    // Show confirmation
                    window.dispatchEvent(new CustomEvent('openPopup', {
                      detail: {
                        text: 'popup.text.cloud_data_saved',
                        inputs: [{ value: 'popup.button.continue', type: 'button' }]
                      }
                    }));
                  }
                });
              }
            }
          },
          { value: 'popup.button.cancel', type: 'button' }
        ]
      }
    }));
  }

  restoreFromChrome(clearLocalStorage = false) {
    // Open confirmation window
    window.dispatchEvent(new CustomEvent('openPopup', {
      detail: {
        text: 'popup.text.restore_cloud_data',
        inputs: [
          { value: 'popup.button.restore', type: 'button',
            callback: function() {
              // Restore
              chrome?.storage.sync.get(null, async function(items) {
                await app.storage.setAllLocalStorage(items, clearLocalStorage == true);

                // Show confirmation
                window.dispatchEvent(new CustomEvent('openPopup', {
                  detail: {
                    text: 'popup.text.cloud_data_restored',
                    inputs: [{ value: 'popup.button.continue', type: 'button' }]
                  }
                }));
              });
            }
          },
          { value: 'popup.button.cancel', type: 'button' }
        ]
      }
    }));
  }

  generateHex(prefix = '#') {
    // https://stackoverflow.com/questions/1484506/random-color-generator
    return prefix + (Math.random()*0xFFFFFF<<0).toString(16).padStart(6, '0');
  }

  generateUUID() {
    return MathUtils.generateUUID();
  }
}

export { StorageManager };