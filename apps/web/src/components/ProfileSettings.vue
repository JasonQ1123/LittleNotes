<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { api, useTask } from '../api';
import { useSession } from '../store';
import type { User } from '../types';
import UserAvatar from './UserAvatar.vue';
import AvatarEditor from './AvatarEditor.vue';
import ConfirmDialog from './ConfirmDialog.vue';
const session = useSession();
const { busy, run } = useTask();
const editing = ref(false);
const nickname = ref('');
const nameInput = ref<HTMLInputElement>();
const fileInput = ref<HTMLInputElement>();
const file = ref<File | null>(null);
const confirmReset = ref(false);
const avatarError = ref('');

function apply(user: User) {
  session.user = user;
  if (session.space)
    session.space.members = session.space.members.map((member) =>
      member.id === user.id
        ? { ...member, nickname: user.nickname, avatarUrl: user.avatarUrl }
        : member,
    );
}
async function edit() {
  nickname.value = session.user?.nickname || '';
  editing.value = true;
  await nextTick();
  nameInput.value?.focus();
}
async function saveName() {
  const updated = await run(
    () => api<User>('/users/me', { method: 'PATCH', body: { nickname: nickname.value } }),
    '昵称已更新',
  );
  if (updated) {
    apply(updated);
    editing.value = false;
  }
}
function choose(event: Event) {
  avatarError.value = '';
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) file.value = input.files[0];
  input.value = '';
}
async function upload(blob: Blob) {
  avatarError.value = '';
  const data = new FormData();
  data.append('file', blob, 'avatar.webp');
  const updated = await run(async () => {
    try {
      return await api<User>('/users/me/avatar', { method: 'PUT', body: data });
    } catch (error) {
      avatarError.value = error instanceof Error ? error.message : '头像暂时没有保存，请重试';
      throw error;
    }
  }, '头像已更新');
  if (updated) {
    apply(updated);
    file.value = null;
  }
}
async function reset() {
  const updated = await run(
    () => api<User>('/users/me/avatar', { method: 'DELETE' }),
    '已恢复默认头像',
  );
  if (updated) {
    apply(updated);
    confirmReset.value = false;
  }
}
</script>
<template>
  <div class="profile-row">
    <button
      type="button"
      class="profile-avatar-button"
      aria-label="更换头像"
      :disabled="busy"
      @click="fileInput?.click()"
    >
      <UserAvatar :user="session.user" class="large" />
    </button>
    <div>
      <h3>{{ session.user?.nickname }}</h3>
      <p>@{{ session.user?.username }}</p>
    </div>
  </div>
  <input
    ref="fileInput"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    class="profile-file-input"
    aria-label="选择头像图片"
    tabindex="-1"
    @change="choose"
  />
  <div class="actions profile-avatar-actions">
    <button type="button" class="text-button" :disabled="busy" @click="fileInput?.click()">
      更换头像
    </button>
    <button
      v-if="session.user?.avatarUrl"
      type="button"
      class="text-button muted"
      :disabled="busy"
      @click="confirmReset = true"
    >
      恢复默认头像
    </button>
  </div>
  <p class="profile-image-hint">支持 JPG、PNG、WebP，最大 5 MB</p>
  <form v-if="editing" class="profile-name-form" @submit.prevent="saveName">
    <label class="field"
      >昵称<input
        ref="nameInput"
        v-model="nickname"
        autocomplete="nickname"
        required
        maxlength="30"
        :disabled="busy"
    /></label>
    <div class="actions">
      <button class="btn primary small" :disabled="busy || !nickname.trim()">
        {{ busy ? '正在保存…' : '保存昵称' }}</button
      ><button type="button" class="btn secondary small" :disabled="busy" @click="editing = false">
        取消
      </button>
    </div>
  </form>
  <button
    v-else
    type="button"
    class="btn secondary full profile-edit-button"
    :disabled="busy"
    @click="edit"
  >
    修改昵称
  </button>
  <AvatarEditor
    v-if="file"
    :file="file"
    :busy="busy"
    :save-error="avatarError"
    @save="upload"
    @cancel="file = null"
    @choose="fileInput?.click()"
  />
  <ConfirmDialog
    v-if="confirmReset"
    title="恢复默认头像？"
    description="当前图片会替换为昵称首字头像，你可以随时重新上传。"
    confirm-label="恢复默认"
    :busy="busy"
    @confirm="reset"
    @cancel="confirmReset = false"
  />
</template>
