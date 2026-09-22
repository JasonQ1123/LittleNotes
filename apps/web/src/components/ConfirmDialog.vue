<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';
withDefaults(
  defineProps<{
    title: string;
    description: string;
    confirmLabel?: string;
    danger?: boolean;
    busy?: boolean;
  }>(),
  { confirmLabel: '确认' },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const dialog = ref<HTMLDialogElement>();
const cancelButton = ref<HTMLButtonElement>();
onMounted(async () => {
  await nextTick();
  dialog.value?.showModal();
  cancelButton.value?.focus();
});
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <dialog
    ref="dialog"
    class="dialog"
    aria-labelledby="dialog-title"
    aria-describedby="dialog-description"
    @cancel.prevent="!busy && emit('cancel')"
  >
    <div class="dialog-head">
      <h2 id="dialog-title">{{ title }}</h2>
      <button class="icon-button" aria-label="关闭对话框" :disabled="busy" @click="emit('cancel')">
        <AppIcon name="close" />
      </button>
    </div>
    <p id="dialog-description" :class="{ 'danger-text': danger }">{{ description }}</p>
    <div class="actions end">
      <button ref="cancelButton" class="btn secondary" :disabled="busy" @click="emit('cancel')">
        再想想</button
      ><button
        :class="['btn', danger ? 'danger' : 'primary']"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ busy ? '正在处理…' : confirmLabel }}
      </button>
    </div>
  </dialog>
</template>
