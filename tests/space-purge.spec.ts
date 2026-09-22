import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { apiEmailProof } from './email-helper';
import type { ClosedSpace } from '../apps/web/src/types';

const password = 'purge-browser-2026';
const finalTitle = '最后确认：删除后无法恢复';
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function register(page: Page, suffix: string) {
  const username = 'del_' + suffix + '_' + Date.now().toString(36);
  const proof = await apiEmailProof(page.request, username + '@example.com');
  expect(
    (
      await page.request.post('/api/auth/register', {
        data: { username, nickname: '原空间成员', password, ...proof },
      })
    ).status(),
  ).toBe(201);
}
async function finalConfirmation(page: Page, name: string) {
  await page
    .getByRole('article', { name, exact: true })
    .getByRole('button', { name: '彻底删除', exact: true })
    .click();
  const warning = page.getByRole('dialog', { name: `彻底删除「${name}」？`, exact: true });
  await expect(warning).toBeVisible();
  expect(await warning.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await warning.getByRole('button', { name: '继续删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: finalTitle, exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  return dialog;
}
const fakeUser = {
  id: 'purge-ui-member',
  username: 'purge_ui',
  nickname: '原成员',
  avatarUrl: null,
  requiresEmailBinding: false,
  maskedEmail: 'p***@example.com',
  spaceId: null,
};
function card(id: string, name = '已关闭的测试空间'): ClosedSpace {
  return {
    id,
    name,
    lifecycleVersion: 2,
    closedAt: new Date().toISOString(),
    purgeAt: new Date(Date.now() + 86400_000).toISOString(),
    members: [{ id: fakeUser.id, nickname: fakeUser.nickname, avatarUrl: null }],
    canRestore: false,
    restoreRequest: null,
  };
}
async function mockSession(page: Page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: fakeUser }));
  await page.route('**/api/spaces/current', (route) => route.fulfill({ json: null }));
}

