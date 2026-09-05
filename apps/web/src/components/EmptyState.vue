<script setup lang="ts">
import AppIcon from './AppIcon.vue';
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    icon?: 'note' | 'agreement' | 'leaf' | 'chart' | 'users' | 'search';
  }>(),
  { icon: 'note' },
);
</script>
<template>
  <div class="empty-state">
    <div class="empty-icon"><AppIcon :name="icon" :size="30" /></div>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <slot />
  </div>
</template>
