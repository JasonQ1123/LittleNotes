import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { apiEmailProof, fillEmailVerification } from './email-helper';

test('旧账号强制绑定并回到原页面，更换邮箱后退出所有设备', async ({ page, browser }, testInfo) => {
  const username = `email_legacy_${testInfo.project.name}`;
  const password = 'X'.repeat(128);
  const email = `legacy-${testInfo.project.name}-${Date.now()}@example.com`;
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:5174' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('/space');
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    const loggedIn = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '回到小纸条' }).click();
    expect((await loggedIn).status()).toBe(200);
    await expect(page).toHaveURL(/\/bind-email\?redirect=/);
    await expect(page.getByRole('heading', { name: '先为账号绑定邮箱' })).toBeVisible();
    expect((await page.request.get('/api/spaces/current')).status()).toBe(403);
    await page.reload();
    await expect(page).toHaveURL(/\/bind-email/);
    await second.request.post('/api/auth/login', { data: { username, password } });
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    await fillEmailVerification(page, email, '/api/auth/email/code');
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('bind-email.png'), fullPage: true });
    const bound = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/email') && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '验证并继续' }).click();
    expect((await bound).status()).toBe(200);
    await expect(page).toHaveURL(/\/space$/);
    expect((await second.request.get('/api/auth/me')).status()).toBe(401);
    await expect(page.getByRole('heading', { name: '保留的旧昵称', exact: true })).toBeVisible();
    await expect(page.locator('.security-email')).toContainText('l***@example.com');
    await second.request.post('/api/auth/login', { data: { username, password } });
    await page.getByRole('link', { name: '更换邮箱', exact: true }).click();
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    const nextEmail = `changed-${testInfo.project.name}-${Date.now()}@example.com`;
    await fillEmailVerification(page, nextEmail, '/api/auth/email/code');
    const replaced = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/email') && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '确认更换邮箱' }).click();
    expect((await replaced).status()).toBe(200);
    await expect(page).toHaveURL(/\/login\?emailChanged=1$/);
    await expect(page.getByRole('status')).toContainText('邮箱已更换');
    expect((await second.request.get('/api/auth/me')).status()).toBe(401);
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    const relogged = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '回到小纸条' }).click();
    expect((await relogged).status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/space');
    await expect(page.locator('.security-email')).toContainText('c***@example.com');
    expect(errors).toEqual([]);
  } finally {
    await second.close();
  }
});

test('邮箱找回密码：显示隐藏、错误码、失败重试和所有设备退出', async ({
  page,
  browser,
}, testInfo) => {
  const username = `reset_${testInfo.project.name}_${Date.now().toString(36)}`;
  const email = `${username}@example.com`;
  const password = 'recovery-original-1';
  const nextPassword = 'recovery-new-2';
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:5174' });
  try {
    const proof = await apiEmailProof(second.request, email);
    expect(
      (
        await second.request.post('/api/auth/register', {
          data: { username, nickname: '找回测试', password, ...proof },
        })
      ).status(),
    ).toBe(201);
    await page.goto('/login');
    await page.getByRole('link', { name: '忘记密码？' }).click();
    const input = await fillEmailVerification(page, email, '/api/auth/password/reset/code');
    await expect(page.getByRole('status')).toContainText('如该邮箱已绑定账号，将收到验证码');
    for (const label of ['新密码', '确认新密码']) {
      const field = page.getByLabel(label, { exact: true });
      await field.fill(nextPassword);
      await expect(field).toHaveAttribute('maxlength', '32');
      await page.getByRole('button', { name: `显示${label}`, exact: true }).click();
      await expect(field).toHaveAttribute('type', 'text');
      await page.getByRole('button', { name: `隐藏${label}`, exact: true }).click();
      await expect(field).toHaveAttribute('type', 'password');
    }
    await page.getByLabel('确认新密码', { exact: true }).fill('different-password-1');
    await page.getByRole('button', { name: '重置密码', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('两次输入的新密码不一致');
    await page.getByLabel('确认新密码', { exact: true }).fill(nextPassword);
    await page
      .getByLabel('邮箱验证码', { exact: true })
      .fill(input.code === '000000' ? '000001' : '000000');
    await page.getByRole('button', { name: '重置密码', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('验证码无效或已过期');
    await page.getByLabel('邮箱验证码', { exact: true }).fill(input.code);
    await page.route('**/api/auth/password/reset', (r) =>
      r.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '暂时无法重置，请重试' }),
      }),
    );
    await page.getByRole('button', { name: '重置密码', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('暂时无法重置，请重试');
    await page.unroute('**/api/auth/password/reset');
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('reset-password.png'), fullPage: true });
    await page.getByRole('button', { name: '重置密码', exact: true }).click();
    await expect(page).toHaveURL(/\/login\?passwordChanged=1$/);
    expect((await second.request.get('/api/auth/me')).status()).toBe(401);
    expect(
      (await second.request.post('/api/auth/login', { data: { username, password } })).status(),
    ).toBe(401);
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: '回到小纸条' }).click();
    await expect(page).toHaveURL(/\/$/);
  } finally {
    await second.close();
  }
});
