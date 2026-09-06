<script setup lang="ts">
import { ref, watch, onBeforeUnmount, onMounted } from 'vue';
import { api, ApiError } from '../api';
const props = defineProps<{ endpoint: string; currentPassword?: string; disabled?: boolean }>();
const model = defineModel<{ email: string; challengeId: string; code: string }>({ required: true });
const emailInput = ref<HTMLInputElement>();
const sending = ref(false);
const remaining = ref(0);
const message = ref('');
const error = ref('');
const mock = ref(false);
let until = 0;
let generation = 0;
let active = true;
const tick = setInterval(() => {
  remaining.value = Math.max(0, Math.ceil((until - Date.now()) / 1000));
}, 250);
watch(
  () => model.value.email,
  () => {
    generation++;
    model.value.challengeId = '';
    model.value.code = '';
    message.value = '';
    error.value = '';
  },
);
onMounted(() => {
  api<{ features: { mockEmail: boolean } }>('/health')
    .then((site) => {
      mock.value = site.features.mockEmail;
    })
    .catch(() => {});
});
onBeforeUnmount(() => {
  active = false;
  clearInterval(tick);
});
async function send() {
  if (sending.value || props.disabled || remaining.value || !emailInput.value?.reportValidity())
    return;
  error.value = '';
  if (
    props.currentPassword !== undefined &&
    (props.currentPassword.length < 8 || props.currentPassword.length > 128)
  ) {
    error.value = '请先输入当前密码';
    return;
  }
  sending.value = true;
  const snapshot = generation;
  try {
    const response = await api<{ challengeId: string; retryAfter: number; message: string }>(
      props.endpoint,
      {
        method: 'POST',
        body: {
          email: model.value.email,
          ...(props.currentPassword !== undefined
            ? { currentPassword: props.currentPassword }
            : {}),
        },
      },
    );
    if (!active || generation !== snapshot) return;
    model.value.challengeId = response.challengeId;
    model.value.code = '';
    until = Date.now() + response.retryAfter * 1000;
    remaining.value = response.retryAfter;
    message.value = response.message;
  } catch (e) {
    if (!active || generation !== snapshot) return;
    error.value = e instanceof Error ? e.message : '暂时无法申请，请稍后重试';
    if (e instanceof ApiError && e.retryAfter) {
      remaining.value = e.retryAfter;
      until = Date.now() + e.retryAfter * 1000;
    }
  } finally {
    sending.value = false;
  }
}
</script>
<template>
  <div class="email-verification">
    <label class="field"
      >邮箱地址
      <input
        ref="emailInput"
        v-model="model.email"
        type="email"
        autocomplete="email"
        maxlength="254"
        required
        :disabled="disabled || sending"
        placeholder="用于验证身份和找回密码"
      />
    </label>
    <div class="verification-row">
      <label class="field"
        >邮箱验证码
        <input
          v-model="model.code"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          minlength="6"
          maxlength="6"
          required
          :disabled="disabled || sending"
          placeholder="6 位数字"
        />
      </label>
      <button
        type="button"
        class="btn secondary"
        :disabled="disabled || sending || remaining > 0"
        @click="send"
      >
        {{ sending ? '正在申请…' : remaining ? `${remaining} 秒后重发` : '获取验证码' }}
      </button>
    </div>
    <p v-if="message" class="verification-hint" role="status">
      {{ message }}。验证码 10 分钟有效；请同时检查垃圾邮件。
    </p>
    <p v-if="error" class="notice warm" role="alert">{{ error }}</p>
    <a v-if="mock" class="recovery-link" href="/dev-mail" target="_blank" rel="noopener"
      >打开本地模拟收件箱（测试用）</a
    >
  </div>
</template>
