import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git(['status', '--porcelain'])) throw new Error('请先提交代码，再打包已验证的版本');
const folder = join(root, '.cache', 'releases');
mkdirSync(folder, { recursive: true });
const file = join(folder, 'littlenotes-deploy.tar.gz');
// Git archive also honors checkout newline conversion; use Linux line endings on Windows.
git([
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.eol=lf',
  'archive',
  '--format=tar.gz',
  '--prefix=littlenotes/',
  '--output',
  file,
  'HEAD',
]);
const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(`${file}.sha256`, `${digest}  littlenotes-deploy.tar.gz\n`);
console.log(`部署包：${file}\n版本：${git(['rev-parse', '--short', 'HEAD'])}\nSHA256：${digest}`);
