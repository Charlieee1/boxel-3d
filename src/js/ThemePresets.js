import presets from '../json/themePresets.json';

// Preset values from themePresets.json, following "extends", unknown names fall back to the group's first preset
function getThemePreset(group, name) {
  var list = presets[group];
  var { extends: parent, ...values } = list[name] || list[Object.keys(list)[0]];
  return Object.assign(parent ? getThemePreset(group, parent) : {}, values);
}

// Every preset value for a theme (main, level editor and translucent popup groups)
function getPresetTheme(theme) {
  return Object.assign({}, getThemePreset('main', theme.preset), getThemePreset('editor', theme.editorPreset), getThemePreset('popup', theme.popupPreset));
}

export { getThemePreset, getPresetTheme };
