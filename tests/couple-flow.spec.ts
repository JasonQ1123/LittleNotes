import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function register(page: Page, username: string, nickname: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await page.getByLabel('怎么称呼你').fill(nickname);
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('paper-browser-2026');
  await page.getByRole('button', { name: '开启我们的小故事' }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function publish(page: Page) {
  await page.getByRole('button', { name: '分享到共同空间', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认分享', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.detail-badges')).toContainText('复盘中');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('两个人从一张私密草稿走到约定、回访和归档', async ({ browser, page }, testInfo) => {
  const suffix = `${testInfo.project.name}_${Date.now().toString(36)}`;
  const partnerContext = await browser.newContext({
    ...testInfo.project.use,
    baseURL: 'http://127.0.0.1:5174',
  });
  const partner = await partnerContext.newPage();
  const errors: string[] = [];
  const accessibility: unknown[] = [];
  async function audit(target: Page, name: string) {
    const result = await new AxeBuilder({ page: target })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    for (const issue of result.violations)
      accessibility.push({
        page: name,
        id: issue.id,
        nodes: issue.nodes.map((n) => ({ target: n.target, problem: n.failureSummary })),
      });
  }
  page.on('pageerror', (error) => errors.push(error.message));
  partner.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await audit(page, '登录');
    await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
    await noOverflow(page);
    await register(page, `lin_${suffix}`, '小林');
    await page.getByRole('link', { name: '建立我们的空间', exact: true }).click();
    await page.getByLabel('空间名称').fill('小林与小安的小天地');
    await page.getByRole('button', { name: '创建共同空间', exact: true }).click();
    await expect(page.getByRole('heading', { name: '小林与小安的小天地' })).toBeVisible();
    await page.getByRole('button', { name: '生成小纸条邀请' }).click();
    const invite = await page.getByRole('textbox', { name: '邀请链接', exact: true }).inputValue();
    expect(invite).toMatch(/\/invite\/[a-f0-9]{64}$/);
    await register(partner, `an_${suffix}`, '小安');
    await partner.goto(invite);
    await partner.getByRole('button', { name: '接受邀请并加入' }).click();
    await expect(partner).toHaveURL(/\/$/);

    await page.goto('/');
    await page.getByRole('link', { name: '写一张纸条', exact: true }).click();
    await page.getByLabel(/给这张纸条起个标题/).fill('关于临时改变的周末计划');
    await page.getByLabel('属于哪一类').selectOption('承诺计划');
    await page
      .getByLabel(/发生了什么/)
      .fill('原本约好一起去公园，却临时改变了安排。我们都希望下次能提前说一声。');
    await page.getByLabel(/小标签/).fill('周末，提前沟通');
    await page.getByRole('button', { name: '保存私密草稿' }).click();
    await expect(page).toHaveURL(/\/records\/c[a-z0-9]{20,}$/);
    const noteUrl = page.url();
    const id = noteUrl.split('/').pop()!;
    await page.getByRole('tab', { name: '彼此的感受' }).click();
    await page.getByLabel('我的感受', { exact: true }).fill('还没有准备好分享的心事');
    await page.getByRole('button', { name: '保存我的想法' }).click();
    await expect(page.getByRole('status')).toContainText('想法已保存');
    await partner.goto(noteUrl);
    await expect(partner.getByRole('heading', { name: '暂时无法打开这张纸条' })).toBeVisible();
    await page.getByRole('button', { name: '分享到共同空间', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await publish(page);
    await partner.goto(`${noteUrl}?tab=perspectives`);
    await expect(partner.getByRole('heading', { name: '留一点时间，等对方说说' })).toBeVisible();
    await expect(partner.getByText('还没有准备好分享的心事')).toHaveCount(0);
    await page
      .getByLabel('我的感受', { exact: true })
      .fill('计划突然变化时，我有些失落，希望我们能一起商量。');
    await page.getByLabel('我认为的原因').fill('临时变动让我觉得自己的期待没有被考虑。');
    await page.getByRole('button', { name: '分享我的视角' }).click();
    await expect(page.getByRole('status')).toContainText('你的视角已分享给对方');
    await partner.reload();
    await expect(
      partner.getByText('计划突然变化时，我有些失落，希望我们能一起商量。', { exact: true }),
    ).toBeVisible();
    await partner.getByLabel('我的感受', { exact: true }).fill('我没有及时说明原因，让你担心了。');
    await partner.getByRole('button', { name: '分享我的视角' }).click();
    await expect(partner.getByRole('status')).toContainText('你的视角已分享给对方');

    await page.getByRole('tab', { name: '共同约定', exact: true }).click();
    await page.getByRole('button', { name: '一起商量一个办法', exact: true }).click();
    await page
      .getByLabel('我们对问题的共同理解')
      .fill('我们都需要提前知道计划的变化，也需要感受到自己被认真考虑。');
    await page
      .getByLabel('行动 1', { exact: true })
      .fill('计划变化时尽早告诉对方，一起确认替代方案。');
    await page
      .getByLabel('怎样判断这个办法有用')
      .fill('双方提前知道安排，变化发生时都有参与讨论。');
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 16);
    await page.getByLabel(/什么时候回头看看/).fill(yesterday);
    await page.getByRole('button', { name: '提出这份方案' }).click();
    await page.getByRole('button', { name: '确认这份约定', exact: true }).click();
    await expect(page.getByRole('button', { name: '你已确认，等对方点头' })).toBeDisabled();
    await partner.goto(`${noteUrl}?tab=agreements`);
    await partner.getByRole('button', { name: '确认这份约定', exact: true }).click();
    await expect(partner.getByText('V1 · 已生效', { exact: true })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('link').filter({ hasText: '到时间了，回头看看' })).toHaveCount(1);
    await page.getByRole('link').filter({ hasText: '到时间了，回头看看' }).click();
    await page.getByLabel('我觉得改善程度是').selectOption('明显改善');
    await page.getByLabel('约好的行动做到了吗').selectOption('已做到');
    await page
      .getByLabel('发生了什么具体的变化')
      .fill('这周调整行程前，我们提前沟通，一起安排了新的时间。');
    await page.getByRole('button', { name: '保存我的回访' }).click();
    await expect(page.getByRole('status')).toContainText('回访已记下');
    await page.goto('/');
    await expect(page.getByRole('link').filter({ hasText: '到时间了，回头看看' })).toHaveCount(0);
    await partner.goto('/');
    await partner.getByRole('link').filter({ hasText: '到时间了，回头看看' }).click();
    await partner.getByLabel('我觉得改善程度是').selectOption('部分改善');
    await partner.getByLabel('约好的行动做到了吗').selectOption('部分做到');
    await partner
      .getByLabel('发生了什么具体的变化')
      .fill('开始提前说了，但我希望我们能更明确替代的安排。');
    await partner.getByRole('button', { name: '保存我的回访' }).click();
    await expect(partner.locator('.rating-value')).toHaveCount(2);
    expect((await partner.locator('.rating-value').allTextContents()).sort()).toEqual(
      ['明显改善', '部分改善'].sort(),
    );
    await noOverflow(partner);
    await audit(partner, '回访');
    await partner.screenshot({ path: testInfo.outputPath('reviews.png'), fullPage: true });

    await page.goto('/records/new');
    await page.getByLabel(/给这张纸条起个标题/).fill('再聊聊临时改变的晚餐安排');
    await page.getByLabel('属于哪一类').selectOption('承诺计划');
    await page
      .getByLabel(/发生了什么/)
      .fill('又一次调整了约好的时间，我们想起之前说好的办法，一起重新看看。');
    await page.getByRole('button', { name: '保存私密草稿' }).click();
    await publish(page);
    await page.getByText('关联一张历史纸条', { exact: true }).click();
    await page.getByRole('textbox', { name: '搜索历史纸条' }).fill('周末计划');
    await page.getByRole('button', { name: '查找纸条', exact: true }).click();
    await page
      .locator('.link-search .related-row')
      .getByRole('button', { name: '关联', exact: true })
      .click();
    await expect(page.getByRole('link', { name: /关于临时改变的周末计划/ })).toBeVisible();
    await noOverflow(page);
    await page.goto('/records');
    await page.getByRole('textbox', { name: '搜索纸条', exact: true }).fill('晚餐');
    await page.getByRole('button', { name: '查找', exact: true }).click();
    await expect(page.locator('.record-card')).toHaveCount(1);
    await page.getByRole('button', { name: '清除筛选' }).click();
    await expect(page.locator('.record-card')).toHaveCount(2);
    await page.goto('/statistics');
    await expect(page.getByText('2 张关联纸条', { exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('statistics.png'), fullPage: true });
    await page.goto('/');
    await expect(page.locator('.record-card')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /AI/ })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
    await audit(page, '首页');

    await page.goto(noteUrl);
    await page.getByRole('button', { name: '我觉得我们已经和好' }).click();
    await page.getByRole('button', { name: '我同意结束跟进' }).click();
    await expect(page.getByRole('button', { name: '已确认，等对方同意' })).toBeDisabled();
    await partner.goto(noteUrl);
    await partner.getByRole('button', { name: '我觉得我们已经和好' }).click();
    await expect(partner.locator('.detail-badges')).toContainText('已经和好');
    await partner.getByRole('button', { name: '我同意结束跟进' }).click();
    await expect(partner.locator('.detail-badges')).toContainText('已归档');
    await page.goto('/space');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('用户名', { exact: true }).fill(`lin_${suffix}`);
    await page.getByLabel('密码', { exact: true }).fill('paper-browser-2026');
    await page.getByRole('button', { name: '回到小纸条', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto(`/records/${id}?tab=reviews`);
    await expect(page.locator('.rating-value')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '保存我的回访' })).toHaveCount(0);
    expect(errors).toEqual([]);
    await testInfo.attach('accessibility.json', {
      body: JSON.stringify(accessibility, null, 2),
      contentType: 'application/json',
    });
    expect(accessibility).toEqual([]);
  } finally {
    await partnerContext.close();
  }
});
