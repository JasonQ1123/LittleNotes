import { expect, type APIRequestContext, type Page } from '@playwright/test';
export async function inboxCode(request: APIRequestContext, challengeId: string) {
  let code = '';
  await expect
    .poll(async () => {
      const inbox = await (await request.get('/api/dev/mail')).json();
      code = inbox.find((m: { challengeId: string }) => m.challengeId === challengeId)?.code || '';
      return code;
    })
    .toMatch(/^[0-9]{6}$/);
  return code;
}
export async function apiEmailProof(request: APIRequestContext, email: string) {
  const response = await request.post('/api/auth/register/code', { data: { email } });
  expect(response.status()).toBe(200);
  const { challengeId } = await response.json();
  return { email, challengeId, code: await inboxCode(request, challengeId) };
}
export async function fillEmailVerification(
  page: Page,
  email: string,
  endpoint = '/api/auth/register/code',
) {
  await page.getByLabel('邮箱地址', { exact: true }).fill(email);
  const send = async () => {
    const sent = page.waitForResponse(
      (r) => r.url().endsWith(endpoint) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '获取验证码', exact: true }).click();
    return sent;
  };
  let response = await send();
  // A just-registered address may still be in the one-second E2E cooldown.
  // Exercise the visible retry countdown rather than weakening server limits.
  if (response.status() === 429) {
    expect((await response.json()).retryAfter).toBeLessThanOrEqual(1);
    await expect(page.getByRole('alert')).toContainText('申请较频繁');
    await expect(page.getByRole('button', { name: '获取验证码', exact: true })).toBeEnabled();
    response = await send();
  }
  expect(response.status()).toBe(200);
  const { challengeId } = await response.json();
  const code = await inboxCode(page.request, challengeId);
  await page.getByLabel('邮箱验证码', { exact: true }).fill(code);
  return { email, challengeId, code };
}
