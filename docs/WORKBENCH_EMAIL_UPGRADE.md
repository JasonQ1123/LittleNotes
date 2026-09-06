# Workbench 邮箱版本升级（2026-09-06）

适用于当前 `/opt/littlenotes` Docker Compose 安装，继续使用 `https://<server-ip>`。补丁以 `6c35dd6` 为基线，也适用于 `615f5b1`，包含昵称、头像、修改密码及邮箱验证的全部增量。源码版本和 SHA256 见随包清单。服务器不需要连接 GitHub。

本次只覆盖包内源码，保留服务器的 `deploy/.env`、`.ip-enabled`、`compose.ip.yaml`、`Caddyfile.ip`、数据库卷、头像及证书卷。不要删除原目录，不执行 `down -v` 或数据库 reset。升级会有构建维护时间。**获取授权码还不代表投递验收通过；先完成第 4 步实际收信，再切换服务。**

## 1. 上传并暂存

Workbench 文件管理上传 `littlenotes-email-patch.tar.gz` 和同名追加 `.sha256` 的文件到 `/tmp`。如果上传到了其他目录，先移至下面的路径。执行整段命令，校验失败不会解压：

```bash
cd /tmp &&
sha256sum -c littlenotes-email-patch.tar.gz.sha256 &&
sudo install -d -m 700 /tmp/littlenotes-email-staging &&
sudo tar -xzf /tmp/littlenotes-email-patch.tar.gz -C /tmp/littlenotes-email-staging
```

这一步只暂存新文件，原网站继续运行。后续命令按顺序分段执行；报错后停在当前步骤。

## 2. 保存旧源码、配置、数据和运行镜像

以下固定备份目录只允许创建一次，防止重试时覆盖原始回退版本。如果目录已经存在，请先确认之前执行到了哪一步，保留该目录。

```bash
sudo bash <<'BASH'
set -euo pipefail
umask 077
cd /opt/littlenotes
for unit in littlenotes-deploy.service littlenotes-email-upgrade.service; do
  if systemctl is-active --quiet "$unit"; then
    echo '已有部署正在运行，请等它结束后再升级。' >&2
    exit 1
  fi
done
source deploy/common.sh
test -f deploy/.ip-enabled
test -s deploy/compose.ip.yaml
test -s deploy/Caddyfile.ip
[[ "${COMPOSE_ARGS[*]}" == *compose.ip.yaml* ]]
mkdir -p backups
rollback=/opt/littlenotes/backups/pre-email-20260906
mkdir -m 700 "$rollback"
api_container="$(dc ps --status running -q api)"
web_container="$(dc ps --status running -q web)"
test -n "$api_container"
test -n "$web_container"
docker tag "$(docker inspect --format '{{.Image}}' "$api_container")" littlenotes-api:pre-email-20260906
docker tag "$(docker inspect --format '{{.Image}}' "$web_container")" littlenotes-web:pre-email-20260906
docker image inspect --format '{{.Id}}' littlenotes-api:pre-email-20260906 littlenotes-web:pre-email-20260906 > "$rollback/images.txt"
bash deploy/backup.sh
if [[ -d uploads/avatars ]]; then
  tar -czf "$rollback/avatars.tar.gz" -C uploads avatars
fi
tar --exclude='./backups' --exclude='./uploads' --exclude='./.git' \
  --exclude='./.cache' --exclude='*/node_modules' --exclude='*/dist' \
  -czf "$rollback/source.tar.gz" .
tar -tzf "$rollback/source.tar.gz" > /dev/null
(cd "$rollback" && sha256sum source.tar.gz > source.sha256)
touch "$rollback/READY"
echo '回退源码、配置和旧镜像已保留；数据库备份在 backups 目录。'
BASH
```

源码备份包含服务器配置和授权信息，存放在仅 root 可读的目录。数据库备份仍位于 `/opt/littlenotes/backups`；如有同名 `.avatars.tar.gz`、`.sha256`，一起保存。不要清理 `pre-email-20260906` 镜像，等上线验收完成后再决定保留周期。

## 3. 只在服务器填写凭证

补充缺失配置并生成独立随机密钥，已有值保持原样：

```bash
sudo bash <<'BASH'
set -euo pipefail
umask 077
cd /opt/littlenotes
test -f backups/pre-email-20260906/READY
test -f deploy/.env
for key in SMTP_USER SMTP_AUTH_CODE; do
  if ! grep -q "^${key}=" deploy/.env; then printf '%s=\n' "$key" >> deploy/.env; fi
done
if ! grep -Eq '^EMAIL_HMAC_SECRET=.+$' deploy/.env; then
  sed -i '/^EMAIL_HMAC_SECRET=/d' deploy/.env
  printf 'EMAIL_HMAC_SECRET=%s\n' "$(openssl rand -hex 32)" >> deploy/.env
fi
if ! grep -q '^EMAIL_SMTP_VERIFIED=' deploy/.env; then
  printf 'EMAIL_SMTP_VERIFIED=0\n' >> deploy/.env
fi
chmod 600 deploy/.env
BASH
cd /opt/littlenotes
sudo nano deploy/.env
```

编辑其中两项，填真实的专用 163 邮箱与 SMTP 授权码，不要写邮箱登录密码：

```dotenv
SMTP_USER=你的专用邮箱@163.com
SMTP_AUTH_CODE=你的SMTP授权码
EMAIL_SMTP_VERIFIED=0
```

保留原 `POSTGRES_PASSWORD`、`PUBLIC_IP`、`ACME_EMAIL`、站点配置和自动生成的 `EMAIL_HMAC_SECRET`。各项只保留一行。不要把配置内容或授权码发到聊天、GitHub 或截图中。

