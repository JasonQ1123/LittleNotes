<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useSession } from '../store';
import { isNewPasswordValid, NEW_PASSWORD_HINT } from '../password';
import EmailVerification from '../components/EmailVerification.vue';
import SecretField from '../components/SecretField.vue';
const router = useRouter();
const session = useSession();
const verification = ref({ email: '', challengeId: '', code: '' });
const password = ref('');
const confirm = ref('');
const busy = ref(false);
const error = ref('');
async function submit() {
  if (busy.value) return;
  error.value = '';
  if (!isNewPasswordValid(password.value)) {
    error.value = `新密码需为 ${NEW_PASSWORD_HINT}`;
    return;
  }
  if (password.value !== confirm.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }
  busy.value = true;
  try {
    await api('/auth/password/reset', {
      method: 'POST',
      body: { ...verification.value, newPassword: password.value, confirmPassword: confirm.value },
    });
    session.expire();
    password.value = '';
    confirm.value = '';
    await router.replace('/login?passwordChanged=1');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '暂时无法重置，请重试';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main id="main-content" class="account-page">
    <section class="panel account-card">
      <span class="eyebrow">小纸条 · 账号安全</span>
      <h1>找回密码</h1>
      <p>使用账号已验证的邮箱收取验证码，然后设置新密码。</p>
      <form @submit.prevent="submit">
        <EmailVerification
          v-model="verification"
          endpoint="/auth/password/reset/code"
          :disabled="busy"
        />
        <SecretField v-model="password" label="新密码" :disabled="busy" />
        <SecretField v-model="confirm" label="确认新密码" :disabled="busy" />
        <p v-if="error" class="notice warm" role="alert">{{ error }}</p>
        <button class="btn primary full" :disabled="busy || !verification.challengeId">
          {{ busy ? '正在重置…' : '重置密码' }}
        </button>
      </form>
      <p class="verification-hint">
        重置后所有设备会退出登录。尚未绑定邮箱且已忘记密码的旧账号暂不支持自助找回。
      </p>
      <RouterLink class="recovery-link" to="/login">返回登录</RouterLink>
    </section>
  </main>
</template>
