<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from './store';
import { toast, notify } from './api';
import AppIcon from './components/AppIcon.vue';
const session = useSession();
const route = useRoute();
const router = useRouter();
const nav = [
  { to: '/', label: '我们的小天地', icon: 'home' },
  { to: '/records', label: '矛盾记录', icon: 'note' },
  { to: '/agreements', label: '共同约定', icon: 'agreement' },
  { to: '/statistics', label: '回顾统计', icon: 'chart' },
] as const;
const today = new Date().toLocaleDateString('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});
const partner = computed(() => session.space?.members.find((m) => m.id !== session.user?.id));
function expired() {
  session.expire();
  notify('登录已过期，请重新登录', true);
  router.replace({ path: '/login', query: { redirect: route.fullPath } });
}
onMounted(() => window.addEventListener('session-expired', expired));
onBeforeUnmount(() => window.removeEventListener('session-expired', expired));
</script>
<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div v-if="route.meta.public" class="public-layout"><RouterView /></div>
  <div v-else class="app-layout">
    <aside class="sidebar">
      <RouterLink to="/" class="brand"
        ><span class="brand-mark"><AppIcon name="note" :size="26" /></span
        ><span>小纸条<small>把彼此放在心上</small></span></RouterLink
      >
      <div class="sidebar-label">我们的故事</div>
      <nav aria-label="主要导航">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :class="[
            'nav-item',
            { active: item.to === '/' ? route.path === '/' : route.path.startsWith(item.to) },
          ]"
          ><AppIcon :name="item.icon" /><span>{{ item.label }}</span
          ><span v-if="item.to === '/records'" class="nav-dot"></span
        ></RouterLink>
      </nav>
      <div class="sidebar-note">
        <AppIcon name="leaf" :size="24" />
        <p>慢慢说，好好听。<br />每一小步，都算数。</p>
        <span class="little-line"></span>
      </div>
      <RouterLink to="/space" class="space-link"
        ><div class="avatar-pair">
          <span class="avatar">{{ session.user?.nickname.slice(0, 1) || '我' }}</span
          ><span class="avatar peach">{{ partner?.nickname.slice(0, 1) || '+' }}</span>
        </div>
        <div>
          <strong>{{ session.space?.name || '建立我们的空间' }}</strong
          ><small>{{ partner ? '两个人，一起慢慢来' : '等一个人，一起写下去' }}</small>
        </div>
        <AppIcon name="settings" :size="17"
      /></RouterLink>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <span class="breadcrumb">小纸条 <span>/</span> {{ route.meta.title }}</span
        ><span class="top-date"><AppIcon name="calendar" :size="16" />{{ today }}</span
        ><RouterLink
          to="/space"
          class="avatar user-avatar"
          :aria-label="`${session.user?.nickname || '我的'}账号`"
          >{{ session.user?.nickname.slice(0, 1) }}</RouterLink
        >
      </header>
      <main id="main-content" class="main-content"><RouterView :key="route.path" /></main>
      <footer class="page-footer">
        <AppIcon name="heart" :size="13" />把心事写下来，把彼此放在心上。
      </footer>
    </div>
    <nav class="mobile-nav" aria-label="手机导航">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        :class="{ active: item.to === '/' ? route.path === '/' : route.path.startsWith(item.to) }"
        ><AppIcon :name="item.icon" :size="21" /><span>{{
          item.to === '/' ? '首页' : item.label
        }}</span></RouterLink
      ><RouterLink to="/space" :class="{ active: route.path === '/space' }"
        ><AppIcon name="users" :size="21" /><span>我们</span></RouterLink
      >
    </nav>
  </div>
  <Transition name="toast"
    ><div
      v-if="toast"
      :class="['toast-message', { error: toast.error }]"
      :role="toast.error ? 'alert' : 'status'"
    >
      <AppIcon :name="toast.error ? 'help' : 'complete'" :size="20" /><span>{{
        toast.message
      }}</span
      ><button class="icon-button" aria-label="关闭提示" @click="toast = null">
        <AppIcon name="close" :size="16" />
      </button></div
  ></Transition>
</template>
