<script setup lang="ts">
import AppIcon from './AppIcon.vue';
withDefaults(
  defineProps<{
    title?: string;
    message: string;
    retryLabel?: string;
  }>(),
  { title: '暂时没能加载出来', retryLabel: '重新加载' },
);
defineEmits<{ retry: [] }>();
</script>
<template>
  <div class="panel error-panel" role="alert">
    <AppIcon name="help" :size="28" />
    <h2>{{ title }}</h2>
    <p>{{ message }}</p>
    <button class="btn secondary" @click="$emit('retry')">{{ retryLabel }}</button>
  </div>
</template>
