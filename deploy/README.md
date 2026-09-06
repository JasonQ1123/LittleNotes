# 阿里云部署「小纸条」

适用环境：Ubuntu 22.04 / 24.04，2 核 / 2 GB 起，公网 IPv4。当前目标是 `<server-ip>`，正式域名是 `littlenotes.cn`。

这套部署使用 Caddy、NestJS 和 PostgreSQL 16。前端使用生产构建；所有 `/api` 请求由同一个域名转发。数据库和 API 不发布宿主机端口。Docker 随系统启动，应用、数据库和代理会自动重启。

## 1. 备案期间：只做服务器内部验证

在阿里云 Workbench 终端按顺序执行。首次安装需要从 Ubuntu、Docker、npm 和 GitHub 下载文件；如果下载失败，保留具体错误，不要换用不明镜像源或忽略签名验证。

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl openssl
sudo git clone https://github.com/JasonQ1123/LittleNotes.git /opt/littlenotes
cd /opt/littlenotes
sudo bash deploy/install-docker.sh
sudo bash deploy/deploy.sh
sudo bash deploy/install-backup-timer.sh
```

如果目录已经存在，先确认它是本项目，再进入目录执行 `sudo git pull --ff-only`，不要覆盖已有目录。项目路径统一使用 `/opt/littlenotes`，方便定时备份定位。

首次部署会：

1. 创建权限为 `600` 的 `deploy/.env`，自动生成随机数据库密码。再次执行时保留原密码。
2. 串行构建镜像，限制 Node.js 构建内存，然后启动 PostgreSQL 并执行独立的 PostgreSQL 迁移。
3. 启动 API 和前端，在服务器 `127.0.0.1:8080` 提供检查入口。
4. 输出健康检查结果，例如 `{"ok":true,"name":"小纸条",...}`。这个检查也会访问数据库。

此时公网 IP 和域名都不会提供网页，阿里云安全组无需开放 3000、5173、5432 或 8080。初期保留现有 Workbench 连接方式即可。默认没有创建账号，也不会上传本地 SQLite 数据库；在正式网站上重新注册即可开始使用。如果本地已经有需要保留的真实记录，应先停在这一步，单独制定和验证数据迁移，不能把 SQLite 文件直接当作 PostgreSQL 数据目录。

2 GB 服务器构建时会暂时停止已有网页和 API，更新存在维护时间；数据库保持运行。脚本在更新前先做备份。构建失败时查看具体错误，确认原因后重试。若内存持续不足，可调整构建方式或升级到 4 GB。

## 2. 查看运行状态

```bash
cd /opt/littlenotes
sudo docker compose --env-file deploy/.env -f deploy/compose.yaml ps
sudo docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=80 api web
curl --fail http://127.0.0.1:8080/api/health
```

备案通过前，不要为了打开网页放行开发端口或把本机监听改成公网监听。当前生产 Cookie 使用 `Secure`；HTTP 健康检查只用于检查服务，完整登录流程通过正式 HTTPS 地址验证。

如果 Docker 下载超时，脚本尚未完成；这不代表应用故障。不要发送 `deploy/.env`、SSH 私钥或完整 `docker compose config` 输出，这些内容可能包含密码。

## 3. 备案通过后：启用域名和 HTTPS

先完成这几项：

- 阿里云域名解析：主机记录 `@`，类型 `A`，记录值 `<server-ip>`。若公网 IP 改变，使用新的公网 IP。不要添加未配置的 IPv6 / AAAA 记录。
- ECS 安全组入方向开放 TCP 80 和 443；若启用了系统防火墙，也放行这两个端口。API 和数据库端口继续只在 Docker 网络内使用。
- 确认 `littlenotes.cn` 的 ICP 备案已通过。网站名称、内容与备案信息保持一致。

编辑配置：

```bash
cd /opt/littlenotes
sudo nano deploy/.env
```

保留已有的 `POSTGRES_PASSWORD`。填入真实的证书通知邮箱和已获批的完整备案号，例如下面的占位说明应替换成你的实际值：

```dotenv
WEB_ORIGIN=https://littlenotes.cn
DOMAIN=littlenotes.cn
ACME_EMAIL=你的邮箱
ICP_NUMBER=已获批的完整备案号
```

执行：

```bash
sudo bash deploy/publish.sh
```

Caddy 自动申请和续期 HTTPS 证书。证书签发需要正确的 DNS 解析、80/443 入站访问和服务器访问证书机构的网络连接。配置成功启动不代表证书已经签发，最终以浏览器能够打开 `https://littlenotes.cn`、证书有效、注册登录正常为准。`www` 域名暂不配置，所有邀请使用主域名。

