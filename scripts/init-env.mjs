import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const target = new URL('../apps/api/.env', import.meta.url);
if (!existsSync(target)) {
  copyFileSync(new URL('../apps/api/.env.example', import.meta.url), target);
  console.log('已创建本地环境配置 apps/api/.env');
}
let config = readFileSync(target, 'utf8');
if (!/^EMAIL_HMAC_SECRET=.+\S.*$/m.test(config)) {
  const setting = `EMAIL_HMAC_SECRET=${randomBytes(32).toString('hex')}`;
  config = /^EMAIL_HMAC_SECRET=.*$/m.test(config)
    ? config.replace(/^EMAIL_HMAC_SECRET=.*$/m, setting)
    : `${config.trimEnd()}\n${setting}\n`;
  writeFileSync(target, config, { mode: 0o600 });
  console.log('已在本地环境配置生成独立邮件验证码密钥（未输出密钥）。');
}
