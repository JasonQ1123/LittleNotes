<script setup lang="ts">
import { reactive } from 'vue';
import { useRouter } from 'vue-router';
import { api, useTask } from '../api';
import { useSession } from '../store';
import { categories, inputDate, type Note } from '../types';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
const session = useSession();
const router = useRouter();
const { busy, run } = useTask();
const form = reactive({
  title: '',
  description: '',
  category: '其他',
  occurredAt: inputDate(),
  tags: '',
});
async function save() {
  const result = await run(
    () =>
      api<Note>('/records', {
        method: 'POST',
        body: {
          ...form,
          occurredAt: new Date(form.occurredAt).toISOString(),
          tags: [
            ...new Set(
              form.tags
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ],
        },
      }),
    '草稿已保存，现在只有你能看到',
  );
  if (result) router.replace(`/records/${result.id}`);
}
</script>
<template>
  <RouterLink to="/records" class="back-link"
    ><AppIcon name="left" :size="17" />回到所有纸条</RouterLink
  >
  <div class="page-heading">
    <div>
      <span class="eyebrow">A LITTLE NOTE</span>
      <h1>先把这一刻，写下来</h1>
      <p>不必一次说清楚。先起一个标题，其他的话慢慢补充。</p>
    </div>
  </div>
  <form v-if="session.space" class="panel writing-form" @submit.prevent="save">
    <div class="notice">
      <AppIcon name="lock" :size="18" />这是一张私密草稿，由你决定什么时候分享给对方。
    </div>
    <label class="field large-label"
      >给这张纸条起个标题 <span class="required">*</span
      ><input
        v-model="form.title"
        required
        maxlength="100"
        placeholder="比如：关于临时改变的周末计划"
        autofocus
    /></label>
    <div class="form-grid">
      <label class="field"
        >发生时间<input v-model="form.occurredAt" type="datetime-local" required /></label
      ><label class="field"
        >属于哪一类<select v-model="form.category">
          <option v-for="category in categories" :key="category">{{ category }}</option>
        </select></label
      >
    </div>
    <label class="field"
      >发生了什么 <span class="field-optional">选填</span
      ><textarea
        v-model="form.description"
        rows="6"
        maxlength="10000"
        placeholder="当时在哪里，发生了什么？先写下事情经过，感受和原因可以在后面慢慢梳理。"
      ></textarea></label
    ><label class="field"
      >小标签 <span class="field-optional">选填</span
      ><input
        v-model="form.tags"
        maxlength="310"
        placeholder="例如：周末、临时变动，用逗号分隔"
      /><small>最多 10 个标签，每个不超过 30 个字。</small></label
    >
    <div class="form-footer">
      <span><AppIcon name="leaf" :size="17" />愿意记录，就是迈出的一小步。</span
      ><button class="btn primary" :disabled="busy">
        <AppIcon name="check" :size="18" />{{ busy ? '正在保存…' : '保存私密草稿' }}
      </button>
    </div>
  </form>
  <div v-else class="panel">
    <EmptyState
      icon="users"
      title="先给我们一个小天地"
      description="建立共同空间后，就可以开始记录私密草稿。"
      ><RouterLink to="/space" class="btn primary">创建共同空间</RouterLink></EmptyState
    >
  </div>
</template>
