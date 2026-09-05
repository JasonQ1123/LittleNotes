<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { api, useTask } from '../api';
import { useSession } from '../store';
import { emptyPerspective, perspectiveFields, type Note } from '../types';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ note: Note }>();
const emit = defineEmits<{ updated: [note: Note] }>();
const session = useSession();
const { busy, run } = useTask();
const mine = computed(() => props.note.perspectives.find((p) => p.userId === session.user?.id));
const partner = computed(() => props.note.space.members.find((m) => m.id !== session.user?.id));
const theirs = computed(() => props.note.perspectives.find((p) => p.userId === partner.value?.id));
const form = reactive(emptyPerspective());
let revision = 0;
watch(
  () => mine.value?.revision,
  () => {
    Object.assign(form, emptyPerspective(), mine.value?.content || {});
    revision = mine.value?.revision || 0;
  },
  { immediate: true },
);
async function save(publish: boolean) {
  const note = await run(
    () =>
      api<Note>(`/records/${props.note.id}/perspective`, {
        method: 'POST',
        body: { ...form, revision, publish },
      }),
    publish ? '你的视角已分享给对方' : '想法已保存，未发布的修改只有你能看到',
  );
  if (note) emit('updated', note);
}
</script>
<template>
  <div class="perspective-grid">
    <section class="panel content-panel">
      <div class="section-heading">
        <h2>
          <span class="avatar tiny">{{ session.user?.nickname.slice(0, 1) }}</span
          >我的视角
        </h2>
        <span :class="['badge', mine?.hasUnpublishedChanges ? 'draft' : 'followup']">{{
          !mine?.publishedAt ? '仅自己可见' : mine.hasUnpublishedChanges ? '有未发布修改' : '已分享'
        }}</span>
      </div>
      <p class="section-description">从“我”出发，试着让对方理解你的感受。</p>
      <form v-if="note.status !== 'archived'" @submit.prevent="save(false)">
        <label v-for="field in perspectiveFields" :key="field.key" class="field"
          >{{ field.label
          }}<textarea
            v-model="form[field.key]"
            :placeholder="field.placeholder"
            rows="3"
            maxlength="5000"
          ></textarea>
        </label>
        <div class="actions wrap">
          <button class="btn secondary" :disabled="busy">
            <AppIcon name="lock" :size="16" />保存我的想法</button
          ><button
            v-if="note.status !== 'draft'"
            type="button"
            class="btn primary"
            :disabled="busy"
            @click="save(true)"
          >
            <AppIcon name="send" :size="16" />分享我的视角
          </button>
        </div>
        <p class="form-hint">保存后仍由你决定何时分享；再次编辑不会立即改变对方看到的版本。</p>
      </form>
      <template v-else
        ><div v-for="field in perspectiveFields" :key="field.key" class="read-field">
          <h3>{{ field.label }}</h3>
          <p>{{ mine?.content[field.key] || '尚未填写' }}</p>
        </div></template
      >
    </section>
    <section class="panel content-panel partner-panel">
      <div class="section-heading">
        <h2>
          <span class="avatar tiny peach">{{ partner?.nickname.slice(0, 1) || '?' }}</span
          >{{ partner?.nickname || '对方' }}的视角
        </h2>
        <AppIcon name="heart" :size="19" class="muted" />
      </div>
      <p class="section-description">先试着听懂，再慢慢回应。</p>
      <template v-if="theirs"
        ><div v-for="field in perspectiveFields" :key="field.key" class="read-field">
          <h3>{{ field.label }}</h3>
          <p>{{ theirs.content[field.key] || '这部分还没有写下' }}</p>
        </div></template
      >
      <div v-else class="waiting-state">
        <AppIcon name="book" :size="37" />
        <h3>{{ partner ? '留一点时间，等对方说说' : '邀请对方，一起写下去' }}</h3>
        <p>
          {{
            partner
              ? '对方分享自己的视角后，会出现在这里。'
              : '配对后，双方都能补充自己的理解和感受。'
          }}
        </p>
        <RouterLink v-if="!partner" to="/space" class="text-button"
          >去邀请对方<AppIcon name="arrow" :size="16"
        /></RouterLink>
      </div>
    </section>
  </div>
</template>
