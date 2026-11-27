// Upgrades level data saved by older versions to the current level format

const levelPrefix = 'level_';

// Keys older versions stored at the top level of a level, now kept under level.properties
const legacyLevelPropertyKeys = [
  'theme',
  'defaultBlockColor',
  'description',
  'zoom',
  'disableManualCheckpointRespawn',
  'levelUIText'
];

function convertLevel(levelData) {
  if (levelData == null || typeof levelData !== 'object') return levelData;
  if (levelData.properties == null || typeof levelData.properties !== 'object') levelData.properties = {};

  legacyLevelPropertyKeys.forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(levelData, key)) return;
    if (levelData.properties[key] === undefined) levelData.properties[key] = levelData[key]; // Never overwrite an already-converted value
    delete levelData[key];
  });
  return levelData;
}

function isLegacyLevel(levelData) {
  if (levelData == null || typeof levelData !== 'object') return false;
  if (levelData.properties == null || typeof levelData.properties !== 'object') return true;
  return legacyLevelPropertyKeys.some(key => Object.prototype.hasOwnProperty.call(levelData, key));
}

function convertStoredLevels() {
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key.indexOf(levelPrefix) != 0) continue;
    try {
      var levelData = JSON.parse(localStorage.getItem(key));
      if (isLegacyLevel(levelData)) localStorage.setItem(key, JSON.stringify(convertLevel(levelData)));
    }
    catch (err) {
      console.error(err);
    }
  }
}

export { convertLevel, convertStoredLevels };
