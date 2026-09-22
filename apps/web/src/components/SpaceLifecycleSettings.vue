<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api, notify, useTask } from '../api';
import { useSession } from '../store';
import type { ClosedSpace, ClosedSpaceList } from '../types';
import SpaceActionDialog from './SpaceActionDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import UserAvatar from './UserAvatar.vue';
const session = useSession();
const { busy, run } = useTask();
const result = ref<ClosedSpaceList>();
const page = ref(1);
const error = ref('');
const now = ref(Date.now());
const clock = setInterval(() => {
  now.value = Date.now();
}, 1000);
let sequence = 0;
let disposed = false;
const cards = computed(
  () => result.value?.items.filter((space) => Date.parse(space.purgeAt) > now.value) || [],
);
const action = ref<{
  title: string;
  help: string;
  endpoint: string;
  lifecycleVersion?: number;
  danger?: boolean;
  confirmLabel?: string;
  purgeId?: string;
}>();
const deleteWarning = ref<ClosedSpace>();
const refreshButton = ref<HTMLButtonElement>();
let deleteTrigger: HTMLElement | undefined;
function startPurge(space: ClosedSpace, event: Event) {
  deleteTrigger = event.currentTarget as HTMLElement;
  deleteWarning.value = space;
}
async function confirmPurge() {
  const space = deleteWarning.value;
  if (!space) return;
  deleteWarning.value = undefined;
  // Close the first native modal before mounting the password confirmation.
  await nextTick();
  if (disposed) return;
  action.value = {
    title: '最后确认：删除后无法恢复',
    help: `即将永久删除「${space.name}」。所有记录（包括双方的私密草稿、视角、约定和回访）将立即删除，双方都无法恢复。恢复申请也会失效。请输入当前密码，确认结束这个空间的保留期。`,
    endpoint: '/spaces/' + space.id + '/purge',
    lifecycleVersion: space.lifecycleVersion,
    danger: true,
    confirmLabel: '永久删除',
    purgeId: space.id,
  };
}
async function returnDeleteFocus(toTrigger = true) {
  await nextTick();
  if (disposed) return;
  (toTrigger && deleteTrigger?.isConnected ? deleteTrigger : refreshButton.value)?.focus();
  deleteTrigger = undefined;
}
function cancelAction() {
  const deleting = !!deleteWarning.value || !!action.value?.purgeId;
  deleteWarning.value = undefined;
  action.value = undefined;
  if (deleting) void returnDeleteFocus();
}
function changed(message: string) {
  if (action.value?.purgeId) {
    action.value = undefined;
    notify(message, true);
    void returnDeleteFocus(false);
  }
  void load();
}
const timestamp = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
function pending(space: ClosedSpace) {
  return (
    space.restoreRequest?.status === 'pending' &&
    Date.parse(space.restoreRequest.expiresAt) > now.value
  );
}
function requestLabel(space: ClosedSpace) {
  const request = space.restoreRequest;
  if (!request) return '双方均没有当前空间时，可以申请恢复。';
  const labels: Record<string, string> = {
    accepted: '空间已恢复',
    rejected: '恢复申请已被拒绝',
    cancelled: '恢复申请已撤回',
    expired: '恢复申请已过期，可重新申请',
    invalidated: '恢复申请已失效，可在满足条件后重新申请',
  };
  if (pending(space))
    return request.requestedById === session.user?.id ? '等待对方确认恢复' : '对方申请恢复这个空间';
  return labels[request.status === 'pending' ? 'expired' : request.status];
}
async function load() {
  const current = ++sequence;
  try {
    const data = await api<ClosedSpaceList>('/spaces/closed?page=' + page.value);
    if (disposed || current !== sequence) return;
    result.value = data;
    error.value = '';
    if (!data.items.length && page.value > 1) page.value--;
  } catch (reason) {
    if (!disposed && current === sequence) error.value = (reason as Error).message;
  }
}
function close() {
  const space = session.space;
  if (!space) return;
  action.value = {
    title: space.members.length === 2 ? '解除绑定并关闭空间' : '关闭空间',
    help: '关闭后，所有记录（包括自己的私密草稿）立即隐藏，邀请失效。记录最多保留30天，到期自动删除；任一原成员也可提前彻底删除，删除后无法恢复。保留期间双人空间需双方同意、单人空间由本人恢复，恢复时原成员均须没有当前空间。',
    endpoint: '/spaces/' + space.id + '/close',
    lifecycleVersion: space.lifecycleVersion,
  };
}
function restore(space: ClosedSpace, accept = false) {
  const solo = space.members.length === 1;
  action.value = {
    title: accept ? '同意恢复空间' : solo ? '恢复空间' : '申请恢复空间',
    help:
      accept || solo
        ? '恢复后将重新绑定原空间，记录和约定按原状态恢复，已经到期的回访重新进入待办。原成员均须没有当前空间。'
        : '请确认你希望重新绑定这个空间。对方须在48小时内明确同意，且不能超过下方显示的删除截止时间。申请不会延长记录保留期。',
    endpoint:
      '/spaces/' +
      space.id +
      (accept
        ? '/restore-requests/' + space.restoreRequest!.id + '/accept'
        : solo
          ? '/restore'
          : '/restore-requests'),
    ...(accept ? {} : { lifecycleVersion: space.lifecycleVersion }),
  };
}
async function resolve(space: ClosedSpace, kind: 'cancel' | 'reject') {
  await run(
    async () => {
      await api(
        '/spaces/' + space.id + '/restore-requests/' + space.restoreRequest!.id + '/' + kind,
        { method: 'POST' },
      );
      await load();
    },
    kind === 'cancel' ? '恢复申请已撤回' : '已拒绝恢复申请',
  );
}
async function completed() {
  const title = action.value?.title;
  const purgeId = action.value?.purgeId;
  if (purgeId) {
    // Discard list responses started before deletion, including background refreshes.
    sequence++;
    if (result.value?.items.some((space) => space.id === purgeId)) {
      result.value = {
        ...result.value,
        items: result.value.items.filter((space) => space.id !== purgeId),
        total: Math.max(0, result.value.total - 1),
      };
    }
  }
  action.value = undefined;
  if (purgeId) {
    notify('空间已永久删除，无法恢复');
    await returnDeleteFocus(false);
  }
  await run(async () => {
    await session.refresh(true);
    await load();
  });
  if (!purgeId)
    notify(title === '申请恢复空间' ? '申请已提交，等待对方在期限内确认' : '空间操作已完成');
}
watch(
  [() => session.syncRevision, page],
  () => {
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  sequence++;
  clearInterval(clock);
});
</script>
<template>
  <section v-if="session.space" class="lifecycle-settings" aria-labelledby="space-settings-heading">
    <h3 id="space-settings-heading">空间设置</h3>
    <p>需要结束共同使用时，可以关闭空间。请先了解记录保留和恢复规则。</p>
    <button type="button" class="btn secondary" @click="close">
      {{ session.space.members.length === 2 ? '解除绑定并关闭空间' : '关闭空间' }}
    </button>
  </section>
  <section class="lifecycle-settings" aria-labelledby="closed-spaces-heading">
    <div class="section-heading">
      <h3 id="closed-spaces-heading">已关闭的空间</h3>
      <button ref="refreshButton" type="button" class="text-button" @click="load">刷新列表</button>
    </div>
    <p>
      记录在关闭后最多保留30天，期间不可查看；到期自动删除。任一原成员也可提前彻底删除，双方都无法恢复。恢复申请最长有效48小时。
    </p>
    <p v-if="error" class="notice warm" role="alert">{{ error }}</p>
    <p v-if="result && !cards.length">暂无保留期内的已关闭空间。</p>
    <article
      v-for="space in cards"
      :key="space.id"
      class="closed-space-card"
      :aria-label="space.name"
    >
      <h4>{{ space.name }}</h4>
      <div class="closed-members">
        <span v-for="member in space.members" :key="member.id" class="closed-member">
          <UserAvatar :user="member" />{{ member.nickname }}
        </span>
      </div>
      <p class="closed-space-dates">
        关闭时间：{{ timestamp(space.closedAt) }}<br />
        删除截止：{{ timestamp(space.purgeAt) }}
      </p>
      <p v-if="!space.canRestore" class="notice">暂不满足恢复条件，请确认原成员均没有当前空间。</p>
      <p v-if="space.members.length === 2">{{ requestLabel(space) }}</p>
      <p v-if="pending(space)">申请有效至 {{ timestamp(space.restoreRequest!.expiresAt) }}</p>
      <div class="actions">
        <template v-if="pending(space)">
          <button
            v-if="space.restoreRequest!.requestedById === session.user?.id"
            type="button"
            class="btn secondary"
            :disabled="busy"
            @click="resolve(space, 'cancel')"
          >
            撤回申请
          </button>
          <template v-else>
            <button
              type="button"
              class="btn primary"
              :disabled="busy || !space.canRestore"
              @click="restore(space, true)"
            >
              同意恢复
            </button>
            <button
              type="button"
              class="btn secondary"
              :disabled="busy"
              @click="resolve(space, 'reject')"
            >
              拒绝申请
            </button>
          </template>
        </template>
        <button
          v-else
          type="button"
          class="btn secondary"
          :disabled="busy || !space.canRestore"
          @click="restore(space)"
        >
          {{ space.members.length === 1 ? '恢复空间' : '申请恢复' }}
        </button>
        <button
          type="button"
          class="btn danger"
          :disabled="busy"
          @click="startPurge(space, $event)"
        >
          彻底删除
        </button>
      </div>
    </article>
    <div v-if="result && (page > 1 || result.total > result.pageSize)" class="actions">
      <button class="btn secondary" :disabled="page <= 1" @click="page--">上一页</button>
      <span>第 {{ page }} 页</span>
      <button
        class="btn secondary"
        :disabled="page * result.pageSize >= result.total"
        @click="page++"
      >
        下一页
      </button>
    </div>
  </section>
  <ConfirmDialog
    v-if="deleteWarning"
    :title="`彻底删除「${deleteWarning.name}」？`"
    description="将立即删除这个空间的所有记录，包括双方的私密草稿、视角、约定和回访。不再保留到30天，双方都无法恢复。"
    confirm-label="继续删除"
    danger
    @cancel="cancelAction"
    @confirm="confirmPurge"
  />
  <SpaceActionDialog
    v-if="action"
    :title="action.title"
    :help="action.help"
    :endpoint="action.endpoint"
    :lifecycle-version="action.lifecycleVersion"
    :danger="action.danger"
    :confirm-label="action.confirmLabel"
    @cancel="cancelAction"
    @done="completed"
    @changed="changed"
  />
</template>
<style scoped>
.lifecycle-settings {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid var(--border);
}
.lifecycle-settings h3 {
  font-size: 15px;
}
.lifecycle-settings .section-heading {
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 0;
}
.lifecycle-settings > p {
  margin: 10px 0 16px;
  color: var(--sage-dark);
  font-size: 13px;
  line-height: 1.7;
}
.lifecycle-settings > p:last-child {
  margin-bottom: 0;
}
.closed-space-card {
  border-top: 1px solid var(--border);
  padding: 22px 0 6px;
  margin-top: 18px;
}
.closed-space-card h4 {
  font-size: 15px;
  overflow-wrap: anywhere;
}
.closed-space-card p {
  margin: 12px 0;
  line-height: 1.7;
}
.closed-members {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.closed-member {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-wrap: anywhere;
}
.closed-space-dates {
  color: var(--sage-dark);
  font-size: 13px;
}
</style>
