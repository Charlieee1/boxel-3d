<script setup>
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';

  const i18n = useI18n({ useScope: 'global' });
  const app = window.app;
  const props = defineProps(['settings']);
  const emit = defineEmits(['updateSettings']);

  // Dynamic default: halfway between black and the accent colour, until the user explicitly sets it
  const highlightColorDisplay = computed(() => {
    if (props.settings.themeEditorIconHighlightColorIsExplicit && props.settings.themeEditorIconHighlightColor) {
      return props.settings.themeEditorIconHighlightColor;
    }
    return app.util.hexMidpoint('#000000', props.settings.themeAccentColor || '#000000');
  });

  function onHighlightChange(e) {
    props.settings.themeEditorIconHighlightColor = e.target.value;
    props.settings.themeEditorIconHighlightColorIsExplicit = true;
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
        <select id="themePreset" :value="settings.themePreset" @change="$emit('updateSettings', $event)">
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
        <select id="themeEditorPreset" :value="settings.themeEditorPreset" @change="$emit('updateSettings', $event)">
          <option value="dark">{{ i18n.t('settings.theme.preset_dark') }}</option>
          <option value="light">{{ i18n.t('settings.theme.preset_light') }}</option>
          <option value="funk">{{ i18n.t('settings.theme.preset_funk') }}</option>
        </select>
      </div>
      <div class="option">
        <label for="themePopupPreset">{{ i18n.t('settings.theme.popup_preset') }}</label>
      </div>
      <div class="option">
        <select id="themePopupPreset" :value="settings.themePopupPreset" @change="$emit('updateSettings', $event)">
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
        <input type="color" id="themeBgColor1" :value="settings.themeBgColor1" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeBgColor2">{{ i18n.t('settings.theme.bg_color_2') }}</label>
        <input type="color" id="themeBgColor2" :value="settings.themeBgColor2" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeBgColor3">{{ i18n.t('settings.theme.bg_color_3') }}</label>
        <input type="color" id="themeBgColor3" :value="settings.themeBgColor3" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeAccentColor">{{ i18n.t('settings.theme.accent_color') }}</label>
        <input type="color" id="themeAccentColor" :value="settings.themeAccentColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeOptionAccentColor">{{ i18n.t('settings.theme.option_accent_color') }}</label>
        <input type="color" id="themeOptionAccentColor" :value="settings.themeOptionAccentColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeOptionAccentColor2">{{ i18n.t('settings.theme.option_accent_color_2') }}</label>
        <input type="color" id="themeOptionAccentColor2" :value="settings.themeOptionAccentColor2" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeStatsIconColor">{{ i18n.t('settings.theme.stats_icon_color') }}</label>
        <input type="color" id="themeStatsIconColor" :value="settings.themeStatsIconColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeSkinsBgColor">{{ i18n.t('settings.theme.skins_bg_color') }}</label>
        <input type="color" id="themeSkinsBgColor" :value="settings.themeSkinsBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorButtonBgColor">{{ i18n.t('settings.theme.editor_button_bg_color') }}</label>
        <input type="color" id="themeEditorButtonBgColor" :value="settings.themeEditorButtonBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorButtonCraneColor">{{ i18n.t('settings.theme.editor_button_crane_color') }}</label>
        <input type="color" id="themeEditorButtonCraneColor" :value="settings.themeEditorButtonCraneColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorButtonBlocksColor">{{ i18n.t('settings.theme.editor_button_blocks_color') }}</label>
        <input type="color" id="themeEditorButtonBlocksColor" :value="settings.themeEditorButtonBlocksColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMultiplayerBgColor">{{ i18n.t('settings.theme.multiplayer_bg_color') }}</label>
        <input type="color" id="themeMultiplayerBgColor" :value="settings.themeMultiplayerBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themePlayButtonBgColor">{{ i18n.t('settings.theme.play_button_bg_color') }}</label>
        <input type="color" id="themePlayButtonBgColor" :value="settings.themePlayButtonBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themePlayButtonPlatformColor">{{ i18n.t('settings.theme.play_button_platform_color') }}</label>
        <input type="color" id="themePlayButtonPlatformColor" :value="settings.themePlayButtonPlatformColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMenuBgColor1">{{ i18n.t('settings.theme.menu_bg_color_1') }}</label>
        <input type="color" id="themeMenuBgColor1" :value="settings.themeMenuBgColor1" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMenuBgColor2">{{ i18n.t('settings.theme.menu_bg_color_2') }}</label>
        <input type="color" id="themeMenuBgColor2" :value="settings.themeMenuBgColor2" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMenuBgColor3">{{ i18n.t('settings.theme.menu_bg_color_3') }}</label>
        <input type="color" id="themeMenuBgColor3" :value="settings.themeMenuBgColor3" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeMenuBgColor4">{{ i18n.t('settings.theme.menu_bg_color_4') }}</label>
        <input type="color" id="themeMenuBgColor4" :value="settings.themeMenuBgColor4" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeCornerRadius">{{ i18n.t('settings.theme.corner_radius') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeCornerRadius" min="0" max="32" step="1" :value="settings.themeCornerRadius" @input="$emit('updateSettings', $event)">
        <label for="themeCornerRadius">{{ settings.themeCornerRadius }}</label>
      </div>
      <div class="option">
        <label for="themeIconSize">{{ i18n.t('settings.theme.icon_size') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeIconSize" min="0.5" max="3" step="0.1" :value="settings.themeIconSize" @input="$emit('updateSettings', $event)">
        <label for="themeIconSize">{{ settings.themeIconSize }}em</label>
      </div>
    </div>
    <div class="group">
      <p>{{ i18n.t('settings.theme.editor_title') }}</p>
      <div class="option">
        <label for="themeEditorToolbarColor1">{{ i18n.t('settings.theme.editor_toolbar_color_1') }}</label>
        <input type="color" id="themeEditorToolbarColor1" :value="settings.themeEditorToolbarColor1" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorToolbarColor2">{{ i18n.t('settings.theme.editor_toolbar_color_2') }}</label>
        <input type="color" id="themeEditorToolbarColor2" :value="settings.themeEditorToolbarColor2" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorToolbarOpacity">{{ i18n.t('settings.theme.editor_toolbar_opacity') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeEditorToolbarOpacity" min="0" max="1" step="0.05" :value="settings.themeEditorToolbarOpacity" @input="$emit('updateSettings', $event)">
        <label for="themeEditorToolbarOpacity">{{ settings.themeEditorToolbarOpacity }}</label>
      </div>
      <div class="option">
        <label for="themeEditorIconSize">{{ i18n.t('settings.theme.editor_icon_size') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeEditorIconSize" min="0.5" max="3" step="0.1" :value="settings.themeEditorIconSize" @input="$emit('updateSettings', $event)">
        <label for="themeEditorIconSize">{{ settings.themeEditorIconSize }}em</label>
      </div>
      <div class="option">
        <label for="themeEditorIconDeselectedColor">{{ i18n.t('settings.theme.editor_icon_deselected_color') }}</label>
        <input type="color" id="themeEditorIconDeselectedColor" :value="settings.themeEditorIconDeselectedColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorIconSelectedColor">{{ i18n.t('settings.theme.editor_icon_selected_color') }}</label>
        <input type="color" id="themeEditorIconSelectedColor" :value="settings.themeEditorIconSelectedColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorIconHighlightColor">{{ i18n.t('settings.theme.editor_icon_highlight_color') }}</label>
        <input type="color" id="themeEditorIconHighlightColor" :value="highlightColorDisplay" @change="onHighlightChange($event)">
      </div>
      <div class="option">
        <label for="themeEditorIconHighlightOpacity">{{ i18n.t('settings.theme.editor_icon_highlight_opacity') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeEditorIconHighlightOpacity" min="0" max="1" step="0.1" :value="settings.themeEditorIconHighlightOpacity" @input="$emit('updateSettings', $event)">
        <label for="themeEditorIconHighlightOpacity">{{ settings.themeEditorIconHighlightOpacity }}</label>
      </div>
      <div class="option">
        <label for="themeEditorIconShadowColor">{{ i18n.t('settings.theme.editor_icon_shadow_color') }}</label>
        <input type="color" id="themeEditorIconShadowColor" :value="settings.themeEditorIconShadowColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorIconShadowOpacity">{{ i18n.t('settings.theme.editor_icon_shadow_opacity') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themeEditorIconShadowOpacity" min="0" max="1" step="0.05" :value="settings.themeEditorIconShadowOpacity" @input="$emit('updateSettings', $event)">
        <label for="themeEditorIconShadowOpacity">{{ settings.themeEditorIconShadowOpacity }}</label>
      </div>
      <div class="option">
        <label for="themeEditorTextboxBgColor">{{ i18n.t('settings.theme.editor_textbox_bg_color') }}</label>
        <input type="color" id="themeEditorTextboxBgColor" :value="settings.themeEditorTextboxBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themeEditorTextboxFontColor">{{ i18n.t('settings.theme.editor_textbox_font_color') }}</label>
        <input type="color" id="themeEditorTextboxFontColor" :value="settings.themeEditorTextboxFontColor" @change="$emit('updateSettings', $event)">
      </div>
    </div>
    <div class="group">
      <p>{{ i18n.t('settings.theme.popup_title') }}</p>
      <div class="option">
        <label for="themePopupOpacity">{{ i18n.t('settings.theme.popup_opacity') }}</label>
      </div>
      <div class="option">
        <input type="range" id="themePopupOpacity" min="0" max="1" step="0.05" :value="settings.themePopupOpacity" @input="$emit('updateSettings', $event)">
        <label for="themePopupOpacity">{{ settings.themePopupOpacity }}</label>
      </div>
      <div class="option">
        <label for="themePopupBgColor">{{ i18n.t('settings.theme.popup_bg_color') }}</label>
        <input type="color" id="themePopupBgColor" :value="settings.themePopupBgColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <label for="themePopupTextColor">{{ i18n.t('settings.theme.popup_text_color') }}</label>
        <input type="color" id="themePopupTextColor" :value="settings.themePopupTextColor" @change="$emit('updateSettings', $event)">
      </div>
    </div>
  </div>
</template>
