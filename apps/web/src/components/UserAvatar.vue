<script setup lang="ts">
import { ref, watch } from 'vue';
const props = withDefaults(
  defineProps<{
    user?: { nickname: string; avatarUrl?: string | null } | null;
    fallback?: string;
  }>(),
  { fallback: '我' },
);
const failed = ref(false);
watch(
  () => props.user?.avatarUrl,
  () => {
    failed.value = false;
  },
);
</script>
<template>
  <span class="avatar" aria-hidden="true">
    <img
      v-if="user?.avatarUrl && !failed"
      :src="user.avatarUrl"
      alt=""
      draggable="false"
      @error="failed = true"
    />
    <template v-else>{{ Array.from(user?.nickname || '')[0] || fallback }}</template>
  </span>
</template>
