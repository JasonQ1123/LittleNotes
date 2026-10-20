<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, useTask } from '../api';
import { useSession } from '../store';
import { categories, dateLabel, inputDate, statusLabels, type Note, type NoteList } from '../types';
import AppIcon from '../components/AppIcon.vue';
import UserAvatar from '../components/UserAvatar.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import PerspectivePanel from '../components/PerspectivePanel.vue';
import AgreementPanel from '../components/AgreementPanel.vue';
import ReviewPanel from '../components/ReviewPanel.vue';
const route = useRoute();
const router = useRouter();
const session = useSession();
const { busy, run } = useTask();
const note = ref<Note>();
const error = ref('');
const loading = ref(true);
const editing = ref(false);
const dialog = ref<'publish' | 'delete' | null>(null);
const tab = ref('story');
const tabs = [
  { id: 'story', label: '事情经过', icon: 'note' },
  { id: 'perspectives', label: '彼此的感受', icon: 'heart' },
  { id: 'agreements', label: '共同约定', icon: 'agreement' },
  { id: 'reviews', label: '回头看看', icon: 'leaf' },
] as const;
const isAuthor = computed(() => note.value?.authorId === session.user?.id);
const myReconciled = computed(() =>
  note.value?.reconciliations.some((r) => r.userId === session.user?.id && r.value),
);
const myArchiveVote = computed(() =>
  note.value?.archiveVotes.some((v) => v.userId === session.user?.id),
);
const myPerspective = computed(() =>
  note.value?.perspectives.find((p) => p.userId === session.user?.id),
);
/** One visible next action per page; read-only states return null. */
const nextStep = computed(() => {
  const n = note.value;
  if (!n || n.status === 'draft' || n.status === 'archived') return null;
  if (!myPerspective.value?.publishedAt)
    return { label: '补充你的视角', hint: '对方已经写完了，还差你的这一份。', tab: 'perspectives' };
  if (n.agreements.some((a) => a.status === 'pending'))
    return { label: '去确认这份约定', hint: '有一条约定在等两个人确认。', tab: 'agreements' };
  const cycle = n.agreements.find((a) => a.status === 'active')?.cycles[0];
  if (
    cycle &&
    new Date(cycle.dueAt) <= new Date() &&
    !cycle.reviews.some((r) => r.userId === session.user?.id)
  )
    return { label: '填写这次回访', hint: '约好的回访到期了，看看有没有变化。', tab: 'reviews' };
  // 结束跟进不再进行动条：它是收尾动作，交给页尾的轻量按钮，避免同屏两个同义入口。
  return null;
});
const story = reactive({
  title: '',
  description: '',
  category: '其他',
  tags: '',
  occurredAt: '',
  revision: 1,
});
const relatedSearch = ref('');
const candidates = ref<Note[]>([]);
const searched = ref(false);
watch(
  () => route.query.tab,
  (value) => {
    tab.value = tabs.some((t) => t.id === value) ? String(value) : 'story';
  },
  { immediate: true },
);
function setTab(value: string) {
  router.replace({ query: { ...route.query, tab: value } });
}
/** Roving tabindex: ←/→ 循环切换，Home/End 跳到首尾，焦点跟随选中项。 */
function onTabKey(event: KeyboardEvent, index: number) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  setTab(tabs[next].id);
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll('button');
  buttons?.[next]?.focus();
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    note.value = await api<Note>(`/records/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function update(value: Note) {
  note.value = value;
}
function edit() {
  if (!note.value) return;
  const n = note.value;
  Object.assign(story, {
    title: n.title,
    description: n.description,
    category: n.category,
    tags: n.tags.join('，'),
    occurredAt: inputDate(n.occurredAt),
    revision: n.revision,
  });
  editing.value = true;
}
async function save() {
  const result = await run(
    () =>
      api<Note>(`/records/${note.value!.id}`, {
        method: 'PATCH',
        body: {
          ...story,
          tags: [
            ...new Set(
              story.tags
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ],
          occurredAt: new Date(story.occurredAt).toISOString(),
        },
      }),
    '事件概况已保存',
  );
  if (result) {
    note.value = result;
    editing.value = false;
  }
}
async function confirmDialog() {
  const action = dialog.value;
  await run(
    async () => {
      if (action === 'delete') {
        await api(`/records/${note.value!.id}`, { method: 'DELETE' });
        await router.replace('/records');
      } else {
        note.value = await api<Note>(`/records/${note.value!.id}/publish`, { method: 'POST' });
      }
      dialog.value = null;
    },
    action === 'delete' ? '私密草稿已删除' : '纸条已分享到共同空间',
  );
}
async function reconcile() {
  const result = await run(
    () =>
      api<Note>(`/records/${note.value!.id}/reconcile`, {
        method: 'POST',
        body: { value: !myReconciled.value },
      }),
    '已更新你的和好标记，后续回访仍会保留',
  );
  if (result) note.value = result;
}
async function archive() {
  const result = await run(
    () => api<Note>(`/records/${note.value!.id}/archive`, { method: 'POST' }),
    '已记下你的归档确认，双方同意后会结束跟进',
  );
  if (result) note.value = result;
}
async function searchRelated() {
  await run(async () => {
    const result = await api<NoteList>(`/records?q=${encodeURIComponent(relatedSearch.value)}`);
    candidates.value = result.items.filter(
      (r) =>
        r.status !== 'draft' &&
        r.id !== note.value?.id &&
        !note.value?.related.some((l) => l.id === r.id),
    );
    searched.value = true;
  });
}
async function link(id: string) {
  const result = await run(
    () =>
      api<Note>(`/records/${note.value!.id}/links`, { method: 'POST', body: { relatedId: id } }),
    '已把两张纸条关联起来',
  );
  if (result) {
    note.value = result;
    candidates.value = candidates.value.filter((c) => c.id !== id);
  }
}
onMounted(load);
</script>
<template>
  <RouterLink to="/records" class="back-link"
    ><AppIcon name="left" :size="17" />回到所有纸条</RouterLink
  >
  <LoadingState v-if="loading" text="正在展开这张纸条…" />
  <ErrorState v-else-if="error" title="暂时无法打开这张纸条" :message="error" @retry="load" />
  <template v-else-if="note">
    <div class="detail-heading">
      <div class="detail-badges">
        <span :class="['badge', note.status]"
          ><AppIcon v-if="note.status === 'draft'" name="lock" :size="13" />{{
            statusLabels[note.status]
          }}</span
        ><span class="category">{{ note.category }}</span
        ><span v-if="note.reconciled" class="badge followup"
          ><AppIcon name="heart" :size="13" />已经和好</span
        >
      </div>
      <h1>{{ note.title }}</h1>
      <div class="detail-meta">
        <span><AppIcon name="calendar" :size="15" />{{ dateLabel(note.occurredAt, true) }}</span
        ><span
          >{{ note.space.members.find((m) => m.id === note!.authorId)?.nickname }}写下的纸条</span
        ><button class="text-button muted" aria-label="刷新纸条" @click="load">
          <AppIcon name="refresh" :size="14" />刷新
        </button>
      </div>
      <div v-if="note.tags.length" class="tag-row">
        <span v-for="tag in note.tags" :key="tag"># {{ tag }}</span>
      </div>
    </div>
    <div v-if="note.status === 'draft'" class="draft-banner">
      <AppIcon name="lock" :size="23" />
      <div>
        <strong>这张纸条，现在只有你能看到。</strong>
        <p>准备好后，再把事件经过分享给对方。你的个人视角可以单独决定何时发布。</p>
      </div>
      <button class="btn primary small" :disabled="busy" @click="dialog = 'publish'">
        <AppIcon name="send" :size="16" />分享到共同空间
      </button>
    </div>
    <div v-else-if="note.status === 'archived'" class="notice">
      <AppIcon
        name="archive"
        :size="19"
      />你们已经一起结束了这次跟进。经过、约定和回访都保存在这里。
    </div>
    <div v-if="nextStep" class="detail-action">
      <div class="detail-action__label">
        <span>接下来的一步</span>
        <strong>{{ nextStep.hint }}</strong>
      </div>
      <button class="btn primary" @click="setTab(nextStep.tab)">
        {{ nextStep.label }}<AppIcon name="arrow" :size="17" />
      </button>
    </div>
    <div class="detail-tabs" role="tablist" aria-label="复盘内容">
      <button
        v-for="(item, index) in tabs"
        :key="item.id"
        role="tab"
        :aria-selected="tab === item.id"
        :aria-controls="`panel-${item.id}`"
        :tabindex="tab === item.id ? 0 : -1"
        :class="{ active: tab === item.id }"
        @click="setTab(item.id)"
        @keydown="onTabKey($event, index)"
      >
        <AppIcon :name="item.icon" :size="18" />{{ item.label
        }}<span
          v-if="item.id === 'agreements' && note.agreements.some((a) => a.status === 'pending')"
          class="tab-dot"
        ></span>
      </button>
    </div>
    <div :id="`panel-${tab}`" role="tabpanel" class="detail-content">
      <template v-if="tab === 'story'"
        ><div class="story-grid">
          <section class="panel content-panel">
            <div class="section-heading">
              <h2>当时，发生了什么</h2>
              <button
                v-if="isAuthor && note.status !== 'archived' && !editing"
                class="text-button"
                @click="edit"
              >
                <AppIcon name="edit" :size="16" />补充经过
              </button>
            </div>
            <form v-if="editing" @submit.prevent="save">
              <label class="field"
                >标题<input v-model="story.title" required maxlength="100"
              /></label>
              <div class="form-grid">
                <label class="field"
                  >发生时间<input
                    v-model="story.occurredAt"
                    type="datetime-local"
                    required /></label
                ><label class="field"
                  >分类<select v-model="story.category">
                    <option v-for="category in categories" :key="category">{{ category }}</option>
                  </select></label
                >
              </div>
              <label class="field"
                >事件经过<textarea
                  v-model="story.description"
                  rows="7"
                  maxlength="10000"
                ></textarea></label
              ><label class="field"
                >标签<input v-model="story.tags" maxlength="310" placeholder="用逗号分隔"
              /></label>
              <div class="actions end">
                <button type="button" class="btn secondary" @click="editing = false">取消</button
                ><button class="btn primary" :disabled="busy">保存概况</button>
              </div>
            </form>
            <template v-else
              ><p :class="['story-text', { muted: !note.description }]">
                {{ note.description || '这部分还留着空白。等想好怎么说，再回来补充。' }}
              </p>
              <div class="gentle-inline">
                <AppIcon name="leaf" :size="19" />
                <p>
                  同一件事，也许有不同的感受。<button
                    class="text-button"
                    @click="setTab('perspectives')"
                  >
                    去听听彼此的心声<AppIcon name="arrow" :size="15" />
                  </button>
                </p></div
            ></template>
            <div v-if="note.status === 'draft'" class="danger-zone">
              <button class="text-button danger-text" @click="dialog = 'delete'">
                <AppIcon name="trash" :size="15" />删除这张草稿
              </button>
            </div>
          </section>
          <aside class="detail-side">
            <section v-if="note.status !== 'draft'" class="panel content-panel">
              <h2>我们的当下</h2>
              <p class="section-description">和好了，也可以继续留意后来的改变。</p>
              <div class="member-status" v-for="member in note.space.members" :key="member.id">
                <UserAvatar :user="member" class="tiny" /><span>{{ member.nickname }}</span
                ><span
                  :class="[
                    'muted',
                    { sage: note.reconciliations.some((r) => r.userId === member.id && r.value) },
                  ]"
                  >{{
                    note.reconciliations.some((r) => r.userId === member.id && r.value)
                      ? '觉得已经和好'
                      : '还没有标记'
                  }}</span
                >
              </div>
              <button
                v-if="note.status !== 'archived'"
                class="btn secondary full small"
                :disabled="busy"
                @click="reconcile"
              >
                <AppIcon name="heart" :size="16" />{{
                  myReconciled ? '撤回我的和好标记' : '我觉得我们已经和好'
                }}
              </button>
            </section>
            <section class="gentle-card">
              <AppIcon name="book" :size="23" />
              <h3>这一次，可以慢慢来</h3>
              <p>先记住事情，再说说感受，最后商量一个下次能做到的小改变。</p>
            </section>
          </aside>
        </div>
        <section v-if="note.status !== 'draft'" class="panel content-panel section-block">
          <div class="section-heading">
            <div>
              <h2><AppIcon name="link" :size="19" />以前，是不是也遇到过</h2>
              <p class="section-description">关联旧纸条，看看上次的办法有没有被好好记住。</p>
            </div>
          </div>
          <RouterLink
            v-for="related in note.related"
            :key="related.id"
            :to="`/records/${related.id}`"
            class="related-row"
            ><AppIcon name="note" :size="19" /><span>{{ related.title }}</span
            ><small>{{ dateLabel(related.occurredAt) }}</small
            ><AppIcon name="arrowUp" :size="16"
          /></RouterLink>
          <p v-if="!note.related.length" class="muted">暂时没有关联的纸条。</p>
          <details v-if="note.status !== 'archived'" class="link-search">
            <summary>关联一张历史纸条</summary>
            <form class="actions" @submit.prevent="searchRelated">
              <input
                v-model="relatedSearch"
                aria-label="搜索历史纸条"
                placeholder="输入标题或经过关键词"
                maxlength="100"
              /><button class="btn secondary" :disabled="busy">查找纸条</button>
            </form>
            <div v-for="candidate in candidates" :key="candidate.id" class="related-row">
              <span>{{ candidate.title }}</span
              ><button class="text-button" :disabled="busy" @click="link(candidate.id)">
                关联<AppIcon name="plus" :size="15" />
              </button>
            </div>
            <p v-if="searched && !candidates.length" class="form-hint">
              没有找到可关联的共享纸条，试试其他关键词。
            </p>
          </details>
        </section>
        <section
          v-if="note.status !== 'draft' && note.status !== 'archived'"
          class="archive-section"
        >
          <div>
            <h3>准备好，把这一页轻轻翻过去了吗？</h3>
            <p>双方确认结束跟进后归档，记录和回访会一直保留。</p>
          </div>
          <button class="btn quiet small" :disabled="busy || myArchiveVote" @click="archive">
            <AppIcon name="archive" :size="16" />{{
              myArchiveVote ? '已确认，等对方同意' : '我同意结束跟进'
            }}
          </button>
        </section></template
      >
      <PerspectivePanel v-else-if="tab === 'perspectives'" :note="note" @updated="update" />
      <AgreementPanel v-else-if="tab === 'agreements'" :note="note" @updated="update" />
      <ReviewPanel v-else-if="tab === 'reviews'" :note="note" @updated="update" />
    </div>
  </template>
  <ConfirmDialog
    v-if="dialog"
    :title="dialog === 'publish' ? '把这张纸条分享给对方' : '删除这张私密草稿？'"
    :description="
      dialog === 'publish'
        ? '事件概况将进入你们的共同空间，对方可以补充自己的视角。你尚未发布的个人视角仍只对你可见。共享纸条可以共同归档，会保留在历史中。'
        : '草稿和其中尚未发布的想法都会被删除，这个操作无法撤回。'
    "
    :confirm-label="dialog === 'publish' ? '确认分享' : '删除草稿'"
    :danger="dialog === 'delete'"
    :busy="busy"
    @cancel="dialog = null"
    @confirm="confirmDialog"
  />
</template>