## 4. 原网站运行期间验证真实收信

将下方两个收件地址替换为你控制的 QQ 和 163 邮箱后执行。这个临时容器只读取凭证和检查脚本，不连接数据库，也不改变原应用：

```bash
cd /opt/littlenotes
sudo docker run --rm --env-file deploy/.env \
  -v /tmp/littlenotes-email-staging/littlenotes/apps/api/scripts/smtp-check.cjs:/check.cjs:ro \
  public.ecr.aws/docker/library/node:24-bookworm-slim \
  sh -c 'cd /tmp && npm install --no-save nodemailer@10.0.0 class-validator@0.14.4 dotenv@17.4.2 >/dev/null && NODE_PATH=/tmp/node_modules node /check.cjs "$@"' \
  smtp-check 你控制的邮箱@qq.com 你控制的邮箱@163.com
```

需要先排查连接及授权时，可去掉最后两个收件参数，只验证 TLS 和认证。SMTP 接受邮件不代表已经送达；确认两个邮箱的收件箱或垃圾邮件中实际出现“小纸条 · 上线前收信检查”，且延迟明显小于验证码的 10 分钟有效期。

**未收到时停在这里，旧服务继续运行。** 确认都收到后，编辑 `/opt/littlenotes/deploy/.env`，将已有 `EMAIL_SMTP_VERIFIED=0` 改成 `EMAIL_SMTP_VERIFIED=1`，再执行下一步。

## 5. 应用补丁并在后台部署

```bash
sudo bash <<'BASH'
set -euo pipefail
cd /opt/littlenotes
test -f backups/pre-email-20260906/READY
grep -Eq '^EMAIL_SMTP_VERIFIED=1[[:space:]]*$' deploy/.env
for unit in littlenotes-deploy.service littlenotes-email-upgrade.service; do
  if systemctl is-active --quiet "$unit"; then
    echo '已有部署正在运行，请勿重复启动。' >&2
    exit 1
  fi
done
(cd /tmp && sha256sum -c littlenotes-email-patch.tar.gz.sha256)
tar -xzf /tmp/littlenotes-email-patch.tar.gz -C /opt
source deploy/common.sh
dc config --quiet
systemd-run --unit=littlenotes-email-upgrade --collect \
  --working-directory=/opt/littlenotes /bin/bash deploy/deploy.sh
BASH
sudo journalctl -u littlenotes-email-upgrade.service -n 60 -f
```

部署会再次备份，串行构建前后端，然后顺序执行尚未应用的头像、修改密码限流及邮箱迁移，最后重启服务。旧用户邮箱为空，原密码和记录保留。看到 `Running as unit` 只表示任务已启动；需要等迁移、容器启动全部成功。Ctrl+C 只退出日志查看，关闭 Workbench 不会停止后台部署。

## 6. 生产验收

```bash
sudo bash -c 'cd /opt/littlenotes && source deploy/common.sh && dc ps'
curl --fail --show-error --silent https://<server-ip>/api/health
```

打开原 [HTTPS 网站](https://<server-ip>)，检查：

- 旧账号原密码登录后先绑定邮箱，真实验证码可收到；完成后原空间、纸条、昵称头像保留。
- 新账号必须验证邮箱；新密码要求 8–32 位且同时有英文字母和数字。
- 找回密码成功后旧密码失效、其他设备退出；新密码能登录。
- 修改密码和更换邮箱可用；换绑后旧邮箱无法找回该账号，其他账号仍正常。
- 原空间、邀请、纸条、回访和昵称头像功能正常；`/dev-mail` 无模拟收信能力，`/api/dev/mail` 返回 404。

上线后再保存一份新版本的成套备份，并检查定时备份状态：

```bash
cd /opt/littlenotes
sudo bash deploy/backup.sh
sudo systemctl list-timers littlenotes-backup.timer
```

## 7. 构建或上线失败时恢复旧应用

保留失败日志。下面恢复第 2 步保存的代码、配置和原运行镜像，不重新构建、不恢复旧数据库，不覆盖上线后的账号与纸条。新增表列保留，回退期间不提供邮箱功能。

```bash
sudo bash <<'BASH'
set -euo pipefail
cd /opt/littlenotes
rollback=/opt/littlenotes/backups/pre-email-20260906
test -f "$rollback/READY"
(cd "$rollback" && sha256sum -c source.sha256)
docker image inspect littlenotes-api:pre-email-20260906 littlenotes-web:pre-email-20260906 > /dev/null
if systemctl is-active --quiet littlenotes-email-upgrade.service; then
  systemctl stop littlenotes-email-upgrade.service
fi
source deploy/common.sh
dc stop web api
tar -xzf "$rollback/source.tar.gz" -C /opt/littlenotes
docker tag littlenotes-api:pre-email-20260906 littlenotes-api:local
docker tag littlenotes-web:pre-email-20260906 littlenotes-web:local
source deploy/common.sh
dc up -d --no-deps --no-build --pull never --wait api web
dc ps
BASH
curl --fail --show-error --silent https://<server-ip>/api/health
```

如果迁移失败，保留迁移错误，后续再次升级前处理对应迁移状态；不要用 reset 绕过。只有确认需要数据恢复时，才按 [备份恢复文档](../deploy/README.md#4-备份和恢复演练) 单独处理数据库与头像，避免用旧备份覆盖新记录。

本说明和升级包属于生产准备；生产部署与真实 QQ/163 投递以服务器执行和人工收信结果为准。
