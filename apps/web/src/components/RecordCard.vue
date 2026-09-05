<script setup lang="ts">
import { dateLabel, statusLabels, type Note } from '../types';
import AppIcon from './AppIcon.vue';
defineProps<{ note: Note }>();
</script>
<template>
  <RouterLink :to="`/records/${note.id}`" class="record-card">
    <div class="record-card-top">
      <span class="category"><AppIcon name="note" :size="15" />{{ note.category }}</span
      ><span :class="['badge', note.status]">{{ statusLabels[note.status] }}</span>
    </div>
    <h3>{{ note.title }}</h3>
    <p class="record-excerpt">{{ note.description || '有些话，慢慢写也没关系。' }}</p>
    <div class="record-card-bottom">
      <span><AppIcon name="calendar" :size="14" />{{ dateLabel(note.occurredAt) }}</span
      ><span v-if="note.reconciled" class="sage"><AppIcon name="heart" :size="14" />已经和好</span
      ><span v-else-if="note.related.length"
        ><AppIcon name="link" :size="14" />关联 {{ note.related.length }} 张纸条</span
      ><AppIcon name="arrowUp" :size="18" class="card-arrow" />
    </div>
  </RouterLink>
</template>
