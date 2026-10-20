<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import type { Statistics } from '../types';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
const data = ref<Statistics>();
const days = ref(90);
const loading = ref(true);
const error = ref('');
let request = 0;
const maxTrend = computed(() => Math.max(1, ...(data.value?.trend.map((t) => t.count) || [])));
const sortedCategories = computed(() =>
  [...(data.value?.categories || [])].sort((a, b) => b.count - a.count),
);
const showAllCategories = ref(false);
const visibleCategories = computed(() =>
  sortedCategories.value.filter((item) => item.count > 0 || showAllCategories.value),
);
const hiddenCategories = computed(
  () => sortedCategories.value.filter((item) => item.count === 0).length,
);
const insight = computed(() => {
  const d = data.value;
  if (!d || !d.total) return '';
  const top = sortedCategories.value.find((item) => item.count > 0);
  return `最近 ${d.days} 天，你们一起留下 ${d.total} 张纸条${top ? `，聊得最多的是「${top.name}」` : ''}。`;
});
/** 两种范围的横轴单位不同，文案要跟着变。 */
const trendUnit = computed(() =>
  data.value?.bucket === 'month' ? '按自然月统计' : '每周一为一周起点，本周截止今天',
);
function categoryPercent(count: number) {
  const total = data.value?.total || 0;
  return total ? Math.round((count / total) * 100) : 0;
}
/** 横轴标签要短：周桶去掉月前导零，月桶只留月份。 */
function axisLabel(label: string) {
  if (data.value?.bucket === 'month') return `${label.slice(5)}月`;
  const [month, day] = label.split('/');
  return `${Number(month)}/${day}`;
}
/** 把「每个成员的评分分布」转成「每个评分维度下两个人的数量」，便于横向对比。 */
const ratingRows = computed(() => {
  const members = data.value?.ratings || [];
  const names = members[0]?.values || [];
  return names.map((value, index) => ({
    name: value.name,
    total: members.reduce((sum, member) => sum + (member.values[index]?.count || 0), 0),
    values: members.map((member) => ({
      id: member.id,
      count: member.values[index]?.count || 0,
    })),
  }));
});
const ratingMax = computed(() =>
  Math.max(1, ...ratingRows.value.flatMap((row) => row.values.map((value) => value.count))),
);
async function load() {
  const current = ++request;
  loading.value = true;
  error.value = '';
  try {
    const result = await api<Statistics>(`/dashboard/statistics?days=${days.value}`);
    if (current === request) data.value = result;
  } catch (e) {
    if (current === request) error.value = (e as Error).message;
  } finally {
    if (current === request) loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">GROWING TOGETHER</span>
      <h1>一起回顾</h1>
      <p>看看我们走过的路，找到下一步可以一起努力的方向。</p>
    </div>
    <select v-model="days" aria-label="统计时间范围" @change="load">
      <option :value="30">最近 30 天</option>
      <option :value="90">最近 90 天</option>
      <option :value="365">最近一年</option>
    </select>
  </div>
  <LoadingState v-if="loading" text="正在回顾我们走过的路…" />
  <ErrorState v-else-if="error" :message="error" @retry="load" />
  <template v-else-if="data"
    ><p v-if="insight" class="insight">{{ insight }}</p>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon sage-bg"><AppIcon name="note" /></div>
        <div>
          <span>这段时间的共享纸条</span><strong>{{ data.total }}<small>张</small></strong>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon peach-bg"><AppIcon name="link" /></div>
        <div>
          <span>值得再留意的重复主题</span
          ><strong>{{ data.recurring.length }}<small>组</small></strong>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow-bg"><AppIcon name="archive" /></div>
        <div>
          <span>一起结束跟进的纸条</span><strong>{{ data.archived }}<small>张</small></strong>
        </div>
      </div>
    </div>
    <div class="analytics-grid">
      <section class="panel content-panel">
        <h2>记录的足迹</h2>
        <p class="section-description">按发生时间统计的共享纸条数量，{{ trendUnit }}</p>
        <div
          v-if="data.total"
          class="bar-chart"
          role="img"
          tabindex="0"
          :aria-label="data.trend.map((t) => `${t.label}：${t.count}张`).join('，')"
        >
          <div v-for="item in data.trend" :key="item.label" class="chart-column">
            <div class="chart-track">
              <div
                v-if="item.count"
                class="chart-bar"
                :style="{ height: `${(item.count / maxTrend) * 100}%` }"
              >
                <span class="chart-value">{{ item.count }}</span>
              </div>
            </div>
            <small>{{ axisLabel(item.label) }}</small>
          </div>
        </div>
        <EmptyState
          v-else
          icon="chart"
          title="这里会留下我们走过的足迹"
          description="有了共享记录后，就可以看到这段时间的变化。"
        />
      </section>
      <section class="panel content-panel">
        <h2>我们常聊到的事</h2>
        <p class="section-description">按主要分类汇总，每张纸条计入一个分类</p>
        <div class="category-bars">
          <div
            v-for="item in visibleCategories"
            :key="item.name"
            :class="['category-bar', { 'is-zero': item.count === 0 }]"
          >
            <span>{{ item.name }}</span>
            <div>
              <i :style="{ width: `${categoryPercent(item.count)}%` }"></i>
            </div>
            <strong>{{ item.count }} 张</strong>
          </div>
          <button
            v-if="hiddenCategories"
            class="text-button more-toggle"
            @click="showAllCategories = !showAllCategories"
          >
            {{ showAllCategories ? '只看有记录的分类' : `展开其余 ${hiddenCategories} 个分类` }}
          </button>
        </div>
      </section>
    </div>
    <section class="section-block">
      <div class="section-heading"><h2>改变，在我们各自的感受里</h2></div>
      <p class="section-description">
        汇总这段时间内提交或更新的回访，每人每轮计一次，保留彼此的不同感受。
      </p>
      <div class="panel content-panel rating-compare">
        <div class="rating-head">
          <span class="rating-head-label">评分维度</span>
          <span v-for="(member, index) in data.ratings" :key="member.id" class="rating-head-member">
            <i :class="`legend-${index}`"></i>{{ member.nickname }}
            <small>{{ member.total }} 次</small>
          </span>
        </div>
        <div
          v-for="row in ratingRows"
          :key="row.name"
          :class="['rating-compare-row', { 'is-zero': row.total === 0 }]"
        >
          <span class="rating-compare-label">{{ row.name }}</span>
          <div v-for="(value, index) in row.values" :key="value.id" class="rating-cell">
            <div class="rating-cell-track">
              <i
                :class="`fill-${index}`"
                :style="{ width: `${(value.count / ratingMax) * 100}%` }"
              ></i>
            </div>
            <b>{{ value.count }}</b>
          </div>
        </div>
        <p v-if="!data.ratings.some((member) => member.total)" class="form-hint">
          还没有留下回访，等一个合适的时间再回来看看。
        </p>
      </div>
    </section>
    <section class="section-block">
      <div class="section-heading"><h2>也许值得再聊聊的事</h2></div>
      <p class="section-description">
        根据你们主动关联的纸条整理。显示本期涉及的主题，以及该主题关联的历史记录。
      </p>
      <div v-if="data.recurring.length" class="recurring-list">
        <article v-for="group in data.recurring" :key="group.title" class="panel content-panel">
          <div class="section-heading">
            <h3>{{ group.title }}</h3>
            <span class="badge review">{{ group.count }} 张关联纸条</span>
          </div>
          <RouterLink
            v-for="record in group.records"
            :key="record.id"
            :to="`/records/${record.id}`"
            class="related-row"
            ><AppIcon name="link" :size="16" /><span>{{ record.title }}</span
            ><AppIcon name="arrowUp" :size="16"
          /></RouterLink>
        </article>
      </div>
      <div v-else class="panel">
        <EmptyState
          icon="leaf"
          title="暂时没有关联的重复主题"
          description="再次遇到类似情况时，把新旧纸条连起来，就能看到之前试过的办法。"
        />
      </div></section
  ></template>
</template>
