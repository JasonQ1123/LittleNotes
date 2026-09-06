<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useSession } from '../store';
import { safeRedirect } from '../router';
import EmailVerification from '../components/EmailVerification.vue';
import SecretField from '../components/SecretField.vue';
const session = useSession();
const route = useRoute();
const router = useRouter();
const binding = computed(() => session.user?.requiresEmailBinding);
const password = ref('');
const verification = ref({ email: '', challengeId: '', code: '' });
const busy = ref(false);
const error = ref('');
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await api<{ requiresLogin: boolean }>('/auth/email', {
      method: 'PUT',
      body: { ...verification.value, currentPassword: password.value },
    });
    password.value = '';
    if (result.requiresLogin) {
      session.expire();
      await router.replace('/login?emailChanged=1');
    } else {
      await session.refresh();
      await router.replace(safeRedirect(route.query.redirect));
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '暂时无法保存，请重试';
  } finally {
    busy.value = false;
  }
}
async function logout() {
  await session.logout();
  await router.replace('/login');
}
</script>
<template>
  <main id="main-content" class="account-page">
    <section class="panel account-card">
      <span class="eyebrow">小纸条 · 账号安全</span>
      <h1>{{ binding ? '先为账号绑定邮箱' : '更换找回邮箱' }}</h1>
      <p v-if="binding">
        {{
          session.user?.nickname
        }}，验证邮箱后就能继续使用原来的空间和纸条。以后忘记密码，也可以通过邮箱找回。
      </p>
      <p v-else>
        当前邮箱：{{
          session.user?.maskedEmail
        }}。验证新邮箱前，当前邮箱继续有效；更换成功后，所有设备会退出登录。
      </p>
      <form @submit.prevent="submit">
        <SecretField v-model="password" label="当前密码" current :disabled="busy" />
        <EmailVerification
          v-model="verification"
          endpoint="/auth/email/code"
          :current-password="password"
          :disabled="busy"
        />
        <p v-if="error" class="notice warm" role="alert">{{ error }}</p>
        <button class="btn primary full" :disabled="busy || !verification.challengeId">
          {{ busy ? '正在验证…' : binding ? '验证并继续' : '确认更换邮箱' }}
        </button>
      </form>
      <p class="verification-hint">
        请使用自己可以长期收信的邮箱。一个邮箱只能绑定一个账号，伴侣看不到你的邮箱。
      </p>
      <button v-if="binding" class="btn secondary full" :disabled="busy" @click="logout">
        退出登录
      </button>
      <RouterLink v-else class="recovery-link" to="/space">返回账号安全</RouterLink>
    </section>
  </main>
</template>
