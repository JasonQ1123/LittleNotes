<script setup lang="ts">
withDefaults(defineProps<{ text?: string }>(), { text: '正在加载…' });
</script>
<template>
  <div class="loading-state" role="status"><span class="spinner"></span>{{ text }}</div>
</template>
