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
import EmailBindingPage from './views/EmailBindingPage.vue';
import PasswordResetPage from './views/PasswordResetPage.vue';
import MockMailPage from './views/MockMailPage.vue';

export function safeRedirect(value: unknown, fallback = '/') {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !/^\/(login|bind-email|forgot-password|dev-mail)([/?#]|$)/.test(value)
    ? value
    : fallback;
}

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/login', component: AuthPage, meta: { public: true, title: '欢迎回来' } },
    {
      path: '/forgot-password',
      component: PasswordResetPage,
      meta: { public: true, title: '找回密码' },
    },
    {
      path: '/bind-email',
      component: EmailBindingPage,
      meta: { standalone: true, title: '验证邮箱' },
    },
    {
      path: '/account/email',
      component: EmailBindingPage,
      meta: { standalone: true, title: '更换邮箱' },
    },
    { path: '/dev-mail', component: MockMailPage, meta: { public: true, title: '本地模拟收件箱' } },
    { path: '/', component: HomePage, meta: { title: '我们的小天地' } },
    { path: '/records', component: RecordsPage, meta: { title: '我们的纸条' } },
    { path: '/records/new', component: RecordForm, meta: { title: '写一张纸条' } },
    { path: '/records/:id', component: RecordDetail, meta: { title: '一起回头看看' } },
    { path: '/agreements', component: AgreementsPage, meta: { title: '共同约定' } },
    { path: '/statistics', component: StatisticsPage, meta: { title: '一起回顾' } },
    { path: '/space', component: SpacePage, meta: { title: '我们的空间' } },
    { path: '/invite/:token', component: InvitePage, meta: { title: '一份小纸条邀请' } },
    { path: '/:pathMatch(.*)*', component: NotFound, meta: { title: '纸条走丢了' } },
  ],
});
router.beforeEach(async (to) => {
  const session = useSession();
  try {
    await session.refresh();
  } catch {
    if (!to.meta.public) return { path: '/login', query: { connection: '1' } };
  }
  if (!to.meta.public && !session.user) return { path: '/login', query: { redirect: to.fullPath } };
  if (session.user?.requiresEmailBinding && to.path !== '/bind-email' && to.path !== '/dev-mail')
    return {
      path: '/bind-email',
      query: { redirect: safeRedirect(to.path === '/login' ? to.query.redirect : to.fullPath) },
    };
  if (to.path === '/bind-email' && session.user && !session.user.requiresEmailBinding)
    return safeRedirect(to.query.redirect);
  if (to.path === '/login' && session.user) return safeRedirect(to.query.redirect);
  document.title = `${to.meta.title || '把彼此放在心上'} · 小纸条`;
});