网页从 API 获取备案号并展示工信部备案查询链接，修改备案号后只需重建 API 容器，无需重新构建前端。启用公网配置后，`deploy/.public-enabled` 会记录此状态，后续部署脚本会保留 HTTPS 配置。

查看公网代理日志时使用两份配置：

```bash
sudo docker compose --env-file deploy/.env -f deploy/compose.yaml -f deploy/compose.public.yaml logs --tail=80 web
```

## 4. 备份和恢复演练

`install-backup-timer.sh` 安装服务器的 systemd 定时任务，每天北京时间 03:30 左右执行 `pg_dump`，服务器本地保留约 14 天。备份先写临时文件，通过检查后才改名，失败不会生成看似成功的备份。

```bash
sudo bash deploy/backup.sh
sudo systemctl list-timers littlenotes-backup.timer
sudo journalctl -u littlenotes-backup.service --no-pager -n 30
sudo ls -lh /opt/littlenotes/backups
```

从列表中选一个真实备份文件，运行完整恢复演练：

```bash
sudo bash deploy/verify-backup.sh /opt/littlenotes/backups/实际文件名.dump
```

该脚本把备份恢复到临时数据库，检查账号、记录、约定和回访表的数量，然后清理临时数据库，不覆盖当前业务库。上线前至少成功做一次，之后定期复查。

本机备份无法覆盖服务器磁盘损坏或整机丢失。开始保存真实内容前，使用 Workbench 文件下载或 SCP 将一份备份和配置安全地保存在另一台设备上。后续可以再配置 OSS 异地备份；当前脚本尚未自动上传到 OSS。

出现故障时保留数据库卷和备份，先把备份恢复到独立数据库，确认内容后再切换连接。不要执行 `docker compose down -v`，它会删除数据库和证书卷。

## 5. 更新和验收

```bash
cd /opt/littlenotes
sudo git pull --ff-only
sudo bash deploy/deploy.sh
```

两种数据库的迁移历史互相独立。修改模型时先改 `apps/api/prisma/schema.prisma`，执行 `pnpm db:postgres:sync`，分别编写和检查两种数据库的增量迁移，不能修改已经应用过的初始迁移。

生产事务使用 PostgreSQL Serializable 隔离并重试并发冲突；开发 SQLite 保持进程内写入队列。不要手动切换本机生成的 Prisma Client 去连接生产库。

部署后用两个独立浏览器账号完成：注册 → 邀请 → 草稿发布 → 双方视角 → 约定确认 → 回访。再检查其他空间和未分享内容不可读取、刷新/重登/服务重启后数据仍存在。

本轮是部署准备和少量用户试用。密码找回、解除配对、账号注销、数据导出及本地历史数据导入仍需后续实现，暂不面向大量用户开放注册。

## 开发者：验证 PostgreSQL

准备一个专用 PostgreSQL 16 测试数据库，再执行：

```powershell
$env:TEST_DATABASE_URL = 'postgresql://测试用户:测试密码@127.0.0.1:5432/测试数据库'
pnpm test:postgres --e2e
```

脚本在 `.cache` 建立独立依赖目录和 Prisma Client，在测试数据库建立随机 `ln_test_` schema；结束后清理这些 schema。日常本地 SQLite Client、环境文件和数据不变。它复用 API 集成测试及桌面/手机双人浏览器流程，并增加两个独立服务实例的同时确认检查。
