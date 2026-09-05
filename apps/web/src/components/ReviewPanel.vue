<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api, useTask } from '../api';
import { useSession } from '../store';
import { dateLabel, inputDate, ratings, type Note } from '../types';
import AppIcon from './AppIcon.vue';
import EmptyState from './EmptyState.vue';
const props = defineProps<{ note: Note }>();
const emit = defineEmits<{ updated: [note: Note] }>();
const session = useSession();
const { busy, run } = useTask();
const active = computed(() => props.note.agreements.find((a) => a.status === 'active'));
const cycle = computed(() => active.value?.cycles[0]);
const mine = computed(() => cycle.value?.reviews.find((r) => r.userId === session.user?.id));
const history = computed(() =>
  props.note.agreements.flatMap((a) =>
    a.cycles.filter((c) => c.id !== cycle.value?.id).map((c) => ({ ...c, version: a.version })),
  ),
);
const form = reactive({ rating: '', achieved: '', example: '', remaining: '', adjustments: '' });
const dueAt = ref(inputDate(new Date(Date.now() + 7 * 86400_000)));
watch(
  () => `${cycle.value?.id}:${mine.value?.updatedAt}`,
  () => {
    const review = mine.value;
    Object.assign(form, {
      rating: review?.rating || '',
      achieved: review?.achieved || '',
      example: review?.example || '',
      remaining: review?.remaining || '',
      adjustments: review?.adjustments || '',
    });
    dueAt.value =
      cycle.value && cycle.value.reviews.length < 2
        ? inputDate(cycle.value.dueAt)
        : inputDate(new Date(Date.now() + 7 * 86400_000));
  },
  { immediate: true },
);
async function submit() {
  const note = await run(
    () => api<Note>(`/reviews/${cycle.value!.id}`, { method: 'POST', body: { ...form } }),
    '回访已记下，谢谢你认真对待这份约定',
  );
  if (note) emit('updated', note);
}
async function schedule() {
  const note = await run(
    () =>
      api<Note>(`/agreements/${active.value!.id}/schedule`, {
        method: 'POST',
        body: { dueAt: new Date(dueAt.value).toISOString() },
      }),
    '回访时间已安排好',
  );
  if (note) emit('updated', note);
}
</script>
<template>
  <div v-if="!active || !cycle" class="panel">
    <EmptyState
      icon="leaf"
      title="给改变一点时间，也留一个约定"
      description="双方确认解决方案后，就可以在这里分别记录改善情况。"
    />
  </div>
  <template v-else
    ><div class="section-heading">
      <div>
        <h2>回头看看，有没有一点不一样</h2>
        <p class="section-description">
          第 {{ cycle.number }} 次回访 · 约定 V{{ active.version }} ·
          {{ dateLabel(cycle.dueAt, true) }}
        </p>
      </div>
      <span class="badge followup">{{ cycle.reviews.length }} / 2 人已回访</span>
    </div>
    <div class="notice">
      <AppIcon
        name="leaf"
        :size="19"
      />你们可以有不同的感受。把具体的变化留下来，下一次沟通会更清楚。
    </div>
    <div class="review-comparison">
      <article
        v-for="(member, index) in note.space.members"
        :key="member.id"
        :class="['panel review-card', { 'partner-review': index === 1 }]"
      >
        <div class="review-person">
          <span :class="['avatar', { peach: index === 1 }]">{{ member.nickname.slice(0, 1) }}</span>
          <h3>{{ member.nickname }}的感受</h3>
        </div>
        <template v-if="cycle.reviews.find((r) => r.userId === member.id)"
          ><template
            v-for="review in cycle.reviews.filter((r) => r.userId === member.id)"
            :key="review.id"
            ><span class="rating-value">{{ review.rating }}</span>
            <p class="review-achieved">行动：{{ review.achieved }}</p>
            <div class="read-field">
              <h4>实际发生的小变化</h4>
              <p>{{ review.example || '尚未补充具体例子' }}</p>
            </div>
            <div v-if="review.remaining" class="read-field">
              <h4>仍然需要一起面对</h4>
              <p>{{ review.remaining }}</p>
            </div>
            <div v-if="review.adjustments" class="read-field">
              <h4>我想调整的地方</h4>
              <p>{{ review.adjustments }}</p>
            </div></template
          ></template
        >
        <div v-else class="review-waiting">
          <AppIcon name="clock" :size="24" />
          <p>{{ member.id === session.user?.id ? '写下你观察到的变化吧' : '等对方回头看看' }}</p>
        </div>
      </article>
    </div>
    <form
      v-if="note.status !== 'archived'"
      class="panel content-panel section-block"
      @submit.prevent="submit"
    >
      <h2>{{ mine ? '补充我的这次回访' : '写下我的这次回访' }}</h2>
      <div class="form-grid">
        <label class="field"
          >我觉得改善程度是<select v-model="form.rating" required>
            <option disabled value="">选择最接近的感受</option>
            <option v-for="rating in ratings" :key="rating">{{ rating }}</option>
          </select></label
        ><label class="field"
          >约好的行动做到了吗<select v-model="form.achieved" required>
            <option disabled value="">选择实际执行情况</option>
            <option>已做到</option>
            <option>部分做到</option>
            <option>未做到</option>
            <option>暂不适用</option>
          </select></label
        >
      </div>
      <label class="field"
        >发生了什么具体的变化<textarea
          v-model="form.example"
          maxlength="5000"
          rows="3"
          placeholder="例如：上周改变计划时，对方提前告诉了我，我们一起重新安排了时间。"
        ></textarea>
      </label>
      <div class="form-grid">
        <label class="field"
          >还有哪些问题<textarea
            v-model="form.remaining"
            maxlength="5000"
            rows="3"
            placeholder="有哪些地方，仍然让你觉得困难？"
          ></textarea></label
        ><label class="field"
          >想怎样调整<textarea
            v-model="form.adjustments"
            maxlength="5000"
            rows="3"
            placeholder="如果需要，可以接着提出新的解决方案。"
          ></textarea>
        </label>
      </div>
      <div class="actions end">
        <button class="btn primary" :disabled="busy">
          <AppIcon name="check" :size="17" />{{
            busy ? '正在保存…' : mine ? '更新我的回访' : '保存我的回访'
          }}
        </button>
      </div>
    </form>
    <details v-if="note.status !== 'archived'" class="history-item section-block">
      <summary>
        {{ cycle.reviews.length === 2 ? '再约一个时间，继续回头看看' : '调整这次的回访时间' }}
      </summary>
      <form class="history-content" @submit.prevent="schedule">
        <label class="field"
          >回访时间<input v-model="dueAt" type="datetime-local" required
        /></label>
        <p class="form-hint">
          {{
            cycle.reviews.length === 2
              ? '双方本轮回访都已保存，安排后将开启新一轮回访，历史内容会保留。'
              : '本轮还有人在填写，调整时间不会清除已经提交的回访。'
          }}
        </p>
        <button class="btn secondary" :disabled="busy">保存回访时间</button>
      </form>
    </details></template
  >
  <section v-if="history.length" class="section-block">
    <h2 class="small-heading">一路走来的回访</h2>
    <details v-for="item in history" :key="item.id" class="history-item">
      <summary>
        约定 V{{ item.version }} · 第 {{ item.number }} 次回访<span class="muted">{{
          dateLabel(item.dueAt)
        }}</span>
      </summary>
      <div class="history-content">
        <div v-for="member in note.space.members" :key="member.id" class="read-field">
          <h3>{{ member.nickname }}</h3>
          <template
            v-for="review in item.reviews.filter((r) => r.userId === member.id)"
            :key="review.id"
            ><p>
              <strong>{{ review.rating }}</strong> · {{ review.achieved }}
            </p>
            <p>{{ review.example }}</p>
            <p v-if="review.remaining">仍有问题：{{ review.remaining }}</p>
            <p v-if="review.adjustments">想调整：{{ review.adjustments }}</p></template
          >
          <p v-if="!item.reviews.some((r) => r.userId === member.id)" class="muted">
            这一轮没有留下回访
          </p>
        </div>
      </div>
    </details>
  </section>
</template>
