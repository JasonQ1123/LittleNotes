import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './store';
import AuthPage from './views/AuthPage.vue';
import HomePage from './views/HomePage.vue';
import RecordsPage from './views/RecordsPage.vue';
import RecordForm from './views/RecordForm.vue';
import RecordDetail from './views/RecordDetail.vue';
import AgreementsPage from './views/AgreementsPage.vue';
import StatisticsPage from './views/StatisticsPage.vue';
import SpacePage from './views/SpacePage.vue';
import InvitePage from './views/InvitePage.vue';
import NotFound from './views/NotFound.vue';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/login', component: AuthPage, meta: { public: true, title: '欢迎回来' } },
    { path: '/', component: HomePage, meta: { title: '我们的小天地' } },
    { path: '/records', component: RecordsPage, meta: { title: '矛盾记录' } },
    { path: '/records/new', component: RecordForm, meta: { title: '写一张纸条' } },
    { path: '/records/:id', component: RecordDetail, meta: { title: '一起回头看看' } },
    { path: '/agreements', component: AgreementsPage, meta: { title: '共同约定' } },
    { path: '/statistics', component: StatisticsPage, meta: { title: '回顾统计' } },
    { path: '/space', component: SpacePage, meta: { title: '我们的空间' } },
    { path: '/invite/:token', component: InvitePage, meta: { title: '一份小纸条邀请' } },
    { path: '/:pathMatch(.*)*', component: NotFound, meta: { title: '纸条走丢了' } },
  ],
});
router.beforeEach(async (to) => {
  const session = useSession();
  try {
    await session.ensure();
  } catch {
    if (!to.meta.public) return { path: '/login', query: { connection: '1' } };
  }
  if (!to.meta.public && !session.user) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.path === '/login' && session.user) return '/';
  document.title = `${to.meta.title || '把彼此放在心上'} · 小纸条`;
});
