// Upgrades data saved by older versions, runs before any other module reads storage

// Old top-level settings key -> new nested path
const legacySettingsPaths = {
  autosave: 'levelEditor.autosave',
  visualGrid: 'levelEditor.visualGrid',
  snap: 'levelEditor.snap',
  buffer: 'invalidatingSettings.inputBuffer',
  debug: 'invalidatingSettings.hitboxes',
  deterministic: 'invalidatingSettings.deterministic',
  saveInvalidRuns: 'invalidatingSettings.saveInvalidRuns',
  zoom: 'invalidatingSettings.zoom',
  showJumpIndicator: 'invalidatingSettings.jumpIndicator',
  scale: 'graphics.scale',
  quality: 'graphics.quality',
  stats: 'graphics.stats',
  deathParticleColor: 'general.deathParticleColour',
  disableTextboxes: 'general.disableTextboxes',
  skin: 'general.skin',
  name: 'multiplayer.name',
  peer: 'multiplayer.peer',
  connection: 'multiplayer.connection',
  music: 'audio.music',
  volume: 'audio.volume',
  volumeMusic: 'audio.volumeMusic',
  volumeEffects: 'audio.volumeEffects',
  progress: 'selectedLevel'
};

function setPath(object, path, value) {
  var keys = path.split('.');
  var last = keys.pop();
  keys.forEach(function(key) {
    if (object[key] == null || typeof object[key] !== 'object') object[key] = {};
    object = object[key];
  });
  if (object[last] === undefined) object[last] = value; // Never overwrite an already-converted value
}

function convertSettings(settings) {
  if (settings.theme != null && typeof settings.theme !== 'object') delete settings.theme; // Very old saves stored the preset name here

  Object.keys(settings).forEach(function(key) {
    var value = settings[key];

    if (legacySettingsPaths[key]) {
      setPath(settings, legacySettingsPaths[key], value);
    }
    else if (key == 'motion') {
      setPath(settings, 'graphics.cameraRotation', value);
      setPath(settings, 'graphics.backgroundMotion', value);
    }
    else if (key == 'controls') {
      if (value?.reverse != null) setPath(settings, 'general.reverseControls', value.reverse !== true); // Inverted meaning
    }
    else if (key.indexOf('theme') == 0 && key.length > 5) {
      setPath(settings, 'theme.' + key.charAt(5).toLowerCase() + key.slice(6), value); // themeAccentColor -> theme.accentColor
    }
    else return; // Already in the new format

    delete settings[key];
  });
  return settings;
}

function convertStoredSettings() {
  try {
    var stored = localStorage.getItem('settings');
    if (stored == null) return;
    localStorage.setItem('settings', JSON.stringify(convertSettings(JSON.parse(stored))));
  }
  catch (err) {
    console.error(err);
  }
}

function runBackwardsCompatibility() {
  convertStoredSettings();
}

runBackwardsCompatibility();

export { runBackwardsCompatibility, convertSettings };
