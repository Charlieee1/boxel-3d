<script setup>
  import '../scss/Main.scss';
  import { onMounted, onUnmounted, ref } from 'vue';
  import PageHome from './PageHome.vue';
  import PageSkins from './PageSkins.vue';
  import PageLevelPicker from './PageLevelPicker.vue';
  import PageCampaign from './PageCampaign.vue';
  import PageLevelManager from './PageLevelManager.vue';
  import PageLevelEditor from './PageLevelEditor.vue';
  import Multiplayer from './Multiplayer.vue';
  import Settings from './Settings.vue';
  import Popup from './Popup.vue';

  // Conditionally render components
  var page = ref('home');
  var fontSize = ref();

  function addEventListeners() {
    window.addEventListener('setPage', setPageFromEvent);
    window.addEventListener('updateScale', updateScale);
  }

  function removeEventListeners() {
    window.removeEventListener('setPage', setPageFromEvent);
    window.removeEventListener('updateScale', updateScale);
  }

  function setPageFromEvent(e) {
    if (e.detail) setPage(e.detail);
  }

  function setPage(name) {
    page.value = name;
    app.state = name;
  }

  function updateScale(e) {
    fontSize.value = null;
    if (e.detail < 1 || e.detail > 1) {
      fontSize.value = (e.detail * 4) + 'vh';
    }
  }

  // Run function after being mounted (visible)
  onMounted(function() {
    addEventListeners();
    // Apply current settings scale on mount so remount preserves user choice
    try {
      var settings = app.storage.getSettings();
      updateScale({ detail: settings.scale });
    }
    catch (err) {
      console.error(err);
    }
  });

  onUnmounted(function() {
    removeEventListeners();
  })
</script>

<template>
  <div class="ui-bubble" :style="{ fontSize }">
    <PageHome v-if="page == 'home'" @set-page="setPage" />
    <PageSkins v-if="page == 'skins'" @set-page="setPage" />
    <PageLevelPicker v-if="page == 'level-picker'" @set-page="setPage" />
    <PageCampaign v-if="page == 'campaign'" @set-page="setPage" />
    <PageLevelManager v-if="page == 'level-manager'" @set-page="setPage" />
    <PageLevelEditor v-if="page == 'level-editor'" @set-page="setPage" />
    <Multiplayer />
    <Settings />
    <Popup />
  </div>
</template>