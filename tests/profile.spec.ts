import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fillEmailVerification } from './email-helper';

test('编辑昵称、裁剪头像和恢复默认头像', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await page.getByLabel('怎么称呼你').fill('头像测试');
  await page
    .getByLabel('用户名', { exact: true })
    .fill(`avatar_${testInfo.project.name}_${Date.now().toString(36)}`);
  await page.getByLabel('密码', { exact: true }).fill('profile-browser-2026');
  await fillEmailVerification(page, `profile-${testInfo.project.name}-${Date.now()}@example.com`);
  await page.getByRole('button', { name: '开启我们的小故事' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/space');
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '我的小名片', exact: true }) });
  await page.getByRole('button', { name: '修改昵称' }).click();
  await page.getByLabel('昵称', { exact: true }).fill('  新的小纸条  ');
  await page.getByRole('button', { name: '保存昵称' }).click();
  await expect(card.getByRole('heading', { name: '新的小纸条', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修改昵称' }).click();
  await page.getByLabel('昵称', { exact: true }).fill('取消的昵称');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(card).not.toContainText('取消的昵称');

  const fixture = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#738570';
      ctx.fillRect(0, 0, 300, 400);
      ctx.fillStyle = '#d3a488';
      ctx.fillRect(300, 0, 300, 400);
      ctx.fillStyle = '#fffefb';
      ctx.beginPath();
      ctx.arc(300, 200, 80, 0, 2 * Math.PI);
      ctx.fill();
      return canvas.toDataURL('image/png').split(',')[1]!;
    }),
    'base64',
  );
  const upload = page.getByLabel('选择头像图片');
  await upload.setInputFiles({ name: '头像.png', mimeType: 'image/png', buffer: fixture });
  const dialog = page.getByRole('dialog', { name: '调整头像' });
  await expect(dialog.getByRole('button', { name: '保存头像' })).toBeEnabled();
  const range = page.getByRole('slider', { name: '缩放头像' });
  await range.focus();
  await range.press('End');
  await expect(range).toHaveValue('3');
  const crop = page.getByRole('img', { name: '头像裁剪区域' });
  await crop.focus();
  const original = await crop.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await crop.press('ArrowLeft');
  const moved = await crop.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(moved).not.toBe(original);
  const box = (await crop.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  expect(await crop.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(moved);
  await page.screenshot({ path: testInfo.outputPath('avatar-crop.png'), fullPage: true });
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(audit.violations).toEqual([]);

  // The editor must remain open after a server failure so the user can retry.
  await page.route('**/api/users/me/avatar', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '暂时无法上传，请重试' }),
    }),
  );
  await dialog.getByRole('button', { name: '保存头像' }).click();
  await expect(dialog.getByRole('alert')).toContainText('暂时无法上传');
  await expect(dialog).toBeVisible();
  await page.unroute('**/api/users/me/avatar');
  await dialog.getByRole('button', { name: '保存头像' }).click();
  await expect(dialog).toHaveCount(0);
  const avatar = card.locator('.profile-avatar-button img');
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(256);
  await page.reload();
  await expect(card.getByRole('heading', { name: '新的小纸条', exact: true })).toBeVisible();
  await expect(avatar).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('profile-saved.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await upload.setInputFiles({
    name: '坏图.png',
    mimeType: 'image/png',
    buffer: Buffer.from('invalid image'),
  });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存头像' })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(avatar).toBeVisible();
  await page.getByRole('button', { name: '恢复默认头像', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(avatar).toHaveCount(0);
  await expect(card.locator('.profile-avatar-button')).toHaveText('新');
  await page.reload();
  await expect(avatar).toHaveCount(0);
  expect(errors).toEqual([]);
});
