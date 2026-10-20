/**
 * Seed a demo couple in the local development database.
 *
 * Usage: start the API first (`pnpm dev`), then run `pnpm seed:demo`.
 * The script talks to the HTTP API only, so every record goes through the
 * same validation and permission rules as the real UI.
 */
const BASE = (process.env.SEED_API || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PASSWORD = process.env.SEED_PASSWORD || 'note-demo-2026';
const USERS = [
  { username: 'xiaolin', nickname: '小林', email: 'xiaolin@example.com' },
  { username: 'xiaoan', nickname: '小安', email: 'xiaoan@example.com' },
];
const day = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * day).toISOString();

class Client {
  cookies = new Map();
  async request(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size)
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of response.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, ok: response.ok, data };
  }
  async must(path, options) {
    const result = await this.request(path, options);
    if (!result.ok)
      throw new Error(
        `${options?.method || 'GET'} ${path} -> ${result.status} ${JSON.stringify(result.data)}`,
      );
    return result.data;
  }
}

async function waitForCode(client, challengeId) {
  for (let i = 0; i < 80; i++) {
    const inbox = await client.must('/dev/mail');
    const found = Array.isArray(inbox) ? inbox.find((m) => m.challengeId === challengeId) : null;
    if (found?.code) return found.code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('本地模拟收件箱没有返回验证码，请确认 EMAIL_DELIVERY=mock');
}

async function signIn(user) {
  const client = new Client();
  const login = await client.request('/auth/login', {
    method: 'POST',
    body: { username: user.username, password: PASSWORD },
  });
  if (login.ok) return { client, created: false };
  const requested = await client.must('/auth/register/code', {
    method: 'POST',
    body: { email: user.email },
  });
  const code = await waitForCode(client, requested.challengeId);
  await client.must('/auth/register', {
    method: 'POST',
    body: {
      username: user.username,
      nickname: user.nickname,
      password: PASSWORD,
      email: user.email,
      challengeId: requested.challengeId,
      code,
    },
  });
  return { client, created: true };
}

async function record(client, data) {
  return client.must('/records', { method: 'POST', body: data });
}
const publish = (client, id) => client.must(`/records/${id}/publish`, { method: 'POST' });
const perspective = (client, id, body, publishIt = true) =>
  client.must(`/records/${id}/perspective`, {
    method: 'POST',
    body: { revision: 0, publish: publishIt, ...body },
  });
const archive = (client, id) => client.must(`/records/${id}/archive`, { method: 'POST' });

async function main() {
  const health = await new Client().request('/health');
  if (!health.ok) throw new Error(`API 未就绪：${BASE}/api/health -> ${health.status}`);
  if (health.data?.features && health.data.features.mockEmail === false)
    throw new Error('当前 API 没有开启本地模拟邮箱（EMAIL_DELIVERY=mock），无法自助注册演示账号。');

  const sessions = [];
  for (const user of USERS) sessions.push(await signIn(user));
  const [linClient, anClient] = sessions.map((s) => s.client);

  let space = await linClient.must('/spaces/current');
  if (!space) {
    await linClient.must('/spaces', { method: 'POST', body: { name: '小林与小安的小天地' } });
    space = await linClient.must('/spaces/current');
  }
  if (space.members.length < 2) {
    const invitation = await linClient.must('/spaces/invitations', { method: 'POST' });
    await anClient.must('/spaces/invitations/accept', {
      method: 'POST',
      body: { token: invitation.token },
    });
    space = await linClient.must('/spaces/current');
  }

  const existing = await linClient.must('/records');
  if (existing.total > 0) {
    console.log(`演示空间已有 ${existing.total} 张纸条，跳过播种。`);
  } else {
    const a = await record(linClient, {
      title: '关于临时改变的周末计划',
      category: '承诺计划',
      description:
        '原本约好周末一起去公园，出发前一晚临时改变了安排。我们都没有恶意，但那一刻都觉得自己的期待没有被放在心上。',
      tags: ['周末', '提前沟通'],
      occurredAt: daysAgo(12),
    });
    await publish(linClient, a.id);
    await perspective(linClient, a.id, {
      facts: '周六晚上十点，原定周日上午的公园行程被临时改成下午。',
      feelings: '有一点失落，也担心自己是不是太计较。',
      causes: '对方那天工作到很晚，来不及提前说。',
      needs: '希望计划变化时能早点知道，也希望能一起商量替代方案。',
      adjustments: '下次有变动时，先发一条消息，再一起定时间。',
    });
    await perspective(anClient, a.id, {
      facts: '周五工作到十一点，周六早上才想起要改时间。',
      feelings: '内疚，也觉得被指责时有点委屈。',
      causes: '太累，把沟通这件事往后拖了。',
      needs: '希望对方先听我解释，再一起决定怎么办。',
      adjustments: '再晚也说一声，哪怕只是一句「明天可能要改」。',
    });
    const proposed = await linClient.must(`/records/${a.id}/agreements`, {
      method: 'POST',
      body: {
        baseVersion: 0,
        understanding: '我们都需要提前知道计划的变化，也需要感受到自己被认真考虑。',
        actions: [
          { text: '计划有变时，尽早告诉对方，并一起确认替代安排。', assigneeId: 'both' },
          { text: '每周日晚上花十分钟对一下接下来一周的安排。', assigneeId: 'both' },
        ],
        criteria: '双方都提前知道安排，变化发生时都参与过讨论。',
        dueAt: daysAgo(3),
      },
    });
    const agreement = proposed.agreements[0];
    await linClient.must(`/agreements/${agreement.id}/confirm`, { method: 'POST' });
    const confirmed = await anClient.must(`/agreements/${agreement.id}/confirm`, {
      method: 'POST',
    });
    const cycleId = confirmed.agreements[0].cycles[0].id;
    const review = {
      rating: '明显改善',
      achieved: '已做到',
      example: '这周临时调整行程前，我们提前打了电话，一起把新的时间定下来。',
      remaining: '偶尔还是会忘记说，但比以前好很多。',
      adjustments: '继续保持，必要时把安排写进共享日历。',
    };
    await linClient.must(`/reviews/${cycleId}`, { method: 'POST', body: review });
    await anClient.must(`/reviews/${cycleId}`, {
      method: 'POST',
      body: { ...review, rating: '部分改善', achieved: '部分做到' },
    });

    const b = await record(linClient, {
      title: '晚饭时间总是对不上',
      category: '陪伴时间',
      description: '一个人习惯六点吃，一个人常常八点才下班。等来等去，最后谁都没吃好。',
      tags: ['晚饭', '作息'],
      occurredAt: daysAgo(6),
    });
    await publish(linClient, b.id);
    await perspective(anClient, b.id, {
      facts: '这周有两天临时加班，来不及说。',
      feelings: '累的时候不想解释，事后又觉得抱歉。',
      causes: '事情堆在一起，把沟通排在了最后。',
      needs: '希望对方别把沉默理解成不在乎。',
      adjustments: '下班前一定发一条消息。',
    });
    await perspective(
      linClient,
      b.id,
      {
        facts: '其实我更在意的是，等待的时候不知道要等多久。',
        feelings: '不安，也有点被晾着的感觉。',
        causes: '没有预期，就会往坏处想。',
        needs: '想要一个大概的时间点。',
        adjustments: '先说不确定，也比不说好。',
      },
      false,
    );
    await linClient.must(`/records/${b.id}/agreements`, {
      method: 'POST',
      body: {
        baseVersion: 0,
        understanding: '我们需要一个双方都能接受的晚饭安排，而不是每次都临时决定。',
        actions: [{ text: '下班前发一条预计到家的时间。', assigneeId: 'both' }],
        criteria: '一周里有四天能按约定时间吃饭。',
        dueAt: new Date(Date.now() + 4 * day).toISOString(),
      },
    });

    await record(linClient, {
      title: '关于钱的一点想法',
      category: '金钱消费',
      description: '还没想好怎么说，先写在这里。',
      tags: ['还没想好'],
      occurredAt: daysAgo(1),
    });

    const d = await record(linClient, {
      title: '上个月那次没说清楚的争执',
      category: '沟通方式',
      description: '一件小事，因为都憋着不说，最后变成了冷战。',
      tags: ['冷战'],
      occurredAt: daysAgo(48),
    });
    await publish(linClient, d.id);
    await archive(linClient, d.id);
    await archive(anClient, d.id);

    const e = await record(linClient, {
      title: '节日怎么安排',
      category: '家庭朋友',
      description: '两个人都想回家，也都不想让对方为难。',
      tags: ['节日', '家人'],
      occurredAt: daysAgo(30),
    });
    await publish(linClient, e.id);
    await perspective(linClient, e.id, {
      facts: '国庆假期两边家里都希望我们回去。',
      feelings: '为难，也怕被说不重视家人。',
      causes: '假期太短，路上就要花掉两天。',
      needs: '希望有一个双方都能接受的分法。',
      adjustments: '先各自和家里沟通，再一起定。',
    });
    await perspective(anClient, e.id, {
      facts: '我妈提前一个月就问了几次。',
      feelings: '压力大，又不想让对方觉得被排除。',
      causes: '两边都只有一个假期。',
      needs: '希望先定一个原则，以后不用每次都争。',
      adjustments: '重要节日轮流，其他时间灵活。',
    });
    const proposedE = await linClient.must(`/records/${e.id}/agreements`, {
      method: 'POST',
      body: {
        baseVersion: 0,
        understanding: '我们都需要一个对双方家庭都说得过去的安排。',
        actions: [{ text: '重要节日轮流，提前一个月对一次。', assigneeId: 'both' }],
        criteria: '两边家里都提前知道安排。',
        dueAt: daysAgo(1),
      },
    });
    const agreementE = proposedE.agreements[0];
    await linClient.must(`/agreements/${agreementE.id}/confirm`, { method: 'POST' });
    await anClient.must(`/agreements/${agreementE.id}/confirm`, { method: 'POST' });

    await linClient.must(`/records/${a.id}/links`, {
      method: 'POST',
      body: { relatedId: d.id },
    });
    console.log('演示数据已写入：5 张纸条、2 份约定、双方回访与历史关联。');
  }

  console.log('');
  console.log('  网页   http://127.0.0.1:5173');
  console.log(`  账号   ${USERS[0].username} / ${PASSWORD}`);
  console.log(`  对方   ${USERS[1].username} / ${PASSWORD}`);
  console.log('');
}

main().catch((error) => {
  console.error('播种失败：', error.message);
  process.exitCode = 1;
});
