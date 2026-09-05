<script setup lang="ts">
import EmptyState from '../components/EmptyState.vue';
</script>
<template>
  <section class="panel">
    <EmptyState title="这张纸条，好像走丢了" description="这个页面不存在，可以回到首页继续翻看。"
      ><RouterLink to="/" class="btn primary">回到首页</RouterLink></EmptyState
    >
  </section>
</template>