test('彻底删除需要两次警告和密码，支持取消、键盘、无障碍和防重复提交', async ({ page }, info) => {
  await register(page, 'solo_' + info.project.name);
  const space = await (
    await page.request.post('/api/spaces', { data: { name: '永久删除交互测试' } })
  ).json();
  expect(
    (
      await page.request.post(`/api/spaces/${space.id}/close`, {
        data: { currentPassword: password, lifecycleVersion: space.lifecycleVersion },
      })
    ).status(),
  ).toBe(201);
  await page.goto('/space');
  const target = page.getByRole('article', { name: space.name, exact: true });
  const trigger = target.getByRole('button', { name: '彻底删除', exact: true });
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/purge')) requests++;
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const warning = page.getByRole('dialog', { name: `彻底删除「${space.name}」？`, exact: true });
  await expect(warning).toContainText('双方都无法恢复');
  await expect(warning.getByRole('button', { name: '再想想' })).toBeFocused();
  await page.screenshot({ path: info.outputPath('purge-first-warning.png') });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(warning).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await warning.getByRole('button', { name: '再想想' }).click();
  await expect(trigger).toBeFocused();
  let dialog = await finalConfirmation(page, space.name);
  await expect(dialog).toContainText(space.name);
  await expect(dialog).toContainText('恢复申请也会失效');
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await dialog.getByLabel('当前密码', { exact: true }).fill(password);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  dialog = await finalConfirmation(page, space.name);
  await expect(dialog.getByLabel('当前密码', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(requests).toBe(0);
  dialog = await finalConfirmation(page, space.name);
  await dialog.getByLabel('当前密码', { exact: true }).fill('wrong-password');
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('当前密码不正确');
  await expect(target).toHaveCount(1);
  expect(requests).toBe(1);
  await page.screenshot({ path: info.outputPath('purge-password-warning.png') });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  const entered = gate();
  const release = gate();
  await page.route(`**/api/spaces/${space.id}/purge`, async (route) => {
    entered.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await dialog.getByLabel('当前密码', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: '永久删除', exact: true }).focus();
    await page.keyboard.press('Enter');
    await entered.promise;
    await expect(dialog.getByRole('button', { name: '正在处理…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('当前密码', { exact: true })).toBeDisabled();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    expect(requests).toBe(2);
  } finally {
    release.resolve();
  }
  await expect(dialog).toHaveCount(0);
  await expect(target).toHaveCount(0);
  await expect(page.getByText('空间已永久删除，无法恢复', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新列表' })).toBeFocused();
  expect((await (await page.request.get('/api/spaces/closed')).json()).total).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('另一原成员可在恢复申请待确认时删除，双方列表同步移除', async ({ page, browser }, info) => {
  const other = await browser.newContext({ ...info.project.use, baseURL: 'http://127.0.0.1:5174' });
  const partner = await other.newPage();
  try {
    await register(page, 'a_' + info.project.name);
    await register(partner, 'b_' + info.project.name);
    const space = await (
      await page.request.post('/api/spaces', { data: { name: '双方永久删除测试' } })
    ).json();
    const invitation = await (await page.request.post('/api/spaces/invitations')).json();
    expect(
      (
        await partner.request.post('/api/spaces/invitations/accept', {
          data: { token: invitation.token },
        })
      ).status(),
    ).toBe(201);
    const note = await (
      await page.request.post('/api/records', { data: { title: '被彻底删除的共同纸条' } })
    ).json();
    expect((await page.request.post('/api/records/' + note.id + '/publish')).status()).toBe(201);
    const closed = await (
      await page.request.post(`/api/spaces/${space.id}/close`, {
        data: { currentPassword: password, lifecycleVersion: space.lifecycleVersion },
      })
    ).json();
    expect(
      (
        await page.request.post(`/api/spaces/${space.id}/restore-requests`, {
          data: { currentPassword: password, lifecycleVersion: closed.lifecycleVersion },
        })
      ).status(),
    ).toBe(201);
    await page.goto('/space');
    await partner.goto('/space');
    const originalCard = page.getByRole('article', { name: space.name, exact: true });
    await expect(originalCard).toContainText('等待对方确认恢复');
    const partnerCard = partner.getByRole('article', { name: space.name, exact: true });
    await expect(partnerCard.getByRole('button', { name: '同意恢复', exact: true })).toBeEnabled();
    const dialog = await finalConfirmation(partner, space.name);
    await dialog.getByLabel('当前密码', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
    await expect(partnerCard).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(originalCard).toHaveCount(0);
    expect((await page.request.get('/api/records/' + note.id)).status()).toBe(404);
    expect((await partner.request.get('/api/records/' + note.id)).status()).toBe(404);
  } finally {
    await other.close();
  }
});

test('删除不依赖恢复资格，立即丢弃旧列表响应并回退空分页', async ({ page }) => {
  await mockSession(page);
  const items = Array.from({ length: 21 }, (_, i) => card('closed-' + i, '分页空间' + i));
  const target = items[20];
  target.name = 'W'.repeat(40);
  let holdList = false;
  let holdSession = false;
  const listEntered = gate(),
    listRelease = gate(),
    listDelivered = gate();
  const sessionEntered = gate(),
    sessionRelease = gate();
  await page.route('**/api/auth/me', async (route) => {
    if (holdSession) {
      sessionEntered.resolve();
      await sessionRelease.promise;
    }
    await route.fulfill({ json: fakeUser });
  });
  await page.route('**/api/spaces/closed?*', async (route) => {
    const currentPage = Number(new URL(route.request().url()).searchParams.get('page'));
    const json = {
      items: items.slice((currentPage - 1) * 20, currentPage * 20),
      total: items.length,
      page: currentPage,
      pageSize: 20,
    };
    const delayed = holdList;
    holdList = false;
    if (delayed) {
      listEntered.resolve();
      await listRelease.promise;
    }
    await route.fulfill({ json });
    if (delayed) listDelivered.resolve();
  });
  await page.route(`**/api/spaces/${target.id}/purge`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      currentPassword: password,
      lifecycleVersion: 2,
    });
    items.pop();
    await route.fulfill({ status: 201, json: { ok: true } });
  });
  try {
    await page.goto('/space');
    await page.getByRole('button', { name: '下一页' }).click();
    const targetCard = page.getByRole('article', { name: target.name, exact: true });
    await expect(targetCard.getByRole('button', { name: '恢复空间', exact: true })).toBeDisabled();
    await expect(targetCard.getByRole('button', { name: '彻底删除', exact: true })).toBeEnabled();
    holdList = true;
    await page.getByRole('button', { name: '刷新列表' }).click();
    await listEntered.promise;
    const dialog = await finalConfirmation(page, target.name);
    holdSession = true;
    await dialog.getByLabel('当前密码', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
    await sessionEntered.promise;
    await expect(targetCard).toHaveCount(0);
    listRelease.resolve();
    await listDelivered.promise;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(targetCard).toHaveCount(0);
    sessionRelease.resolve();
    await expect(page.getByRole('article', { name: '分页空间0', exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(20);
    await expect(page.getByRole('button', { name: '上一页' })).toHaveCount(0);
  } finally {
    listRelease.resolve();
    sessionRelease.resolve();
  }
});

test('404及409结束失效删除流程并刷新，重新操作仍需两次确认', async ({ page }) => {
  await page.clock.install();
  await mockSession(page);
  let items: ClosedSpace[] = [];
  let failure = 404;
  let attempts = 0;
  await page.route('**/api/spaces/closed?*', (route) =>
    route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 20 } }),
  );
  await page.route('**/api/spaces/*/purge', async (route) => {
    attempts++;
    items = failure === 409 ? [card('changed', '新关闭版本')] : [];
    await route.fulfill({
      status: failure,
      json: {
        message: '空间状态已变化，请刷新后重试',
        ...(failure === 409 ? { code: 'SPACE_CHANGED' } : {}),
      },
    });
  });
  for (const status of [404, 409]) {
    failure = status;
    items = [card('old', '原关闭版本')];
    await page.goto('/space');
    const dialog = await finalConfirmation(page, items[0].name);
    await dialog.getByLabel('当前密码', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('article', { name: '原关闭版本', exact: true })).toHaveCount(0);
    await expect(page.getByText('空间状态已变化，请刷新后重试', { exact: true })).toBeVisible();
  }
  expect(attempts).toBe(2);
  await page
    .getByRole('article', { name: '新关闭版本', exact: true })
    .getByRole('button', { name: '彻底删除', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: '彻底删除「新关闭版本」？', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: finalTitle, exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
  await page.keyboard.press('Escape');
  // The existing foreground timer also refreshes cards when the current space is unchanged.
  items = [];
  await page.clock.runFor(30_000);
  await expect(page.getByRole('article')).toHaveCount(0);
});
