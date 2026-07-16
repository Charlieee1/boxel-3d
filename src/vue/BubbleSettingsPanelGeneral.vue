<script setup>
  import { useI18n } from 'vue-i18n';

  const i18n = useI18n({ useScope: 'global' });
  const props = defineProps(['settings']);
  const emit = defineEmits(['updateSettings']);
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
    </div>
  </div>
</template>
