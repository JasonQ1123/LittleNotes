<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, notify, useTask } from '../api';
import { useSession } from '../store';
import { dateLabel } from '../types';
import AppIcon from '../components/AppIcon.vue';
import UserAvatar from '../components/UserAvatar.vue';
import ProfileSettings from '../components/ProfileSettings.vue';
import PasswordChangeDialog from '../components/PasswordChangeDialog.vue';
import SpaceLifecycleSettings from '../components/SpaceLifecycleSettings.vue';
const session = useSession();
const router = useRouter();
const { busy, run } = useTask();
const name = ref('我们的小天地');
const inviteLink = ref('');
const changingPassword = ref(false);
async function create() {
  await run(async () => {
    await api('/spaces', { method: 'POST', body: { name: name.value } });
    await session.refresh(true);
  }, '我们的共同空间，建立好啦');
}
async function invite() {
  await run(async () => {
    const result = await api<{ token: string }>('/spaces/invitations', { method: 'POST' });
    inviteLink.value = `${window.location.origin}/invite/${result.token}`;
    await session.refresh(true);
  });
}
async function revoke(id: string) {
  await run(async () => {
    await api(`/spaces/invitations/${id}`, { method: 'DELETE' });
    inviteLink.value = '';
    await session.refresh(true);
  }, '这份邀请已撤销');
}
async function copy() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    notify('邀请链接已复制，可以发给对方了');
  } catch {
    notify('浏览器未允许自动复制，请选中下面的链接手动复制', true);
  }
}
async function logout() {
  await run(async () => {
    await session.logout();
    await router.replace('/login');
  });
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">JUST THE TWO OF US</span>
      <h1>我们的空间</h1>
      <p>为彼此留一个，可以安心说话的地方。</p>
    </div>
  </div>
  <div class="settings-grid">
    <section class="panel settings-card">
      <div class="section-heading">
        <h2><AppIcon name="users" :size="21" />共同空间</h2>
      </div>
      <template v-if="session.space"
        ><div class="space-cover">
          <div class="large-avatar-pair">
            <UserAvatar
              v-for="(member, index) in session.space.members"
              :key="member.id"
              :user="member"
              :class="['large', { peach: index === 1 }]"
            /><span v-if="session.space.members.length < 2" class="avatar large dashed"
              ><AppIcon name="plus" :size="24"
            /></span>
          </div>
          <h3>{{ session.space.name }}</h3>
          <p>
            {{ session.space.members.map((m) => m.nickname).join(' & ')
            }}{{
              session.space.members.length < 2
                ? '，还有一个位置留给重要的人'
                : '，一起把日子过得更好一点'
            }}
          </p>
        </div>
        <template v-if="session.space.members.length < 2"
          ><div class="notice">
            邀请链接 48 小时有效，只能使用一次。生成新邀请会使之前的邀请失效。
          </div>
          <button class="btn primary full" :disabled="busy" @click="invite">
            <AppIcon name="link" :size="18" />生成小纸条邀请
          </button>
          <div v-if="inviteLink" class="invite-result">
            <label class="field"
              >发给对方的邀请链接<input
                :value="inviteLink"
                readonly
                aria-label="邀请链接"
                @focus="($event.target as HTMLInputElement).select()" /></label
            ><button class="btn secondary full" @click="copy">
              <AppIcon name="copy" :size="17" />复制邀请链接
            </button>
          </div>
          <div
            v-for="invitation in session.space.invitations"
            :key="invitation.id"
            class="invitation-row"
          >
            <span>邀请有效至 {{ dateLabel(invitation.expiresAt) }}</span
            ><button class="text-button muted" :disabled="busy" @click="revoke(invitation.id)">
              撤销邀请
            </button>
          </div></template
        >
        <div v-else class="notice">
          <AppIcon name="heart" :size="18" />两个人都到齐了，去写下属于你们的故事吧。
        </div></template
      >
      <form v-else @submit.prevent="create">
        <div class="space-cover">
          <span class="avatar large"><AppIcon name="users" :size="28" /></span>
          <h3>给我们的小天地起个名字</h3>
          <p>
            你可以先创建空间，再把邀请链接发给对方。<br />如果对方已经创建，请直接打开对方的邀请链接。
          </p>
        </div>
        <label class="field"
          >空间名称<input
            v-model="name"
            required
            maxlength="40"
            placeholder="我们的小天地" /></label
        ><button class="btn primary full" :disabled="busy">
          {{ busy ? '正在建立…' : '创建共同空间' }}<AppIcon name="arrow" :size="17" />
        </button>
      </form>
      <SpaceLifecycleSettings />
    </section>
    <div class="settings-side">
      <section class="panel settings-card">
        <h2>我的小名片</h2>
        <ProfileSettings />
        <button class="btn quiet full" :disabled="busy" @click="logout">
          <AppIcon name="logout" :size="17" />退出登录
        </button>
      </section>
      <section class="panel settings-card">
        <h2>账号安全</h2>
        <p class="security-email">找回邮箱：{{ session.user?.maskedEmail }}</p>
        <RouterLink to="/account/email" class="btn secondary full">更换邮箱</RouterLink>
        <button type="button" class="btn secondary full" @click="changingPassword = true">
          <AppIcon name="lock" :size="17" />修改密码
        </button>
      </section>
    </div>
  </div>
  <aside class="space-privacy-note" aria-label="关于这里的小秘密">
    <AppIcon name="lock" :size="18" />
    <p>
      <strong>关于这里的小秘密</strong>
      私密草稿和未发布的视角只有本人可见。分享后的纸条会留在你们的共同空间，双方可以一起结束跟进、归档留存。
    </p>
  </aside>
  <PasswordChangeDialog v-if="changingPassword" @cancel="changingPassword = false" />
</template>
<style scoped>
.space-privacy-note {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 24px;
  padding: 20px 0 0;
  border-top: 1px solid var(--border);
  color: var(--sage-strong);
}
.space-privacy-note > svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.space-privacy-note p {
  margin: 0;
  font-size: 12px;
  line-height: 1.85;
}
.space-privacy-note strong {
  margin-right: 10px;
  font-weight: 600;
}
</style>
