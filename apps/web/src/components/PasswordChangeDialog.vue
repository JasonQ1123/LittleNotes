<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useSession } from '../store';
import AppIcon from './AppIcon.vue';
import { isNewPasswordValid, NEW_PASSWORD_HINT, NEW_PASSWORD_PATTERN } from '../password';

const emit = defineEmits<{ cancel: [] }>();
const session = useSession();
const router = useRouter();
const dialog = ref<HTMLDialogElement>();
const busy = ref(false);
const error = ref('');
const values = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const visible = reactive({ currentPassword: false, newPassword: false, confirmPassword: false });
const fields = [
  { key: 'currentPassword', label: '当前密码', autocomplete: 'current-password' },
  { key: 'newPassword', label: '新密码', autocomplete: 'new-password' },
  { key: 'confirmPassword', label: '确认新密码', autocomplete: 'new-password' },
] as const;

async function submit() {
  if (busy.value) return;
  error.value = '';
  if (!isNewPasswordValid(values.newPassword)) {
    error.value = `新密码需为 ${NEW_PASSWORD_HINT}`;
    return;
  }
  if (values.newPassword !== values.confirmPassword) {
    error.value = '两次输入的新密码不一致';
    return;
  }
  if (values.currentPassword === values.newPassword) {
    error.value = '新密码不能与当前密码相同';
    return;
  }
  busy.value = true;
  for (const { key } of fields) visible[key] = false;
  try {
    await api('/auth/password/change', { method: 'POST', body: { ...values } });
    for (const { key } of fields) values[key] = '';
    session.expire();
    await router.replace({ path: '/login', query: { passwordChanged: '1' } });
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '暂时无法修改密码，请稍后重试';
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  await nextTick();
  dialog.value?.showModal();
});
onBeforeUnmount(() => {
  for (const { key } of fields) values[key] = '';
  dialog.value?.close();
});
</script>
<template>
  <dialog
    ref="dialog"
    class="dialog password-dialog"
    aria-labelledby="password-dialog-title"
    aria-describedby="password-dialog-help"
    @cancel.prevent="!busy && emit('cancel')"
  >
    <div class="dialog-head">
      <h2 id="password-dialog-title">修改密码</h2>
      <button
        type="button"
        class="icon-button"
        aria-label="关闭修改密码"
        :disabled="busy"
        @click="emit('cancel')"
      >
        <AppIcon name="close" />
      </button>
    </div>
    <p id="password-dialog-help">
      新密码需为 {{ NEW_PASSWORD_HINT }}。修改成功后，所有设备都会退出登录，请使用新密码重新登录。
    </p>
    <form @submit.prevent="submit">
      <div v-for="field in fields" :key="field.key" class="field">
        <label :for="`change-${field.key}`">{{ field.label }}</label>
        <div class="password-input">
          <input
            :id="`change-${field.key}`"
            v-model="values[field.key]"
            :type="visible[field.key] ? 'text' : 'password'"
            :autocomplete="field.autocomplete"
            minlength="8"
            :maxlength="field.key === 'currentPassword' ? 128 : 32"
            :pattern="field.key === 'currentPassword' ? undefined : NEW_PASSWORD_PATTERN"
            :title="field.key === 'currentPassword' ? undefined : NEW_PASSWORD_HINT"
            required
            :disabled="busy"
          />
          <button
            type="button"
            class="icon-button password-toggle"
            :aria-label="`${visible[field.key] ? '隐藏' : '显示'}${field.label}`"
            :aria-controls="`change-${field.key}`"
            :disabled="busy"
            @click="visible[field.key] = !visible[field.key]"
          >
            <AppIcon :name="visible[field.key] ? 'eyeOff' : 'eye'" :size="18" />
          </button>
        </div>
      </div>
      <p v-if="error" class="notice warm" role="alert">{{ error }}</p>
      <div class="actions end">
        <button type="button" class="btn secondary" :disabled="busy" @click="emit('cancel')">
          取消
        </button>
        <button class="btn primary" :disabled="busy">{{ busy ? '正在修改…' : '确认修改' }}</button>
      </div>
    </form>
  </dialog>
</template>
