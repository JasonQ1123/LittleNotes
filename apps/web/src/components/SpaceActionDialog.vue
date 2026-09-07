<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api, ApiError } from '../api';
import SecretField from './SecretField.vue';
import AppIcon from './AppIcon.vue';
const props = defineProps<{
  title: string;
  help: string;
  endpoint: string;
  lifecycleVersion?: number;
}>();
const emit = defineEmits<{ cancel: []; done: []; changed: [] }>();
const dialog = ref<HTMLDialogElement>();
const password = ref('');
const busy = ref(false);
const error = ref('');
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api(props.endpoint, {
      method: 'POST',
      body: {
        currentPassword: password.value,
        ...(props.lifecycleVersion === undefined
          ? {}
          : { lifecycleVersion: props.lifecycleVersion }),
      },
    });
    password.value = '';
    emit('done');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '操作暂未完成，请稍后重试';
    if (reason instanceof ApiError && [404, 409].includes(reason.status)) emit('changed');
  } finally {
    busy.value = false;
  }
}
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => {
  password.value = '';
  dialog.value?.close();
});
</script>
<template>
  <dialog
    ref="dialog"
    class="dialog password-dialog"
    aria-labelledby="space-action-title"
    aria-describedby="space-action-help"
    @cancel.prevent="!busy && emit('cancel')"
  >
    <div class="dialog-head">
      <h2 id="space-action-title">{{ title }}</h2>
      <button
        type="button"
        class="icon-button"
        aria-label="关闭操作窗口"
        :disabled="busy"
        @click="emit('cancel')"
      >
        <AppIcon name="close" />
      </button>
    </div>
    <p id="space-action-help">{{ help }}</p>
    <form @submit.prevent="submit">
      <SecretField v-model="password" label="当前密码" current :disabled="busy" />
      <p v-if="error" class="notice warm" role="alert">{{ error }}</p>
      <div class="actions end">
        <button type="button" class="btn secondary" :disabled="busy" @click="emit('cancel')">
          取消
        </button>
        <button class="btn primary" :disabled="busy">
          {{ busy ? '正在处理…' : '确认' + title }}
        </button>
      </div>
    </form>
  </dialog>
</template>
