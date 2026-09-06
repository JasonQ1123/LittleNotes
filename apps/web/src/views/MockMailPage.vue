<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
type Message = {
  challengeId: string;
  email: string;
  purpose: string;
  code: string;
  expiresAt: string;
};
const messages = ref<Message[]>([]);
const error = ref('');
const labels: Record<string, string> = {
  register: '注册账号',
  bind: '绑定邮箱',
  replace: '更换邮箱',
  reset: '找回密码',
};
async function refresh() {
  try {
    messages.value = await api<Message[]>('/dev/mail');
    error.value = '';
  } catch {
    error.value = '当前服务未开启本地模拟收件箱。';
  }
}
onMounted(refresh);
</script>
<template>
  <main id="main-content" class="account-page">
    <section class="panel account-card">
      <h1>本地模拟收件箱</h1>
      <p>仅用于本机测试，不发送真实邮件。邮件在后台处理，申请后稍等片刻再刷新；重启后会清空。</p>
      <button class="btn secondary" @click="refresh">刷新收件箱</button>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-else-if="!messages.length">暂无邮件。</p>
      <article v-for="message in messages" :key="message.challengeId" class="mock-message">
        <h2>{{ labels[message.purpose] }}</h2>
        <p>{{ message.email }}</p>
        <strong class="mock-code">{{ message.code }}</strong>
        <p>到期时间：{{ new Date(message.expiresAt).toLocaleTimeString('zh-CN') }}</p>
      </article>
    </section>
  </main>
</template>
