<script setup>
  import { onMounted, onUnmounted } from 'vue';

  const props = defineProps({
    title: { type: String, default: null },
    modelValue: { type: Boolean, default: false },
    size: { type: Number, default: 80 }, // width/height in vh
    closeButton: { type: Boolean, default: false },
    onClose: { type: Function, default: null } // optional extra hook run before closing, e.g. to cancel an in-progress action
  });
  const emit = defineEmits(['update:modelValue']);

  function close() {
    if (typeof props.onClose === 'function') props.onClose();
    emit('update:modelValue', false);
  }

  function keydown(e) {
    if (props.modelValue == true && e.code === 'Escape') close();
  }

  onMounted(function() {
    window.addEventListener('keydown', keydown);
  });

  onUnmounted(function() {
    window.removeEventListener('keydown', keydown);
  });
</script>

<template>
  <Transition name="fade-fancy-popup">
    <div class="fancy-popup" v-if="modelValue">
      <div class="background" @click="close"></div>
      <div class="content" :style="{ width: size + 'vh', height: size + 'vh' }">
        <div class="title" v-if="title">{{ title }}</div>
        <slot></slot>
        <a class="close" @click="close" v-if="closeButton">&times;</a>
      </div>
    </div>
  </Transition>
</template>
<style>
  .fade-fancy-popup-enter-active, .fade-fancy-popup-leave-active { transition: opacity 0.1s ease; }
  .fade-fancy-popup-enter-from, .fade-fancy-popup-leave-to { opacity: 0; }
</style>
