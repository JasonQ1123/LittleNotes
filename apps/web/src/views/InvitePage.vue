<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { api, useTask } from '../api';
import { useSession } from '../store';
import AppIcon from '../components/AppIcon.vue';
const route = useRoute();
const router = useRouter();
const session = useSession();
const { busy, run } = useTask();
async function accept() {
  await run(async () => {
    await api('/spaces/invitations/accept', {
      method: 'POST',
      body: { token: route.params.token },
    });
    await session.refresh();
    await router.replace('/');
  }, '欢迎来到属于你们的小天地');
}
</script>
<template>
  <section class="panel invite-page">
    <div class="empty-icon"><AppIcon name="heart" :size="34" /></div>
    <span class="eyebrow">YOU & ME</span>
    <h1>有人想和你，<br />一起写下去。</h1>
    <p>
      这是一份「小纸条」共同空间邀请。<br />加入后，你们可以分享记录、确认约定，<br />一起回头看看那些正在发生的小改变。
    </p>
    <template v-if="session.space"
      ><div class="notice warm">你已经加入了一个共同空间，无法重复配对。</div>
      <RouterLink to="/space" class="btn primary">查看我的空间</RouterLink></template
    ><button v-else class="btn primary" :disabled="busy" @click="accept">
      {{ busy ? '正在加入…' : '接受邀请并加入' }}<AppIcon name="arrow" :size="17" /></button
    ><RouterLink to="/" class="text-button">先回首页看看</RouterLink>
  </section>
</template>
