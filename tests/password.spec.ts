import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('修改密码、退出所有设备并用新密码重新登录', async ({ page, browser }, testInfo) => {
  const username = `pwd_${testInfo.project.name}_${Date.now().toString(36)}`;
  const oldPassword = 'browser-old-password-1';
  const newPassword = `Ab1${'x'.repeat(29)}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const registration = await page.request.post('/api/auth/register', {
    data: { username, nickname: '账号安全测试', password: oldPassword },
  });
  expect(registration.status()).toBe(201);
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:5174' });
  try {
    expect(
      (
        await second.request.post('/api/auth/login', { data: { username, password: oldPassword } })
      ).status(),
    ).toBe(200);
    const otherPage = await second.newPage();
    await otherPage.goto('/space');
    await page.goto('/space');
    const open = page.getByRole('button', { name: '修改密码', exact: true });
    await open.click();
    const dialog = page.getByRole('dialog', { name: '修改密码', exact: true });
    const current = dialog.getByLabel('当前密码', { exact: true });
    const next = dialog.getByLabel('新密码', { exact: true });
    const confirm = dialog.getByLabel('确认新密码', { exact: true });
    await expect(current).toHaveAttribute('maxlength', '128');
    await current.fill('X'.repeat(128));
    expect(await current.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
    for (const field of [next, confirm]) {
      await expect(field).toHaveAttribute('maxlength', '32');
      for (const invalid of ['abcdefgh', '12345678', 'Abcd123']) {
        await field.fill(invalid);
        expect(await field.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(
          false,
        );
      }
    }
    await current.fill(oldPassword);
    await next.fill(newPassword);
    await confirm.fill('different-password-1');
    for (const label of ['当前密码', '新密码', '确认新密码']) {
      await expect(dialog.getByLabel(label, { exact: true })).toHaveAttribute('type', 'password');
      await dialog.getByRole('button', { name: `显示${label}`, exact: true }).click();
      await expect(dialog.getByLabel(label, { exact: true })).toHaveAttribute('type', 'text');
      await dialog.getByRole('button', { name: `隐藏${label}`, exact: true }).click();
    }
    let submissions = 0;
    page.on('request', (req) => {
      if (req.url().endsWith('/auth/password/change')) submissions++;
    });
    await dialog.getByRole('button', { name: '确认修改' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('两次输入的新密码不一致');
    expect(submissions).toBe(0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await open.click();
    await expect(current).toHaveValue('');
    await current.fill('wrong-password');
    await next.fill(newPassword);
    await confirm.fill(newPassword);
    await dialog.getByRole('button', { name: '确认修改' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('当前密码不正确');
    await expect(page).toHaveURL(/\/space$/);
    expect((await second.request.get('/api/auth/me')).status()).toBe(200);
    await current.fill(oldPassword);

    await page.route('**/api/auth/password/change', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '暂时无法修改，请重试' }),
      }),
    );
    await dialog.getByRole('button', { name: '确认修改' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('暂时无法修改，请重试');
    await expect(current).toHaveValue(oldPassword);
    await page.unroute('**/api/auth/password/change');
    await page.screenshot({ path: testInfo.outputPath('password-dialog.png'), fullPage: true });
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/auth/password/change', async (route) => {
      await pending;
      await route.continue();
    });
    await dialog.getByRole('button', { name: '确认修改' }).click();
    await expect(dialog.getByRole('button', { name: '正在修改…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    release();
    await expect(page).toHaveURL(/\/login\?passwordChanged=1$/);
    expect(submissions).toBe(3);
    await expect(page.getByRole('status')).toContainText('密码已修改');
    expect((await second.request.get('/api/auth/me')).status()).toBe(401);
    // An already-open device receives the same login-expired behavior when it submits.
    await otherPage.getByRole('button', { name: '修改密码', exact: true }).click();
    await otherPage.getByLabel('当前密码', { exact: true }).fill(oldPassword);
    await otherPage.getByLabel('新密码', { exact: true }).fill(newPassword);
    await otherPage.getByLabel('确认新密码', { exact: true }).fill(newPassword);
    await otherPage.getByRole('button', { name: '确认修改' }).click();
    await expect(otherPage).toHaveURL(/\/login\?redirect=/);
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: '回到小纸条' }).click();
    await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
    await page.getByLabel('密码', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: '回到小纸条' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/space');
    await expect(page.getByRole('heading', { name: '账号安全', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await second.close();
  }
});

test('注册与登录使用各自的密码规则，注册校验失败不发送请求', async ({ page }, testInfo) => {
  await page.goto('/login');
  const password = page.getByLabel('密码', { exact: true });
  await expect(password).toHaveAttribute('maxlength', '128');
  for (const legacy of ['12345678', 'letters-only', 'X'.repeat(128)]) {
    await password.fill(legacy);
    expect(await password.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
  }
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await page.getByLabel('怎么称呼你').fill('注册规则测试');
  await page
    .getByLabel('用户名', { exact: true })
    .fill(`rule_${testInfo.project.name}_${Date.now().toString(36)}`);
  await expect(password).toHaveAttribute('maxlength', '32');
  await expect(page.locator('#auth-password-hint')).toHaveText(
    '8–32 位，必须同时包含英文字母和数字',
  );
  let submissions = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/auth/register')) submissions++;
  });
  // A long password carried over from the login form must be rejected, not silently changed.
  expect(await password.inputValue()).toHaveLength(128);
  expect(await password.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await page.getByRole('button', { name: '开启我们的小故事' }).click();
  for (const invalid of ['abcdefgh', '12345678', 'Abcd123']) {
    await password.fill(invalid);
    await page.getByRole('button', { name: '开启我们的小故事' }).click();
    expect(await password.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  }
  expect(submissions).toBe(0);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await password.fill('X'.repeat(128));
  expect(await password.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await password.fill('Abcd1234');
  await page.getByRole('button', { name: '开启我们的小故事' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(submissions).toBe(1);
});
