<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import RecordCard from '../components/RecordCard.vue';
import { api } from '../api';
import { useSession } from '../store';
import type { Dashboard } from '../types';
const session = useSession();
const data = ref<Dashboard>();
const error = ref('');
const loading = ref(true);
const filter = ref('all');
const greeting =
  new Date().getHours() < 11
    ? '早上好'
    : new Date().getHours() < 14
      ? '中午好'
      : new Date().getHours() < 19
        ? '下午好'
        : '晚上好';
const filteredTodos = computed(
  () =>
    data.value?.todos.filter(
      (t) =>
        filter.value === 'all' ||
        (filter.value === 'write'
          ? ['draft', 'perspective'].includes(t.kind)
          : t.kind === filter.value),
    ) || [],
);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api<Dashboard>('/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="page-heading home-heading">
    <div>
      <h1>{{ greeting }}，{{ session.user?.nickname }}。</h1>
      <p>每一次愿意靠近，都是关系里的一点光。</p>
    </div>
    <RouterLink :to="session.space ? '/records/new' : '/space'" class="btn primary"
      ><AppIcon name="plus" :size="18" />写一张纸条</RouterLink
    >
  </div>
  <section class="home-hero">
    <div class="hero-copy">
      <span class="hero-kicker"><AppIcon name="heart" :size="16" />给我们，好好相处的日常</span>
      <h2>和好以后，<br />也记得一起向前。</h2>
      <p>把没说完的话写下来，<br />把商量好的事，慢慢做到。</p>
      <RouterLink v-if="!session.space" to="/space" class="btn hero-button"
        >建立我们的空间<AppIcon name="arrow" :size="17"
      /></RouterLink>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="art-orbit orbit-one"></div>
      <div class="hero-paper back-paper"></div>
      <div class="hero-paper front-paper">
        <span class="paper-tape"></span><span class="handwritten">给亲爱的我们</span>
        <div class="paper-rule"></div>
        <p>认真听，好好说。<br />有分歧，也有拥抱。</p>
        <AppIcon name="heart" :size="28" class="paper-heart" />
      </div>
      <div class="floating-flower"><AppIcon name="flower" :size="28" /></div>
    </div>
  </section>
  <div v-if="error" class="notice error-notice" role="alert">
    {{ error }}<button class="text-button" @click="load">重新加载</button>
  </div>
  <div v-if="loading" class="loading-state" role="status">
    <span class="spinner"></span>正在翻开我们的小纸条…
  </div>
  <template v-else-if="data">
    <section class="home-overview" aria-label="空间概览">
      <span
        ><AppIcon name="note" :size="16" />一起写下
        <strong>{{ data.counts.records }}</strong> 张纸条</span
      >
      <span
        ><AppIcon name="agreement" :size="16" />正在努力的
        <strong>{{ data.counts.activeAgreements }}</strong> 份约定</span
      >
      <span
        ><AppIcon name="clock" :size="16" /><strong>{{ data.counts.dueReviews }}</strong>
        件待回访</span
      >
    </section>
    <div v-if="session.space && session.space.members.length < 2" class="pair-banner">
      <AppIcon name="users" />
      <div>
        <strong>给这个小天地，再添一个人。</strong>
        <p>邀请对方加入，开始属于你们的共同复盘。</p>
      </div>
      <RouterLink to="/space" class="text-button"
        >发送邀请<AppIcon name="arrow" :size="16"
      /></RouterLink>
    </div>
    <section class="section-block">
      <div class="section-heading">
        <h2>
          留一点时间，给我们 <span class="count-pill">{{ data.todos.length }}</span>
        </h2>
        <div class="segmented compact">
          <button
            v-for="tab in [
              { id: 'all', label: '全部' },
              { id: 'confirm', label: '待确认' },
              { id: 'review', label: '待回访' },
              { id: 'write', label: '待补充' },
            ]"
            :key="tab.id"
            :class="{ selected: filter === tab.id }"
            @click="filter = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      <div class="panel todo-panel">
        <template v-if="filteredTodos.length"
          ><RouterLink
            v-for="(todo, index) in filteredTodos"
            :key="`${todo.recordId}-${todo.kind}`"
            :to="`/records/${todo.recordId}?tab=${todo.kind === 'review' ? 'reviews' : todo.kind === 'confirm' ? 'agreements' : todo.kind === 'perspective' ? 'perspectives' : 'story'}`"
            class="todo-row"
            ><span
              :class="[
                'todo-icon',
                todo.kind === 'review'
                  ? 'yellow-bg'
                  : todo.kind === 'confirm'
                    ? 'peach-bg'
                    : 'sage-bg',
              ]"
              ><AppIcon
                :name="
                  todo.kind === 'review' ? 'clock' : todo.kind === 'confirm' ? 'agreement' : 'note'
                "
                :size="20"
            /></span>
            <div>
              <span class="todo-label">{{ todo.label }}</span>
              <h3>{{ todo.title }}</h3>
            </div>
            <span v-if="todo.kind === 'review'" class="badge due">待回访</span
            ><AppIcon name="right" :size="18" /><span class="sr-only"
              >第 {{ index + 1 }} 项</span
            ></RouterLink
          ></template
        ><EmptyState
          v-else
          icon="leaf"
          :title="filter === 'all' ? '今天没有待办，给彼此一个拥抱吧' : '这里暂时没有待办'"
          description="新的约定和到期回访，会在这里轻轻提醒你。"
        />
      </div>
    </section>
    <section class="section-block">
      <div class="section-heading">
        <h2>最近的小纸条</h2>
        <RouterLink to="/records" class="text-button"
          >翻看全部<AppIcon name="arrow" :size="16"
        /></RouterLink>
      </div>
      <div v-if="data.recent.length" class="record-grid">
        <RecordCard v-for="note in data.recent" :key="note.id" :note="note" />
      </div>
      <div v-else class="panel">
        <EmptyState
          title="故事的第一页，等你落笔"
          description="只要一个标题，就能先记住这一刻。其他的话，可以慢慢补充。"
          ><RouterLink :to="session.space ? '/records/new' : '/space'" class="btn secondary"
            ><AppIcon name="plus" :size="17" />{{
              session.space ? '写下第一张纸条' : '创建共同空间'
            }}</RouterLink
          ></EmptyState
        >
      </div>
    </section>
  </template>
</template>
