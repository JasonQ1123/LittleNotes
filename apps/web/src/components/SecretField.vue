<script setup lang="ts">
import { ref, useId } from 'vue';
import AppIcon from './AppIcon.vue';
import { NEW_PASSWORD_HINT, NEW_PASSWORD_PATTERN } from '../password';
defineProps<{ label: string; current?: boolean; disabled?: boolean }>();
const model = defineModel<string>({ required: true });
const show = ref(false);
const id = useId();
</script>
<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <div class="password-input">
      <input
        :id="id"
        v-model="model"
        :type="show ? 'text' : 'password'"
        :autocomplete="current ? 'current-password' : 'new-password'"
        minlength="8"
        :maxlength="current ? 128 : 32"
        :pattern="current ? undefined : NEW_PASSWORD_PATTERN"
        :title="current ? undefined : NEW_PASSWORD_HINT"
        :aria-describedby="current ? undefined : `${id}-hint`"
        required
        :disabled="disabled"
      />
      <button
        type="button"
        class="icon-button password-toggle"
        :aria-label="`${show ? '隐藏' : '显示'}${label}`"
        :aria-controls="id"
        @click="show = !show"
      >
        <AppIcon :name="show ? 'eyeOff' : 'eye'" :size="18" />
      </button>
    </div>
    <small v-if="!current" :id="`${id}-hint`">{{ NEW_PASSWORD_HINT }}</small>
  </div>
</template>
