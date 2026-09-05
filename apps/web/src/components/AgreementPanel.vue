<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api, useTask } from '../api';
import { useSession } from '../store';
import { dateLabel, inputDate, type Agreement, type Note } from '../types';
import AppIcon from './AppIcon.vue';
import EmptyState from './EmptyState.vue';
const props = defineProps<{ note: Note }>();
const emit = defineEmits<{ updated: [note: Note] }>();
const session = useSession();
const { busy, run } = useTask();
const pending = computed(() => props.note.agreements.find((a) => a.status === 'pending'));
const active = computed(() => props.note.agreements.find((a) => a.status === 'active'));
const history = computed(() => props.note.agreements.filter((a) => a.status === 'superseded'));
const editing = ref(false);
const form = reactive({
  baseVersion: 0,
  understanding: '',
  criteria: '',
  dueAt: '',
  actions: [{ text: '', assigneeId: 'both' }],
});
function start() {
  const source = pending.value || active.value;
  Object.assign(form, {
    baseVersion: props.note.agreements[0]?.version || 0,
    understanding: source?.understanding || '',
    criteria: source?.criteria || '',
    dueAt: source?.requestedDueAt ? inputDate(source.requestedDueAt) : '',
    actions: source ? source.actions.map((a) => ({ ...a })) : [{ text: '', assigneeId: 'both' }],
  });
  editing.value = true;
}
function person(id: string) {
  return id === 'both'
    ? '我们一起'
    : props.note.space.members.find((m) => m.id === id)?.nickname || '空间成员';
}
async function submit() {
  const note = await run(
    () =>
      api<Note>(`/records/${props.note.id}/agreements`, {
        method: 'POST',
        body: { ...form, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined },
      }),
    '方案已提出，等双方确认后就成为共同约定',
  );
  if (note) {
    editing.value = false;
    emit('updated', note);
  }
}
async function confirm(agreement: Agreement) {
  const note = await run(
    () => api<Note>(`/agreements/${agreement.id}/confirm`, { method: 'POST' }),
    '已记下你的确认',
  );
  if (note) emit('updated', note);
}
</script>
<template>
  <div v-if="note.status === 'draft'" class="panel">
    <EmptyState
      icon="agreement"
      title="分享之后，一起商量办法"
      description="先把这张纸条发布到共同空间，再邀请对方一起提出解决方案。"
    />
  </div>
  <template v-else>
    <div class="section-heading">
      <div>
        <h2>让理解，变成具体的小行动</h2>
        <p class="section-description">双方确认同一份方案，才成为正式的共同约定。</p>
      </div>
      <button
        v-if="!editing && note.status !== 'archived' && (pending || active)"
        class="btn secondary small"
        @click="start"
      >
        <AppIcon name="edit" :size="16" />调整解决方案
      </button>
    </div>
    <form v-if="editing" class="panel content-panel" @submit.prevent="submit">
      <div class="section-heading">
        <h2>一起商量一个办法</h2>
        <span class="badge review">新版本 V{{ form.baseVersion + 1 }}</span>
      </div>
      <div v-if="active" class="notice">
        新版本经双方确认后生效；确认前，你们现在的约定继续保留。
      </div>
      <label class="field"
        >我们对问题的共同理解<textarea
          v-model="form.understanding"
          rows="3"
          required
          maxlength="5000"
          placeholder="我们发现，真正让彼此难受的是…"
        ></textarea>
      </label>
      <div class="field">
        <span>下次，我们具体怎样做</span>
        <div v-for="(action, index) in form.actions" :key="index" class="action-editor">
          <span class="action-number">{{ index + 1 }}</span
          ><label class="grow"
            ><span class="sr-only">行动 {{ index + 1 }}</span
            ><input
              v-model="action.text"
              required
              maxlength="1000"
              placeholder="例如：计划变化时，及时告诉对方并一起确认替代方案" /></label
          ><label
            ><span class="sr-only">行动 {{ index + 1 }} 的负责人</span
            ><select v-model="action.assigneeId">
              <option value="both">我们一起</option>
              <option v-for="member in note.space.members" :key="member.id" :value="member.id">
                {{ member.nickname }}
              </option>
            </select></label
          ><button
            v-if="form.actions.length > 1"
            type="button"
            class="icon-button"
            :aria-label="`移除行动 ${index + 1}`"
            @click="form.actions.splice(index, 1)"
          >
            <AppIcon name="close" :size="17" />
          </button>
        </div>
        <button
          v-if="form.actions.length < 12"
          type="button"
          class="text-button"
          @click="form.actions.push({ text: '', assigneeId: 'both' })"
        >
          <AppIcon name="plus" :size="16" />再添一个小行动
        </button>
      </div>
      <label class="field"
        >怎样判断这个办法有用<textarea
          v-model="form.criteria"
          required
          rows="2"
          maxlength="3000"
          placeholder="例如：改变计划前有提前沟通，双方都清楚接下来的安排。"
        ></textarea></label
      ><label class="field"
        >什么时候回头看看 <span class="field-optional">选填</span
        ><input v-model="form.dueAt" type="datetime-local" /><small
          >留空时，安排在双方确认生效的 7 天后。</small
        ></label
      >
      <div class="actions end">
        <button type="button" class="btn secondary" :disabled="busy" @click="editing = false">
          暂不调整</button
        ><button class="btn primary" :disabled="busy">
          {{ busy ? '正在保存…' : '提出这份方案' }}<AppIcon name="arrow" :size="17" />
        </button>
      </div>
    </form>
    <section v-if="pending && !editing" class="panel agreement-sheet pending-sheet">
      <div class="section-heading">
        <span class="eyebrow">等待两个人的点头</span
        ><span class="badge review">V{{ pending.version }} · 待确认</span>
      </div>
      <h3>{{ pending.understanding }}</h3>
      <div v-for="(action, index) in pending.actions" :key="index" class="agreed-action">
        <span class="action-number">{{ index + 1 }}</span>
        <p>{{ action.text }}</p>
        <span class="assignee">{{ person(action.assigneeId) }}</span>
      </div>
      <div class="criteria">
        <span>我们这样判断改善</span>
        <p>{{ pending.criteria }}</p>
      </div>
      <div class="agreement-bottom">
        <div class="member-confirmations">
          <span
            v-for="member in note.space.members"
            :key="member.id"
            :class="{ confirmed: pending.confirmations.some((c) => c.userId === member.id) }"
            ><AppIcon
              :name="
                pending.confirmations.some((c) => c.userId === member.id) ? 'complete' : 'circle'
              "
              :size="16"
            />{{ member.nickname
            }}{{
              pending.confirmations.some((c) => c.userId === member.id) ? '已确认' : '待确认'
            }}</span
          >
        </div>
        <button
          v-if="note.status !== 'archived'"
          class="btn primary"
          :disabled="
            busy ||
            pending.confirmations.some((c) => c.userId === session.user?.id) ||
            note.space.members.length < 2
          "
          @click="confirm(pending)"
        >
          {{
            pending.confirmations.some((c) => c.userId === session.user?.id)
              ? '你已确认，等对方点头'
              : '确认这份约定'
          }}<AppIcon name="check" :size="17" />
        </button>
      </div>
      <p v-if="note.space.members.length < 2" class="form-hint">邀请对方加入后，才能共同确认。</p>
      <p v-if="pending.requestedDueAt" class="form-hint">
        约定生效后，在 {{ dateLabel(pending.requestedDueAt, true) }} 回头看看。
      </p>
    </section>
    <section v-if="active && !editing" class="panel agreement-sheet active-sheet">
      <div class="section-heading">
        <span class="eyebrow"
          ><AppIcon name="checks" :size="18" />{{
            note.status === 'archived' ? '留在这里的共同约定' : '我们正在努力的事'
          }}</span
        ><span class="badge followup">V{{ active.version }} · 已生效</span>
      </div>
      <h3>{{ active.understanding }}</h3>
      <div v-for="(action, index) in active.actions" :key="index" class="agreed-action">
        <span class="action-number"><AppIcon name="check" :size="15" /></span>
        <p>{{ action.text }}</p>
        <span class="assignee">{{ person(action.assigneeId) }}</span>
      </div>
      <div class="criteria">
        <span>我们这样判断改善</span>
        <p>{{ active.criteria }}</p>
      </div>
      <div class="agreement-bottom">
        <span class="muted inline-icon"
          ><AppIcon name="calendar" :size="16" />{{
            active.activatedAt ? dateLabel(active.activatedAt) : ''
          }}，我们一起确认</span
        ><RouterLink :to="`/records/${note.id}?tab=reviews`" class="text-button"
          >去回访<AppIcon name="arrow" :size="16"
        /></RouterLink>
      </div>
    </section>
    <div v-if="!pending && !active && !editing" class="panel">
      <EmptyState
        icon="agreement"
        title="一个小行动，可以成为新的开始"
        description="试着把“以后多在意我”，变成彼此都能做到、也能观察到的具体行动。"
        ><button v-if="note.status !== 'archived'" class="btn primary" @click="start">
          <AppIcon name="plus" :size="17" />一起商量一个办法
        </button></EmptyState
      >
    </div>
    <section v-if="history.length && !editing" class="section-block">
      <h2 class="small-heading">之前一起商量过的办法</h2>
      <details v-for="agreement in history" :key="agreement.id" class="history-item">
        <summary>
          <span
            >V{{ agreement.version }} ·
            {{ agreement.activatedAt ? '曾经生效' : '已被新方案替代' }}</span
          ><span class="muted">{{ dateLabel(agreement.createdAt) }}</span>
        </summary>
        <div class="history-content">
          <p class="preserve">{{ agreement.understanding }}</p>
          <div v-for="(action, index) in agreement.actions" :key="index" class="agreed-action">
            <span class="action-number">{{ index + 1 }}</span>
            <p>{{ action.text }}</p>
            <span class="assignee">{{ person(action.assigneeId) }}</span>
          </div>
          <p class="muted preserve">判断方式：{{ agreement.criteria }}</p>
        </div>
      </details>
    </section>
  </template>
</template>
