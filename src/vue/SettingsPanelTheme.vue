<script setup>
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';

  const i18n = useI18n({ useScope: 'global' });
  const app = window.app;
  const props = defineProps(['settings']);
  const emit = defineEmits(['updateSettings']);

  // Dynamic default: halfway between black and the accent colour, until the user explicitly sets it
  const highlightColorDisplay = computed(() => {
    if (props.settings.theme.editorIconHighlightColorIsExplicit && props.settings.theme.editorIconHighlightColor) {
      return props.settings.theme.editorIconHighlightColor;
    }
    return app.util.hexMidpoint('#000000', props.settings.theme.accentColor || '#000000');
  });

  function onHighlightChange(e) {
    emit('updateSettings', { target: { dataset: { setting: 'theme.editorIconHighlightColorIsExplicit' }, value: true } });
    emit('updateSettings', e);
  }
</script>
<template>
  <div class="panel">
    <p>{{ i18n.t('settings.theme.title') }}</p>
    <div class="group">
      <div class="option">
        <label for="themePreset">{{ i18n.t('settings.theme.preset') }}</label>
      </div>
      <div class="option">
        <select id="themePreset" data-setting="theme.preset" :value="settings.theme.preset" @change="$emit('updateSettings', $event)">
          <option value="bubble">{{ i18n.t('settings.theme.preset_bubble') }}</option>
          <option value="classic">{{ i18n.t('settings.theme.preset_classic') }}</option>
          <option value="legacy">{{ i18n.t('settings.theme.preset_legacy') }}</option>
          <option value="funk">{{ i18n.t('settings.theme.preset_funk') }}</option>
        </select>
      </div>
      <div class="option">
        <label for="themeEditorPreset">{{ i18n.t('settings.theme.editor_preset') }}</label>
      </div>
      <div class="option">
        <select id="themeEditorPreset" data-setting="theme.editorPreset" :value="settings.theme.editorPreset" @change="$emit('updateSettings', $event)">
          <option value="dark">{{ i18n.t('settings.theme.preset_dark') }}</option>
          <option value="light">{{ i18n.t('settings.theme.preset_light') }}</option>
          <option value="funk">{{ i18n.t('settings.theme.preset_funk') }}</option>
        </select>
      </div>
      <div class="option">
        <label for="themePopupPreset">{{ i18n.t('settings.theme.popup_preset') }}</label>
      </div>
      <div class="option">
        <select id="themePopupPreset" data-setting="theme.popupPreset" :value="settings.theme.popupPreset" @change="$emit('updateSettings', $event)">
          <option value="dark">{{ i18n.t('settings.theme.preset_dark') }}</option>
          <option value="light">{{ i18n.t('settings.theme.preset_light') }}</option>
          <option value="funk">{{ i18n.t('settings.theme.preset_funk') }}</option>
        </select>
      </div>
    </div>
    <div class="group">
      <p>{{ i18n.t('settings.theme.general_title') }}</p>
      <div class="option">
        <label for="themeBgColor1">{{ i18n.t('settings.theme.bg_color_1') }}</label>
        <input type="color" id="themeBgColor1" data-setting="theme.bgColor1" :value="settings.theme.bgColor1" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeBgColor2">{{ i18n.t('settings.theme.bg_color_2') }}</label>
        <input type="color" id="themeBgColor2" data-setting="theme.bgColor2" :value="settings.theme.bgColor2" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeBgColor3">{{ i18n.t('settings.theme.bg_color_3') }}</label>
        <input type="color" id="themeBgColor3" data-setting="theme.bgColor3" :value="settings.theme.bgColor3" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeAccentColor">{{ i18n.t('settings.theme.accent_color') }}</label>
        <input type="color" id="themeAccentColor" data-setting="theme.accentColor" :value="settings.theme.accentColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeOptionAccentColor">{{ i18n.t('settings.theme.option_accent_color') }}</label>
        <input type="color" id="themeOptionAccentColor" data-setting="theme.optionAccentColor" :value="settings.theme.optionAccentColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeOptionAccentColor2">{{ i18n.t('settings.theme.option_accent_color_2') }}</label>
        <input type="color" id="themeOptionAccentColor2" data-setting="theme.optionAccentColor2" :value="settings.theme.optionAccentColor2" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeStatsIconColor">{{ i18n.t('settings.theme.stats_icon_color') }}</label>
        <input type="color" id="themeStatsIconColor" data-setting="theme.statsIconColor" :value="settings.theme.statsIconColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeSkinsBgColor">{{ i18n.t('settings.theme.skins_bg_color') }}</label>
        <input type="color" id="themeSkinsBgColor" data-setting="theme.skinsBgColor" :value="settings.theme.skinsBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorButtonBgColor">{{ i18n.t('settings.theme.editor_button_bg_color') }}</label>
        <input type="color" id="themeEditorButtonBgColor" data-setting="theme.editorButtonBgColor" :value="settings.theme.editorButtonBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorButtonCraneColor">{{ i18n.t('settings.theme.editor_button_crane_color') }}</label>
        <input type="color" id="themeEditorButtonCraneColor" data-setting="theme.editorButtonCraneColor" :value="settings.theme.editorButtonCraneColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorButtonBlocksColor">{{ i18n.t('settings.theme.editor_button_blocks_color') }}</label>
        <input type="color" id="themeEditorButtonBlocksColor" data-setting="theme.editorButtonBlocksColor" :value="settings.theme.editorButtonBlocksColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMultiplayerBgColor">{{ i18n.t('settings.theme.multiplayer_bg_color') }}</label>
        <input type="color" id="themeMultiplayerBgColor" data-setting="theme.multiplayerBgColor" :value="settings.theme.multiplayerBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themePlayButtonBgColor">{{ i18n.t('settings.theme.play_button_bg_color') }}</label>
        <input type="color" id="themePlayButtonBgColor" data-setting="theme.playButtonBgColor" :value="settings.theme.playButtonBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themePlayButtonPlatformColor">{{ i18n.t('settings.theme.play_button_platform_color') }}</label>
        <input type="color" id="themePlayButtonPlatformColor" data-setting="theme.playButtonPlatformColor" :value="settings.theme.playButtonPlatformColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMenuBgColor1">{{ i18n.t('settings.theme.menu_bg_color_1') }}</label>
        <input type="color" id="themeMenuBgColor1" data-setting="theme.menuBgColor1" :value="settings.theme.menuBgColor1" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMenuBgColor2">{{ i18n.t('settings.theme.menu_bg_color_2') }}</label>
        <input type="color" id="themeMenuBgColor2" data-setting="theme.menuBgColor2" :value="settings.theme.menuBgColor2" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMenuBgColor3">{{ i18n.t('settings.theme.menu_bg_color_3') }}</label>
        <input type="color" id="themeMenuBgColor3" data-setting="theme.menuBgColor3" :value="settings.theme.menuBgColor3" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMenuBgColor4">{{ i18n.t('settings.theme.menu_bg_color_4') }}</label>
        <input type="color" id="themeMenuBgColor4" data-setting="theme.menuBgColor4" :value="settings.theme.menuBgColor4" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeCornerRadius">{{ i18n.t('settings.theme.corner_radius') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeCornerRadius" data-setting="theme.cornerRadius" min="0" max="32" step="1" :value="settings.theme.cornerRadius" @input="$emit('updateSettings', $event)">
        <label for="themeCornerRadius">{{ settings.theme.cornerRadius }}</label>
      </div>
      <div class="option">
        <label for="themeIconSize">{{ i18n.t('settings.theme.icon_size') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeIconSize" data-setting="theme.iconSize" min="0.5" max="3" step="0.1" :value="settings.theme.iconSize" @input="$emit('updateSettings', $event)">
        <label for="themeIconSize">{{ settings.theme.iconSize }}em</label>
      </div>
    </div>
    <div class="group">
      <p>{{ i18n.t('settings.theme.editor_title') }}</p>
      <div class="option">
        <label for="themeEditorToolbarColor1">{{ i18n.t('settings.theme.editor_toolbar_color_1') }}</label>
        <input type="color" id="themeEditorToolbarColor1" data-setting="theme.editorToolbarColor1" :value="settings.theme.editorToolbarColor1" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorToolbarColor2">{{ i18n.t('settings.theme.editor_toolbar_color_2') }}</label>
        <input type="color" id="themeEditorToolbarColor2" data-setting="theme.editorToolbarColor2" :value="settings.theme.editorToolbarColor2" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorToolbarOpacity">{{ i18n.t('settings.theme.editor_toolbar_opacity') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeEditorToolbarOpacity" data-setting="theme.editorToolbarOpacity" min="0" max="1" step="0.05" :value="settings.theme.editorToolbarOpacity" @input="$emit('updateSettings', $event)">
        <label for="themeEditorToolbarOpacity">{{ settings.theme.editorToolbarOpacity }}</label>
      </div>
      <div class="option">
        <label for="themeEditorIconSize">{{ i18n.t('settings.theme.editor_icon_size') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeEditorIconSize" data-setting="theme.editorIconSize" min="0.5" max="3" step="0.1" :value="settings.theme.editorIconSize" @input="$emit('updateSettings', $event)">
        <label for="themeEditorIconSize">{{ settings.theme.editorIconSize }}em</label>
      </div>
      <div class="option">
        <label for="themeEditorIconDeselectedColor">{{ i18n.t('settings.theme.editor_icon_deselected_color') }}</label>
        <input type="color" id="themeEditorIconDeselectedColor" data-setting="theme.editorIconDeselectedColor" :value="settings.theme.editorIconDeselectedColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorIconSelectedColor">{{ i18n.t('settings.theme.editor_icon_selected_color') }}</label>
        <input type="color" id="themeEditorIconSelectedColor" data-setting="theme.editorIconSelectedColor" :value="settings.theme.editorIconSelectedColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorIconHighlightColor">{{ i18n.t('settings.theme.editor_icon_highlight_color') }}</label>
        <input type="color" id="themeEditorIconHighlightColor" data-setting="theme.editorIconHighlightColor" :value="highlightColorDisplay" @change="onHighlightChange($event)">
      </div>
      <div class="option">
        <label for="themeEditorIconHighlightOpacity">{{ i18n.t('settings.theme.editor_icon_highlight_opacity') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeEditorIconHighlightOpacity" data-setting="theme.editorIconHighlightOpacity" min="0" max="1" step="0.1" :value="settings.theme.editorIconHighlightOpacity" @input="$emit('updateSettings', $event)">
        <label for="themeEditorIconHighlightOpacity">{{ settings.theme.editorIconHighlightOpacity }}</label>
      </div>
      <div class="option">
        <label for="themeEditorIconShadowColor">{{ i18n.t('settings.theme.editor_icon_shadow_color') }}</label>
        <input type="color" id="themeEditorIconShadowColor" data-setting="theme.editorIconShadowColor" :value="settings.theme.editorIconShadowColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorIconShadowOpacity">{{ i18n.t('settings.theme.editor_icon_shadow_opacity') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeEditorIconShadowOpacity" data-setting="theme.editorIconShadowOpacity" min="0" max="1" step="0.05" :value="settings.theme.editorIconShadowOpacity" @input="$emit('updateSettings', $event)">
        <label for="themeEditorIconShadowOpacity">{{ settings.theme.editorIconShadowOpacity }}</label>
      </div>
      <div class="option">
        <label for="themeEditorTextboxBgColor">{{ i18n.t('settings.theme.editor_textbox_bg_color') }}</label>
        <input type="color" id="themeEditorTextboxBgColor" data-setting="theme.editorTextboxBgColor" :value="settings.theme.editorTextboxBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorTextboxFontColor">{{ i18n.t('settings.theme.editor_textbox_font_color') }}</label>
        <input type="color" id="themeEditorTextboxFontColor" data-setting="theme.editorTextboxFontColor" :value="settings.theme.editorTextboxFontColor" @change="$emit('updateSettings', $event)">
      </div>
    </div>
    <div class="group">
      <p>{{ i18n.t('settings.theme.popup_title') }}</p>
      <div class="option">
        <label for="themePopupOpacity">{{ i18n.t('settings.theme.popup_opacity') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themePopupOpacity" data-setting="theme.popupOpacity" min="0" max="1" step="0.05" :value="settings.theme.popupOpacity" @input="$emit('updateSettings', $event)">
        <label for="themePopupOpacity">{{ settings.theme.popupOpacity }}</label>
      </div>
      <div class="option">
        <label for="themePopupBgColor">{{ i18n.t('settings.theme.popup_bg_color') }}</label>
        <input type="color" id="themePopupBgColor" data-setting="theme.popupBgColor" :value="settings.theme.popupBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themePopupTextColor">{{ i18n.t('settings.theme.popup_text_color') }}</label>
        <input type="color" id="themePopupTextColor" data-setting="theme.popupTextColor" :value="settings.theme.popupTextColor" @change="$emit('updateSettings', $event)">
      </div>
    </div>
  </div>
</template>
