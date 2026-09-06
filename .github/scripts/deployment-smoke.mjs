// CI-only check against the loopback production containers. The job removes its own database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (process.env.CI !== 'true') throw new Error('仅在 CI 的临时部署中创建演练数据');
const base = 'http://127.0.0.1:8080';
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const actor = () => {
  let cookie = '';
  return async (path, body) => {
    const response = await fetch(`${base}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://littlenotes.cn',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `${path}: ${response.status}`);
    const next = response.headers.get('set-cookie');
    if (next) {
      assert.match(next, /; Secure/);
      assert.match(next, /; HttpOnly/);
      cookie = next.split(';')[0];
    }
    return response.json();
  };
};
const a = actor();
const b = actor();
await a('/auth/register', {
  username: `deploy_a_${suffix}`,
  nickname: '演练甲',
  password: randomUUID(),
});
await b('/auth/register', {
  username: `deploy_b_${suffix}`,
  nickname: '演练乙',
  password: randomUUID(),
});
await a('/spaces', { name: '部署恢复演练空间' });
const invitation = await a('/spaces/invitations', {});
await b('/spaces/invitations/accept', { token: invitation.token });
const record = await a('/records', { title: '恢复演练：下次提前说一声' });
await a(`/records/${record.id}/publish`, {});
const proposal = await a(`/records/${record.id}/agreements`, {
  baseVersion: 0,
  understanding: '双方希望提前知道安排的变化',
  actions: [{ text: '发生变化时及时沟通', assigneeId: 'both' }],
  criteria: '双方都收到消息',
});
const agreement = proposal.agreements[0];
await Promise.all([
  a(`/agreements/${agreement.id}/confirm`, {}),
  b(`/agreements/${agreement.id}/confirm`, {}),
]);
const detail = await a(`/records/${record.id}`);
assert.equal(detail.status, 'followup');
const cycle = detail.agreements[0].cycles[0];
await a(`/reviews/${cycle.id}`, {
  rating: '明显改善',
  achieved: '已做到',
  example: '提前收到消息',
  remaining: '',
  adjustments: '',
});
await b(`/reviews/${cycle.id}`, {
  rating: '部分改善',
  achieved: '部分做到',
  example: '比之前及时',
  remaining: '希望再早一些',
  adjustments: '',
});
const reviewed = await a(`/records/${record.id}`);
assert.equal(reviewed.agreements[0].cycles[0].reviews.length, 2);
assert.equal((await fetch(`${base}/api/docs`)).status, 404);
const page = await fetch(`${base}/records/${record.id}`);
assert.equal(page.status, 200);
assert.match(await page.text(), /<html/);
console.log(
  '生产容器的注册、邀请、共同确认、独立回访和前端路由通过；即将备份 2 个用户、1 张纸条和 2 份回访。',
);
