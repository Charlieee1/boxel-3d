<script setup>
  import { onMounted, onUnmounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';

  const i18n = useI18n({ useScope: 'global' });
  const app = window.app;
  const props = defineProps(['settings']);
  const emit = defineEmits(['updateSettings']);

  const isDeterministicValid = ref(false);
  const isJumpIndicatorValid = ref(false);

  // Editor snap of 0 isn't a valid increment, coerce it to 1 like old UI did
  function onSnapChange(e) {
    var snap = Number(e.target.value);
    if (snap == 0) snap = 1;
    e.target.value = snap;
    emit('updateSettings', e);
  }

  function onChange(...args) {
    // Emit event to parent component
    emit(...args);

    // Update settings state
    onSettingsOpened();
  }

  function onSettingsOpened() {
    isDeterministicValid.value = app.isDeterministicValid();
    isJumpIndicatorValid.value = app.isJumpIndicatorValid();
  }

  function onSettingsClosed() {
    isDeterministicValid.value = true;
    isJumpIndicatorValid.value = true;
  }

  // Run function after being mounted (visible)
  onMounted(function() {
    window.addEventListener('settingsOpened', onSettingsOpened);
    window.addEventListener('settingsImported', onSettingsOpened);
    window.addEventListener('settingsClosed', onSettingsClosed);
  });

  onUnmounted(function() {
    window.removeEventListener('settingsOpened', onSettingsOpened);
    window.removeEventListener('settingsImported', onSettingsOpened);
    window.removeEventListener('settingsClosed', onSettingsClosed);
  });
</script>
<template>
  <div class="panel">
    <p>{{ i18n.t('settings.general.title') }}</p>
    <div class="group">
      <div class="option">
        <label for="autosave">{{ i18n.t('settings.general.autosave') }}</label>
      </div>
      <div class="option">
        <input type="range" id="autosave" data-setting="levelEditor.autosave" min="0" max="20" step="1" :value="settings.levelEditor.autosave" @input="$emit('updateSettings', $event)">
        <label for="autosave">{{ settings.levelEditor.autosave == 0 ? i18n.t('settings.general.autosave_off') : i18n.t('settings.general.autosave_minutes', { n: settings.levelEditor.autosave }) }}</label>
      </div>
      <template v-if="app.state == 'level-manager' || app.state == 'level-editor'">
        <div class="option">
          <label for="snap">{{ i18n.t('settings.general.snap') }}</label>
        </div>
        <div class="option">
          <input type="range" id="snap" data-setting="levelEditor.snap" min="0" max="16" step="4" :value="settings.levelEditor.snap" @input="onSnapChange($event)">
          <label for="snap">{{ settings.levelEditor.snap }}</label>
        </div>
        <div class="option">
          <input type="checkbox" id="visualGrid" data-setting="levelEditor.visualGrid" :checked="settings.levelEditor.visualGrid == true" @change="$emit('updateSettings', $event)">
          <label for="visualGrid">{{ i18n.t('settings.general.visual_grid') }}</label>
        </div>
      </template>
      <div class="option">
        <input type="checkbox" id="disableTextboxes" data-setting="general.disableTextboxes" :checked="settings.general.disableTextboxes == true" @change="$emit('updateSettings', $event)">
        <label for="disableTextboxes">{{ i18n.t('settings.general.disable_textboxes') }}</label>
      </div>
      <div class="option">
        <label for="deathParticleColor">{{ i18n.t('settings.general.death_particle_color') }}</label>
      </div>
      <div class="option">
        <input type="color" id="deathParticleColor" data-setting="general.deathParticleColour" :value="settings.general.deathParticleColour" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <input type="checkbox" id="showJumpIndicator" data-setting="invalidatingSettings.jumpIndicator" :checked="settings.invalidatingSettings.jumpIndicator == true" @change="onChange('updateSettings', $event)">
        <label for="showJumpIndicator">
          <span v-if="!isJumpIndicatorValid" class="material-symbols-rounded" :data-title="i18n.t('settings.general.jump_indicator_badge')">verified_off</span>
          <span>{{ i18n.t('settings.general.show_jump_indicator') }}</span>
        </label>
      </div>
      <div class="option">
        <input type="checkbox" id="deterministic" data-setting="invalidatingSettings.deterministic" :checked="settings.invalidatingSettings.deterministic == true" @change="onChange('updateSettings', $event)">
        <label for="deterministic">
          <span v-if="!isDeterministicValid" class="material-symbols-rounded" :data-title="i18n.t('settings.general.deterministic_badge')">verified_off</span>
          <span>{{ i18n.t('settings.general.deterministic_mode') }}</span>
        </label>
      </div>
      <div class="option">
        <input type="checkbox" id="saveInvalidRuns" data-setting="invalidatingSettings.saveInvalidRuns" :checked="settings.invalidatingSettings.saveInvalidRuns !== false" @change="$emit('updateSettings', $event)">
        <label for="saveInvalidRuns">{{ i18n.t('settings.general.save_invalid_runs') }}</label>
      </div>
      <div class="option">
        <input type="checkbox" id="themeOldBackgrounds" data-setting="theme.oldBackgrounds" :checked="settings.theme.oldBackgrounds == true" @change="$emit('updateSettings', $event)">
        <label for="themeOldBackgrounds">{{ i18n.t('settings.general.old_backgrounds') }}</label>
      </div>
    </div>
  </div>
</template>
