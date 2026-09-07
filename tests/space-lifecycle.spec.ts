import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fillEmailVerification } from './email-helper';

const password = 'space-browser-2026';
async function register(page: Page, username: string, nickname: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await page.getByLabel('怎么称呼你').fill(nickname);
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await fillEmailVerification(page, username + '@example.com');
  await page.getByRole('button', { name: '开启我们的小故事' }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function confirm(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.getByLabel('当前密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '确认' + title, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test('后台旧空间查询不能覆盖刚完成的关闭操作', async ({ page }, info) => {
  await register(page, 'sync_' + info.project.name + '_' + Date.now().toString(36), '同步测试');
  await page.goto('/space');
  await page.getByRole('button', { name: '创建共同空间', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭空间', exact: true })).toBeVisible();
  let ready!: () => void;
  let release!: () => void;
  let delivered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(
    '**/api/spaces/current',
    async (route) => {
      const response = await route.fetch();
      ready();
      await gate;
      try {
        await route.fulfill({ response });
      } finally {
        delivered();
      }
    },
    { times: 1 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await waiting;
  await page.getByRole('button', { name: '关闭空间', exact: true }).click();
  await confirm(page, '关闭空间');
  await expect(page.getByRole('button', { name: '创建共同空间', exact: true })).toBeVisible();
  const late = page.waitForResponse((r) => r.url().endsWith('/api/spaces/current'));
  release();
  await finished;
  await (await late).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('button', { name: '关闭空间', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '恢复空间', exact: true })).toBeVisible();
});
test('双人空间关闭后隐藏旧页面，申请、撤回和双方确认恢复', async ({ browser, page }, info) => {
  const suffix = info.project.name + '_' + Date.now().toString(36);
  const otherContext = await browser.newContext({
    ...info.project.use,
    baseURL: 'http://127.0.0.1:5174',
  });
  const partner = await otherContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  partner.on('pageerror', (e) => errors.push(e.message));
  try {
    await register(page, 'sc_a_' + suffix, '小林');
    await register(partner, 'sc_b_' + suffix, '小安');
    await page.goto('/space');
    await page.getByLabel('空间名称').fill('我们的恢复测试空间');
    await page.getByRole('button', { name: '创建共同空间', exact: true }).click();
    await page.getByRole('button', { name: '生成小纸条邀请' }).click();
    const invitation = await page.getByLabel('邀请链接', { exact: true }).inputValue();
    await partner.goto(invitation);
    await partner.getByRole('button', { name: '接受邀请并加入' }).click();
    await expect(partner).toHaveURL(/\/$/);
    const created = await page.request.post('/api/records', {
      data: {
        title: '关闭期间不能显示的纸条',
        description: '只在共同空间开放时可见',
        category: '其他',
      },
    });
    expect(created.status()).toBe(201);
    const note = await created.json();
    expect((await page.request.post('/api/records/' + note.id + '/publish')).status()).toBe(201);
    await partner.goto('/records/' + note.id);
    await expect(partner.getByRole('heading', { name: note.title, exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '解除绑定并关闭空间', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '解除绑定并关闭空间', exact: true });
    await expect(dialog).toContainText('30天');
    await dialog.getByLabel('当前密码', { exact: true }).fill('wrong-password');
    await dialog.getByRole('button', { name: '确认解除绑定并关闭空间' }).click();
    await expect(dialog.getByRole('alert')).toContainText('当前密码不正确');
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('close-space-dialog.png'), fullPage: true });
    await confirm(page, '解除绑定并关闭空间');
    await expect(page.getByRole('button', { name: '创建共同空间', exact: true })).toBeVisible();
    // Focus revalidation clears an already-open partner detail without requiring a reload.
    await partner.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(partner).toHaveURL(/\/space$/);
    await expect(partner.getByRole('heading', { name: note.title, exact: true })).toHaveCount(0);
    expect((await partner.request.get('/api/records/' + note.id)).status()).toBe(404);
    const card = page.getByRole('article', { name: '我们的恢复测试空间' });
    await expect(card).toContainText('删除截止');
    await card.getByRole('button', { name: '申请恢复', exact: true }).click();
    await confirm(page, '申请恢复空间');
    await expect(card).toContainText('等待对方确认恢复');
    await card.getByRole('button', { name: '撤回申请' }).click();
    await expect(card).toContainText('恢复申请已撤回');
    await card.getByRole('button', { name: '申请恢复', exact: true }).click();
    await confirm(page, '申请恢复空间');
    await partner.getByRole('button', { name: '刷新列表' }).click();
    const partnerCard = partner.getByRole('article', { name: '我们的恢复测试空间' });
    await expect(partnerCard).toContainText('对方申请恢复这个空间');
    expect((await partner.request.get('/api/records/' + note.id)).status()).toBe(404);
    await page.screenshot({ path: info.outputPath('closed-space-card.png'), fullPage: true });
    const closedAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(closedAudit.violations).toEqual([]);
    await partnerCard.getByRole('button', { name: '同意恢复', exact: true }).click();
    await confirm(partner, '同意恢复空间');
    await expect(
      partner.getByRole('button', { name: '解除绑定并关闭空间', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(card).toHaveCount(0);
    await partner.goto('/records/' + note.id);
    await expect(partner.getByRole('heading', { name: note.title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
  }
});

test('单人空间关闭与恢复支持键盘，旧请求响应不会重新显示已关闭内容', async ({ page }, info) => {
  await register(page, 'solo_' + info.project.name + '_' + Date.now().toString(36), '一个人');
  await page.goto('/space');
  await page.getByRole('button', { name: '创建共同空间', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭空间', exact: true })).toBeVisible();
  const space = await (await page.request.get('/api/spaces/current')).json();
  const note = await (
    await page.request.post('/api/records', {
      data: { title: '迟到响应里的私密草稿', category: '其他', description: '' },
    })
  ).json();
  let received!: () => void;
  let release!: () => void;
  let delivered!: () => void;
  const entered = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route('**/api/records?*', async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    try {
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  await page.goto('/records');
  await entered;
  expect(
    (
      await page.request.post('/api/spaces/' + space.id + '/close', {
        data: { currentPassword: password, lifecycleVersion: space.lifecycleVersion },
      })
    ).status(),
  ).toBe(201);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/space$/);
  release();
  await finished;
  await page.unroute('**/api/records?*');
  await expect(page.getByText(note.title, { exact: true })).toHaveCount(0);
  const restore = page.getByRole('button', { name: '恢复空间', exact: true });
  await restore.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '恢复空间', exact: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await restore.click();
  await confirm(page, '恢复空间');
  await expect(page.getByRole('button', { name: '关闭空间', exact: true })).toBeVisible();
  await page.goto('/records/' + note.id);
  await expect(page.getByRole('heading', { name: note.title, exact: true })).toBeVisible();
});
