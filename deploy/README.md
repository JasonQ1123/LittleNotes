# 阿里云部署「小纸条」

## 邮箱验证码版本升级前置要求

当前通过 Workbench 升级现有 HTTPS 公网 IP 服务，请直接按 [本次上传、收信验证、升级和回退步骤](../docs/WORKBENCH_EMAIL_UPGRADE.md) 操作。下面保留通用安装及维护说明。

本版本要求新旧账号验证邮箱后使用业务功能。**先按 [邮箱部署与投递验收](../docs/EMAIL_RECOVERY.md#上线前真实投递验收) 验证阿里云服务器能向 QQ、163 真实投递，再执行下面的部署命令。** 在 `deploy/.env` 补齐 `SMTP_USER`、`SMTP_AUTH_CODE`、独立 `EMAIL_HMAC_SECRET`，实际确认收信后设 `EMAIL_SMTP_VERIFIED=1`。已有配置会保留，新配置不会自动覆盖；未通过验收时部署脚本退出并保留原服务。

已使用此前公网 IP 补丁的服务器，升级继续识别 `deploy/.ip-enabled`，加载原有 `compose.ip.yaml` 与 `Caddyfile.ip`，保持当前 HTTPS IP 入口。请保留这些服务器文件，以及 `.env` 中的 `PUBLIC_IP`、`ACME_EMAIL`；缺失 IP 配置时脚本会退出，不切换入口。

新增 `20260906020000_email_recovery` 迁移只给旧账号添加空邮箱、空验证时间和初始认证版本，同时创建验证码、邮件任务、发送限额表。旧账号、密码哈希、会话、昵称头像和业务记录均保留；旧会话访问业务时也会被要求绑定。生产强制 SMTP，禁止 mock；请勿将模拟收件箱用于生产。

升级前保留完整数据库与头像备份、安全保管现有环境配置并记录旧镜像版本。`deploy.sh` 验收检查通过后执行成套备份、构建、增量迁移和重启。增量加列不要求删除数据库；勿执行 reset。若需回退，优先恢复旧应用镜像并保留新增表列，避免恢复旧数据库覆盖上线后记录；若必须恢复数据，按成套数据库/头像备份流程操作。

适用环境：Ubuntu 22.04 / 24.04，2 核 / 2 GB 起，公网 IPv4。当前目标是 `<server-ip>`，正式域名是 `littlenotes.cn`。

这套部署使用 Caddy、NestJS 和 PostgreSQL 16。前端使用生产构建；所有 `/api` 请求由同一个域名转发。数据库和 API 不发布宿主机端口。Docker 随系统启动，应用、数据库和代理会自动重启。

## 1. 备案期间：只做服务器内部验证

推荐使用源码部署包，服务器无需登录 GitHub。开发机提交代码后执行 `pnpm package:deploy`，会在 `.cache/releases` 生成 `littlenotes-deploy.tar.gz` 和 SHA256 校验文件。归档仅包含 Git 已提交的文件，不包含本地数据库、实际环境配置和账号密码。

通过阿里云 Workbench 的文件管理，把部署包上传为 `/tmp/littlenotes-deploy.tar.gz`。如果文件管理默认上传到登录用户的主目录，使用页面显示的实际完整路径替换下面的 `/tmp/littlenotes-deploy.tar.gz`。

在 Workbench 终端按顺序执行。首次安装需要从 Ubuntu、Docker 和 npm 下载文件；如果下载失败，保留具体错误，不要换用不明镜像源或忽略签名验证。

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl openssl
sudo tar --keep-old-files -xzf /tmp/littlenotes-deploy.tar.gz -C /opt
cd /opt/littlenotes
sudo bash deploy/install-docker.sh
sudo bash deploy/deploy.sh
sudo bash deploy/install-backup-timer.sh
```

初次解压使用 `--keep-old-files`，如果目录已有同名文件会报错，请先确认是否已经安装，不要直接覆盖已有目录。项目路径统一使用 `/opt/littlenotes`，方便定时备份定位。通过源码包安装的目录没有 `.git`，后续也通过新的部署包更新。若服务器已配置 GitHub 仓库的只读访问凭据，也可以用 `git clone` 获取代码。

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

基础镜像使用 Docker 官方在 [Amazon ECR Public 发布的镜像](https://aws.amazon.com/blogs/containers/docker-official-images-now-available-on-amazon-elastic-container-registry-public/)，地址前缀为 `public.ecr.aws/docker/library/`，覆盖 Node.js、Caddy 和 PostgreSQL。此入口需要服务器能够访问 Amazon ECR Public 及其镜像层下载地址。

如果旧版本出现 `registry-1.docker.io ... connection refused`，说明尚未开始应用构建，应先更换旧部署文件中的镜像地址。不要把报错中的 IP 写入 hosts，也不要关闭 TLS 验证。可以先检查入口，再用 Docker 验证实际镜像拉取：

```bash
curl -I --connect-timeout 10 --max-time 20 https://public.ecr.aws/v2/
sudo docker pull public.ecr.aws/docker/library/node:24-bookworm-slim
```

第一条返回 `401` 及 `www-authenticate` 头是正常的镜像仓库鉴权响应；第二条成功才说明 Docker 能完成鉴权和镜像层下载。若日志仍出现 `docker.io/library/node` 或 `docker.io/library/caddy`，请检查服务器是否仍在使用旧版 Dockerfile。

构建时的 Debian 软件源使用 `https://mirrors.aliyun.com/debian` 和对应的 `debian-security`，保留 Debian 的包签名校验。精简基础镜像尚未安装系统证书时，先从 Node 内置的可信根证书生成临时 CA 文件，以便通过 HTTPS 安装系统证书，全程保持 TLS 校验。网络请求设置 30 秒无响应超时和最多 3 次重试。

构建与运行阶段共享同一份系统依赖层，OpenSSL 和 CA 证书只安装一次。部署脚本分别执行 API 和网页镜像构建，后者复用前者的构建缓存，避免部分 Compose 版本同时构建多个目标。若旧日志反复出现 `deb.debian.org`、`Ign:` 或很低的下载速率，请更新 Dockerfile 和部署脚本；不要在旧构建尚未停止时启动第二份部署。

Workbench 可关闭后继续运行的部署方式：

```bash
sudo systemd-run --unit=littlenotes-deploy --collect \
  --working-directory=/opt/littlenotes \
  /bin/bash -c 'bash deploy/deploy.sh && bash deploy/backup.sh'
sudo journalctl -u littlenotes-deploy.service -n 30 -f
```

`Running as unit` 只表示任务已经启动，仍以健康检查和备份日志为完成标志。查看日志时按 Ctrl+C 不会停止后台部署。需要替换正在构建的旧文件时，先用 `sudo systemctl stop littlenotes-deploy.service` 停止这次构建任务，再更新文件并重新启动；该命令不会删除代码、镜像或数据库卷。

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

### 昵称和头像功能升级

本次增加用户头像字段，需要更新前后端并执行增量数据库迁移，不能只覆盖前端构建文件。现有昵称、账号、空间和记录保持原样，未上传头像的账号继续显示昵称首字。

更新源码后执行 `sudo bash deploy/deploy.sh`。脚本会通过 `prepare-uploads.sh` 创建 `/opt/littlenotes/uploads/avatars` 并设置为 API 的 UID/GID 1000 可写；Compose 将此目录持久挂载到 API 容器。容器重建不会删除头像。已有公网 IP / HTTPS 配置应继续保留；头像请求适配原有的 256 KB 代理限制，无需扩大普通 API 请求体限制。

本地开发默认使用 `apps/api/uploads/avatars`，可通过 `AVATAR_STORAGE_DIR` 指定其他位置。图片经过客户端裁剪和服务端重新编码，存储为 256×256 WebP；读取仍验证登录和当前空间权限。

新的 `backup.sh` 每次生成三件配套文件：原有 `.dump` 数据库备份、同名追加 `.avatars.tar.gz` 的头像归档、同名追加 `.sha256` 的校验清单。下载备份时应一起保存这三件文件。每日定时器继续使用原脚本，无需重新安装。

备份先完成数据库快照，再归档图片。头像替换不会立即删除旧文件，成功备份后才清理已超过 24 小时且数据库不再引用的旧文件；整套备份保留约 14 天。`verify-backup.sh` 会恢复数据库至临时库，核对配套文件校验值，并逐个解出数据库引用的头像检查内容非空。旧版没有头像数据的纯数据库备份仍可验证。

恢复含头像的业务数据时，在停写的维护窗口使用同一套数据库备份及头像归档：先解压头像到持久目录，执行 `prepare-uploads.sh` 设置目录权限，并将恢复文件设置为 UID/GID 1000 可读，再按既有数据库恢复方案切换到已验证的数据库。恢复前必须保留当前数据库、头像和配置，不要将不同时间的备份混搭。

开发机可运行 `pnpm test:backup` 检查文件归档、并发替换后的引用保留、损坏归档和旧备份兼容；真正的 Docker 容器重建及 PostgreSQL dump/restore 由 CI 的容器任务验证。

### 修改密码功能升级

新注册和修改密码统一要求 8–32 位，同时包含英文字母与数字，可额外包含符号。已有账号继续使用原密码登录和验证当前密码，不批量重置密码或修改原密码哈希；规则调整本身没有新增数据库迁移。升级后需同时更新 API 和前端。

本次新增 `PasswordChangeLimit` 表和 SQLite/PostgreSQL 各自的 `20260906010000_password_change_limit` 迁移，用于持久保存修改密码的账号及来源限流。迁移仅增加限流表，不更改现有用户密码或会话。

更新完整前后端源码后执行 `sudo bash deploy/deploy.sh`，脚本先备份、构建，再执行迁移并重建服务。若昵称和头像版本尚未部署，脚本会顺序执行头像与改密两个增量迁移，并准备头像持久目录。数据库连接、站点来源及可信代理配置沿用现有配置。

升级后用专用测试账号在两个独立浏览器同时登录：从“我们的空间 → 账号安全”修改密码，确认当前设备返回登录页、另一设备下次请求需重新登录、旧密码无法登录而新密码可用。错误当前密码不能修改密码或撤销会话，其他用户的会话应仍有效。改密限流为每 15 分钟每账号 5 次、同来源 40 次，重启后计数仍有效。

密码更新与删除该用户全部会话在同一事务完成；登录签发会话也会重新校验并锁定已验证的密码哈希和认证版本，避免在途旧凭据登录绕过撤销。邮箱验证码版本已将未使用挑战的撤销纳入改密事务。

### 通用更新流程

源码包安装：上传新的已提交版本后，先做备份，再覆盖项目代码。部署包不包含 `.env`、公网启用标记和数据库卷，因此会保留原配置及数据。更新前核对包中的顶层目录仍是 `littlenotes/`。

```bash
cd /opt/littlenotes
sudo bash deploy/backup.sh
sudo tar -xzf /tmp/littlenotes-deploy.tar.gz -C /opt
sudo bash deploy/deploy.sh
```

使用 Git 克隆安装的服务器，在维护窗口执行 `sudo git pull --ff-only` 后运行 `sudo bash deploy/deploy.sh`。不要在源码包目录执行 `git pull`。

两种数据库的迁移历史互相独立。修改模型时先改 `apps/api/prisma/schema.prisma`，执行 `pnpm db:postgres:sync`，分别编写和检查两种数据库的增量迁移，不能修改已经应用过的初始迁移。

生产事务使用 PostgreSQL Serializable 隔离并重试并发冲突；开发 SQLite 保持进程内写入队列。不要手动切换本机生成的 Prisma Client 去连接生产库。

部署后用两个独立浏览器账号完成：注册 → 邀请 → 草稿发布 → 双方视角 → 约定确认 → 回访。再检查其他空间和未分享内容不可读取、刷新/重登/服务重启后数据仍存在。

本轮是部署准备和少量用户试用。密码找回已通过本地验收，真实邮件投递需在服务器验证；解除配对、账号注销、数据导出及本地历史数据导入仍需后续实现。

## 开发者：验证 PostgreSQL

准备一个专用 PostgreSQL 16 测试数据库，再执行：

```powershell
$env:TEST_DATABASE_URL = 'postgresql://测试用户:测试密码@127.0.0.1:5432/测试数据库'
pnpm test:postgres --e2e
```

脚本在 `.cache` 建立独立依赖目录和 Prisma Client，在测试数据库建立随机 `ln_test_` schema；结束后清理这些 schema。日常本地 SQLite Client、环境文件和数据不变。它复用 API 集成测试及桌面/手机双人浏览器流程，并增加两个独立服务实例的同时确认检查。
