<script setup>
  import { onMounted, ref } from 'vue';
  import { Utility } from '../js/Utility.js';

  // Inline (not <img>) so its fills can react to --theme-menu-bg-color-* CSS variables live
  const util = new Utility();
  var svg = ref('');

  onMounted(async function() {
    svg.value = await util.getInlineSvg('./svg/background-purple.svg');
  });
</script>

<template>
  <div class="menu-background" v-html="svg"></div>
</template>

<style lang="scss" scoped>
  .menu-background {
    display: block;
    height: 100%;
    width: 100%;

    :deep(svg) {
      display: block;
      height: 100%;
      width: 100%;
    }
  }
</style>
