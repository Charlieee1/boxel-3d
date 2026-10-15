<script setup>
  // Renders a themeable level-editor icon: a masked element (not an <img>) so background-color
  // can tint the white source icon to an arbitrary theme colour (see Main.scss .icon-mask rules).
  defineProps({ src: { type: String, required: true } });
</script>
<template>
  <span class="icon-mask" :style="{ maskImage: 'url(' + src + ')', WebkitMaskImage: 'url(' + src + ')' }"></span>
</template>
