<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { dateLabel, type Note } from '../types';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
const notes = ref<Note[]>([]);
const loading = ref(true);
const error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    notes.value = await api<Note[]>('/agreements');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function person(note: Note, id: string) {
  return id === 'both'
    ? '我们一起'
    : note.space.members.find((m) => m.id === id)?.nickname || '空间成员';
}
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">LITTLE PROMISES</span>
      <h1>共同约定</h1>
      <p>把“下次会注意”，变成我们正在做的事。</p>
    </div>
    <span class="heading-icon"><AppIcon name="agreement" :size="32" /></span>
  </div>
  <div class="notice">
    <AppIcon
      name="checks"
      :size="20"
    />这里收好双方确认过、仍在跟进的约定。过去的版本和归档约定，可以在对应纸条中查看。
  </div>
  <LoadingState v-if="loading" text="正在整理我们的约定…" />
  <ErrorState v-else-if="error" :message="error" @retry="load" />
  <div v-else-if="notes.length" class="agreement-list">
    <article v-for="note in notes" :key="note.id" class="panel agreement-sheet">
      <template
        v-for="agreement in note.agreements.filter((a) => a.status === 'active')"
        :key="agreement.id"
        ><div class="section-heading">
          <span class="category">{{ note.category }}</span
          ><span class="badge followup">V{{ agreement.version }} · 已生效</span>
        </div>
        <RouterLink :to="`/records/${note.id}?tab=agreements`" class="agreement-title"
          >{{ note.title }}<AppIcon name="arrowUp" :size="19"
        /></RouterLink>
        <p class="agreement-understanding">{{ agreement.understanding }}</p>
        <div v-for="(action, index) in agreement.actions" :key="index" class="agreed-action">
          <span class="action-number"><AppIcon name="check" :size="15" /></span>
          <p>{{ action.text }}</p>
          <span class="assignee">{{ person(note, action.assigneeId) }}</span>
        </div>
        <div class="agreement-bottom">
          <span v-if="agreement.cycles[0]" class="muted inline-icon"
            ><AppIcon name="calendar" :size="16" />{{ dateLabel(agreement.cycles[0].dueAt) }}回访 ·
            {{ agreement.cycles[0].reviews.length }}/2 人已记录</span
          ><RouterLink :to="`/records/${note.id}?tab=reviews`" class="text-button"
            >回头看看<AppIcon name="arrow" :size="16"
          /></RouterLink></div
      ></template>
    </article>
  </div>
  <div v-else class="panel">
    <EmptyState
      icon="agreement"
      title="好的改变，从一个小约定开始"
      description="在纸条中提出解决方案，等你们都点头后，就会出现在这里。"
      ><RouterLink to="/records" class="btn secondary"
        >去翻翻小纸条<AppIcon name="arrow" :size="17" /></RouterLink
    ></EmptyState>
  </div>
</template>
