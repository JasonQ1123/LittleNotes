<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { useSession } from '../store';
import { categories, statusLabels, type NoteList } from '../types';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import RecordCard from '../components/RecordCard.vue';
const session = useSession();
const data = ref<NoteList>();
const error = ref('');
const loading = ref(true);
const filters = reactive({ q: '', category: '', status: '', tag: '', page: 1 });
let request = 0;
async function load(reset = false) {
  if (reset) filters.page = 1;
  const current = ++request;
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
    const result = await api<NoteList>(`/records?${params}`);
    if (current === request) data.value = result;
  } catch (e) {
    if (current === request) error.value = (e as Error).message;
  } finally {
    if (current === request) loading.value = false;
  }
}
function reset() {
  Object.assign(filters, { q: '', category: '', status: '', tag: '', page: 1 });
  load();
}
onMounted(() => load());
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">OUR NOTES</span>
      <h1>我们的纸条</h1>
      <p>记住问题，也记住我们为彼此做过的努力。</p>
    </div>
    <RouterLink :to="session.space ? '/records/new' : '/space'" class="btn primary"
      ><AppIcon name="plus" :size="18" />写一张纸条</RouterLink
    >
  </div>
  <form class="filter-panel panel" @submit.prevent="load(true)">
    <div class="filter-row">
      <label class="search-field"
        ><AppIcon name="search" :size="18" /><input
          v-model="filters.q"
          aria-label="搜索纸条"
          placeholder="搜索标题或事件经过…"
          maxlength="100" /></label
      ><button class="btn secondary">查找</button>
    </div>
    <div class="filter-row secondary-row">
      <label class="sr-label"
        >分类<select v-model="filters.category" aria-label="按分类筛选" @change="load(true)">
          <option value="">全部分类</option>
          <option v-for="category in categories" :key="category">{{ category }}</option>
        </select></label
      ><label class="sr-label"
        >状态<select v-model="filters.status" aria-label="按状态筛选" @change="load(true)">
          <option value="">全部状态</option>
          <option v-for="(label, value) in statusLabels" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      ><input
        v-model="filters.tag"
        class="tag-filter"
        aria-label="按标签筛选"
        placeholder="标签"
        maxlength="30"
      />
    </div>
  </form>
  <div class="list-summary">
    <span>{{ data?.total || 0 }} 张纸条，每一张都值得被认真对待</span
    ><button
      v-if="filters.q || filters.category || filters.status || filters.tag"
      class="text-button"
      @click="reset"
    >
      清除筛选
    </button>
  </div>
  <div v-if="error" class="notice error-notice" role="alert">
    {{ error }}<button class="text-button" @click="load()">重新加载</button>
  </div>
  <div v-else-if="loading" class="loading-state" role="status">
    <span class="spinner"></span>正在找出这些小纸条…
  </div>
  <div v-else-if="data?.items.length" class="record-grid">
    <RecordCard v-for="note in data.items" :key="note.id" :note="note" />
  </div>
  <div v-else class="panel">
    <EmptyState
      :icon="filters.q || filters.category || filters.status || filters.tag ? 'search' : 'note'"
      :title="
        filters.q || filters.category || filters.status || filters.tag
          ? '没有找到符合条件的纸条'
          : '先把心事放在这里'
      "
      description="可以只写一个标题。先留住这一刻，再慢慢整理。"
      ><RouterLink :to="session.space ? '/records/new' : '/space'" class="btn secondary">{{
        session.space ? '写下第一张纸条' : '创建共同空间'
      }}</RouterLink></EmptyState
    >
  </div>
  <div v-if="data && data.total > data.pageSize" class="pagination">
    <button
      class="btn secondary small"
      :disabled="filters.page <= 1 || loading"
      @click="
        filters.page--;
        load();
      "
    >
      <AppIcon name="left" :size="16" />上一页</button
    ><span>{{ filters.page }} / {{ Math.ceil(data.total / data.pageSize) }}</span
    ><button
      class="btn secondary small"
      :disabled="filters.page * data.pageSize >= data.total || loading"
      @click="
        filters.page++;
        load();
      "
    >
      下一页<AppIcon name="right" :size="16" />
    </button>
  </div>
</template>
