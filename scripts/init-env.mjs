import { copyFileSync, existsSync } from 'node:fs';
const target = new URL('../apps/api/.env', import.meta.url);
if (!existsSync(target)) {
  copyFileSync(new URL('../apps/api/.env.example', import.meta.url), target);
  console.log('已创建本地环境配置 apps/api/.env');
}
