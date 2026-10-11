<script setup>
  import { onMounted, onUnmounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';

  const i18n = useI18n({ useScope: 'global' });
  var props = defineProps(['settings']);
  var emit = defineEmits(['updateSettings']);

  const zoomDisabled = ref(false);
  const isDebugValid = ref(false);
  const isZoomValid = ref(false);

  function onChange(...args) {
    // Emit event to parent component
    emit(...args);

    // Update settings state
    onSettingsOpened();
  }

  function showHelpers() {
    app.level.showHelpers(props['settings'].invalidatingSettings.hitboxes);
  }

  function onSettingsOpened() {
    isDebugValid.value = app.isDebugValid();
    isZoomValid.value = app.isZoomValid();
    zoomDisabled.value = app.level.zoom !== undefined;
  }

  function onSettingsClosed() {
    isDebugValid.value = true;
    isZoomValid.value = true;
    zoomDisabled.value = false;
  }

  // Read storage directly since props may not be refreshed yet
  function onSettingsImported() {
    onSettingsOpened();
    app.level.showHelpers(app.storage.getSettings().invalidatingSettings.hitboxes);
  }

  // Run function after being mounted (visible)
  onMounted(function() {
    window.addEventListener('settingsOpened', onSettingsOpened);
    window.addEventListener('settingsImported', onSettingsImported);
    window.addEventListener('settingsClosed', onSettingsClosed);
  });

  onUnmounted(function() {
    window.removeEventListener('settingsOpened', onSettingsOpened);
    window.removeEventListener('settingsImported', onSettingsImported);
    window.removeEventListener('settingsClosed', onSettingsClosed);
  });
</script>
<template>
  <div class="panel">
    <p>{{ i18n.t('settings.graphics.title') }}</p>
    <div class="group">
      <div class="option">
        <label for="quality">{{ i18n.t('settings.graphics.quality') }}</label>
      </div>
      <div class="option">
        <input type="range" id="quality" data-setting="graphics.quality" min="1" max="10" step="1" :value="settings.graphics.quality" @change="onChange('updateSettings', $event)">
        <label for="quality">{{ (settings.graphics.quality * 10) }}%</label>
      </div>
      <div class="option">
        <label for="scale">{{ i18n.t('settings.graphics.scale') }}</label>
      </div>
      <div class="option">
        <input type="range" id="scale" data-setting="graphics.scale" min="0.5" max="1.5" step="0.125" :value="settings.graphics.scale" @change="onChange('updateSettings', $event)">
        <label for="scale">{{ (settings.graphics.scale * 100) }}%</label>
      </div>
    </div>

    <div class="group">
      <div class="option">
        <label for="cameraRotation">{{ i18n.t('settings.graphics.camera') }}</label>
      </div>
      <div class="option">
        <input type="checkbox" id="cameraRotation" data-setting="graphics.cameraRotation" :checked="settings.graphics.cameraRotation == true" @change="onChange('updateSettings', $event)">
        <label for="cameraRotation">{{ i18n.t('settings.graphics.auto_rotate') }}</label>
      </div>
      <div class="option">
        <input type="checkbox" id="backgroundMotion" data-setting="graphics.backgroundMotion" :checked="settings.graphics.backgroundMotion == true" @change="onChange('updateSettings', $event)">
        <label for="backgroundMotion">{{ i18n.t('settings.graphics.background_motion') }}</label>
      </div>
      <div class="option">
        <label for="zoom">
          <span v-if="!isZoomValid" class="material-symbols-rounded" :data-title="i18n.t('settings.graphics.zoom_badge')">verified_off</span>
          <span v-if="zoomDisabled" class="material-symbols-rounded" :data-title="i18n.t('settings.graphics.zoom_disabled')">lock</span>
          <span>{{ i18n.t('settings.graphics.zoom') }}</span>
        </label>
      </div>
      <div class="option">
        <input type="range" id="zoom" data-setting="invalidatingSettings.zoom" min="80" max="280" step="20" :value="settings.invalidatingSettings.zoom" :disabled="zoomDisabled" @input="onChange('updateSettings', $event)">
        <label for="zoom">{{ (settings.invalidatingSettings.zoom) }}</label>
      </div>
    </div>
    <div class="group">
      <div class="option">
        <label>{{ i18n.t('settings.graphics.developer_tools') }}</label>
      </div>
      <div class="option">
        <input type="checkbox" id="stats" data-setting="graphics.stats" :checked="settings.graphics.stats == true" @change="onChange('updateSettings', $event)">
        <label for="stats">{{ i18n.t('settings.graphics.show_fps') }}</label>
      </div>
      <div class="option">
        <input type="checkbox" id="debug" data-setting="invalidatingSettings.hitboxes" :checked="settings.invalidatingSettings.hitboxes == true" @change="onChange('updateSettings', $event, null, showHelpers)">
        <label for="debug">
          <span v-if="!isDebugValid" class="material-symbols-rounded" :data-title="i18n.t('settings.graphics.debug_badge')">verified_off</span>
          <span>{{ i18n.t('settings.graphics.debug_mode') }}</span>
        </label>
      </div>
    </div>
  </div>
</template>