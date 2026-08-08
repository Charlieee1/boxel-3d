<script setup>
  import { onMounted, onUnmounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';

  const i18n = useI18n({ useScope: 'global' });
  const app = window.app;
  const props = defineProps(['settings']);
  const emit = defineEmits(['updateSettings']);

  const isDeterministicValid = ref(false);

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
  }

  function onSettingsClosed() {
    isDeterministicValid.value = true;
  }

  // Run function after being mounted (visible)
  onMounted(function() {
    window.addEventListener('settingsOpened', onSettingsOpened);
    window.addEventListener('settingsClosed', onSettingsClosed);
  });

  onUnmounted(function() {
    window.removeEventListener('settingsOpened', onSettingsOpened);
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
        <input type="range" id="autosave" min="0" max="20" step="1" :value="settings.autosave" @input="$emit('updateSettings', $event)">
        <label for="autosave">{{ settings.autosave == 0 ? i18n.t('settings.general.autosave_off') : i18n.t('settings.general.autosave_minutes', { n: settings.autosave }) }}</label>
      </div>
      <template v-if="app.state == 'level-manager' || app.state == 'level-editor'">
        <div class="option">
          <label for="snap">{{ i18n.t('settings.general.snap') }}</label>
        </div>
        <div class="option">
          <input type="range" id="snap" min="0" max="16" step="4" :value="settings.snap" @input="onSnapChange($event)">
          <label for="snap">{{ settings.snap }}</label>
        </div>
        <div class="option">
          <input type="checkbox" id="visualGrid" :checked="settings.visualGrid == true" @change="$emit('updateSettings', $event)">
          <label for="visualGrid">{{ i18n.t('settings.general.visual_grid') }}</label>
        </div>
      </template>
      <div class="option">
        <input type="checkbox" id="disableTextboxes" :checked="settings.disableTextboxes == true" @change="$emit('updateSettings', $event)">
        <label for="disableTextboxes">{{ i18n.t('settings.general.disable_textboxes') }}</label>
      </div>
      <div class="option">
        <label for="deathParticleColor">{{ i18n.t('settings.general.death_particle_color') }}</label>
      </div>
      <div class="option">
        <input type="color" id="deathParticleColor" :value="settings.deathParticleColor" @change="$emit('updateSettings', $event)">
      </div>
      <div class="option">
        <input type="checkbox" id="showJumpIndicator" :checked="settings.showJumpIndicator == true" @change="$emit('updateSettings', $event)">
        <label for="showJumpIndicator">{{ i18n.t('settings.general.show_jump_indicator') }}</label>
      </div>
      <div class="option">
        <input type="checkbox" id="deterministic" :checked="settings.deterministic == true" @change="onChange('updateSettings', $event)">
        <label for="deterministic">
          <span v-if="!isDeterministicValid" class="material-symbols-rounded" :data-title="i18n.t('settings.general.deterministic_badge')">verified_off</span>
          <span>{{ i18n.t('settings.general.deterministic_mode') }}</span>
        </label>
      </div>
      <div class="option">
        <input type="checkbox" id="saveInvalidRuns" :checked="settings.saveInvalidRuns !== false" @change="$emit('updateSettings', $event)">
        <label for="saveInvalidRuns">{{ i18n.t('settings.general.save_invalid_runs') }}</label>
      </div>
      <div class="option">
        <input type="checkbox" id="themeOldBackgrounds" :checked="settings.themeOldBackgrounds == true" @change="$emit('updateSettings', $event)">
        <label for="themeOldBackgrounds">{{ i18n.t('settings.general.old_backgrounds') }}</label>
      </div>
    </div>
  </div>
</template>
