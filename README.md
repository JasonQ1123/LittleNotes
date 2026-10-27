# 小纸条

给两个人用的矛盾记录与共同复盘工具。把一次沟通写成可以回头看的记录，把商量好的办法变成能跟进的小行动。

**记录 → 双方视角 → 共同约定 → 独立回访 → 关联历史。**

线上版本：<https://web.littlenotes.cn>（沪ICP备2026047310号）。

## 这是什么

情侣之间难免有说不清的时候。小纸条把一次冲突拆成几步：

1. 一方先写下**发生了什么**，作为只有自己可见的草稿，准备好再分享；
2. 双方各自补充**视角**，发布后才互相可见，再次编辑保留上一份已发布快照；
3. 一起提出**共同约定**，双方确认后生效，旧版本留存为历史；
4. 到期后各自**独立回访**，保留两个人不同的感受；
5. 再遇到类似情况时，把新旧纸条**关联**起来，能看到以前试过的办法。

共享内容始终由服务端校验当前登录用户的空间身份；未发布的草稿和视角不会被对方读到。

## 功能

**空间与账号**

- 邮箱验证码注册、用户名登录；一个账号一个空间，每个空间最多两人
- 48 小时、一次有效的邀请链接，支持撤销与重新生成
- 忘记密码、修改密码、更换邮箱；修改密码后所有设备需要重新登录
- 空间解绑、关闭、30 天隐藏保留、限时双方恢复，以及关闭后的手动彻底删除

**记录与复盘**

- 私密草稿、主动发布、分类、标签、分页搜索
- 状态流转：草稿 → 复盘中 → 跟进中 → 已归档；归档需双方分别确认，之后只读
- 双方独立填写视角，支持私密保存与公开发布
- 首页个人待办：待补充视角、待确认、到期回访、待归档

**约定与回访**

- 方案版本化；双方确认同一份最新方案后原子生效，旧版本保留
- 默认在生效七天后回访，也可以改期；每轮双方各填一次，保留差异
- 双方分别标记和好；和好不会清除回访任务

**回顾与统计**

- 最近 30 / 90 / 365 天，事件按发生时间、按北京时间月份汇总
- 分类分布、双方回访感受对比、手动建立的历史关联主题

**个人资料**

- 昵称（最多 30 字）
- 头像上传与拖动裁剪（5 MB 内的 JPG / PNG / WebP，输出 256×256 WebP）

## 核心规则

### 权限与可见性

- 草稿只有作者可见；已共享的纸条不能单方删除
- 视角按发布快照读取，之后继续私密编辑不会泄漏给对方
- 事件概况只有记录者能改，个人视角只有本人能改；伙伴只能读取已发布内容
- 头像只对本人和当前空间成员开放；已关闭的空间只展示昵称快照与默认头像

### 约定与回访

- 提交新版本会替代上一份待确认方案，此前已生效的约定继续有效
- 重复确认幂等，过时确认返回冲突；第二人确认时在同一事务内切换生效版本并建立第一轮回访
- 一人提交回访只清除自己的待办；双方都完成后再次安排日期会开启新一轮，历史回访保留
- 事件概况、视角、方案都带版本校验，页面过时会提示刷新，不会静默覆盖

### 统计口径

- 私密草稿不进入共享统计
- 回访按提交或更新时间计入区间，每人每轮计一次
- 重复主题只来自手动关联，同一分类本身不算重复

## 技术栈

| 层   | 选型                                                                   |
| ---- | ---------------------------------------------------------------------- |
| 前端 | Vue 3 + TypeScript + Vite + Vue Router + Pinia + Tailwind CSS 4        |
| 后端 | NestJS 11 + Prisma 6 + class-validator + Swagger                       |
| 数据 | 本地 SQLite / 生产 PostgreSQL 16，两套独立迁移历史                     |
| 部署 | Docker Compose + Caddy（自动 HTTPS）+ 阿里云 ECS                       |
| 测试 | node:test 接口集成测试 + Playwright（桌面 / 390px，含 axe 无障碍检查） |

Vite 把 `/api` 代理到 NestJS，浏览器使用同源 HttpOnly Cookie。

并发上，SQLite 在进程内排队写事务；PostgreSQL 使用 Serializable 隔离加冲突重试，并用唯一约束兜底。修改数据模型时先改 `apps/api/prisma/schema.prisma`，执行 `pnpm db:postgres:sync`，再分别编写两种数据库的增量迁移。

## 本地运行

需要 Node.js 24、pnpm 11。开发机不需要额外安装数据库。

```powershell
pnpm install
pnpm run setup
pnpm dev
```

启动后：

- 网站：<http://localhost:5173>
- API 文档：<http://localhost:3000/api/docs>
- 健康检查：<http://localhost:3000/api/health>

`setup` 会在没有配置文件时复制 `.env.example`、生成 Prisma Client 并应用迁移；已有配置和记录不会被覆盖。重新初始化或修改数据模型前，先停掉开发服务和浏览器测试，避免 Windows 锁定 Prisma 引擎文件。

### 第一次使用

1. 用邮箱验证码注册账号。本地默认模拟发送，验证码在表单的「本地模拟收件箱」里查看
2. 在「我们的空间」创建空间并生成邀请链接
3. 用另一个浏览器或无痕窗口注册第二个账号，打开邀请并接受
4. 写一张私密草稿，分享后双方分别补充视角
5. 任一方提出方案，双方各自确认
6. 到期后从首页待办进入回访

同一浏览器的多个标签页会共享登录状态。开发服务默认只监听本机，此时生成的邀请链接也只能在同一台电脑打开。当前版本通过页面加载和操作结果刷新数据，没有后台推送或实时共同编辑。

## 配置

配置位于 `apps/api/.env`（首次运行 `setup` 时从 `.env.example` 复制）：

| 变量                | 默认值                                        | 用途                                 |
| ------------------- | --------------------------------------------- | ------------------------------------ |
| `DATABASE_URL`      | `file:./dev.db`                               | SQLite 文件，相对 Prisma schema 目录 |
| `PORT` / `HOST`     | `3000` / `127.0.0.1`                          | API 监听地址                         |
| `WEB_ORIGIN`        | `http://localhost:5173,http://127.0.0.1:5173` | 允许提交写请求的页面来源，逗号分隔   |
| `AI_ENABLED`        | `false`                                       | AI 接口开关，默认关闭                |
| `EMAIL_DELIVERY`    | `mock`                                        | `mock` 或 `smtp`，生产强制 `smtp`    |
| `EMAIL_HMAC_SECRET` | 空                                            | 验证码摘要密钥，生产必须固定且独立   |

完整变量见 [`.env.example`](apps/api/.env.example)；生产变量见 [`deploy/.env.example`](deploy/.env.example)。

- 本地数据在 `apps/api/prisma/dev.db`，重启不丢失；备份时先停服务，`-wal` / `-shm` 一起保留
- 修改 API 端口后，同步设置前端 `API_PROXY`；修改访问地址后，同步 `WEB_ORIGIN`
- 生产 Cookie 使用 `Secure`，需要 HTTPS
- 头像默认保存在 `apps/api/uploads/avatars`，可用 `AVATAR_STORAGE_DIR` 指定位置

## 工程结构

```text
apps/
  api/
    prisma/              SQLite 模型与迁移、PostgreSQL 模型与迁移
    src/                 NestJS 控制器、服务、DTO、权限与 AI 契约
    test/                接口集成测试
  web/
    src/
      views/             页面
      components/        视角、约定、回访与通用组件
      api.ts             请求、错误与操作提示
      store.ts           Pinia 会话与空间状态
      types.ts           前端业务类型
scripts/                 环境初始化、PostgreSQL 验证与部署包脚本
tests/                   Playwright 双人完整流程
docs/                    功能规划、待办、UI、空间生命周期、邮箱说明
deploy/                  阿里云部署脚本与运维说明
```

## AI 接口（预留）

契约位于 `apps/api/src/ai.ts`，默认关闭、生产无入口：

- `POST /api/ai/records/:id/summarize`：内容整理
- `POST /api/ai/records/:id/related`：重复问题分析

关闭时返回 403 `AI_DISABLED`，开启但未配置适配器时返回 503 `AI_NOT_CONFIGURED`。投影给适配器的数据只包含本空间已共享的记录、已发布视角、曾生效的约定与回访。

## 测试与检查

| 命令                       | 内容                                            |
| -------------------------- | ----------------------------------------------- |
| `pnpm build`               | 后端编译 + 前端类型检查与生产构建               |
| `pnpm test`                | 接口集成测试（使用独立临时 SQLite）             |
| `pnpm test:e2e`            | 先构建，再用 Playwright 跑桌面与 390px 双人流程 |
| `pnpm test:backup`         | 备份与恢复脚本                                  |
| `pnpm test:deploy`         | 部署前置检查                                    |
| `pnpm test:postgres --e2e` | 在独立 PostgreSQL 环境跑接口与浏览器测试        |

浏览器测试使用 5174 和 18081 端口，数据库与头像放在 `.cache` 下，不触碰日常数据。Windows 上检测到标准路径 Chrome 时会自动使用，其他环境先执行 `pnpm exec playwright install chromium`。`test:postgres` 需要设置 `TEST_DATABASE_URL`，脚本会建立并清理独立的 `ln_test_` schema。截图与报告在 `test-results`、`playwright-report`，用 `pnpm exec playwright show-report` 查看；容器部署与备份恢复由 CI 的容器任务验证。

## 部署

生产使用 Docker Compose、Caddy 与 PostgreSQL，安装、HTTPS、备份、恢复与升级步骤见 [部署说明](deploy/README.md)。服务器使用独立的 PostgreSQL 数据库，本地 SQLite 数据不会自动上传或转换。

## 文档

| 文档                                                  | 内容                           |
| ----------------------------------------------------- | ------------------------------ |
| [功能规划](docs/ROADMAP.md)                           | 需求、方案、实施进展与交付记录 |
| [待办总表](docs/TODO.md)                              | 未上线、未实现或暂缓的事项     |
| [UI 待修改](docs/UI_TODO.md)                          | 界面问题与美化计划             |
| [空间关闭与恢复](docs/SPACE_LIFECYCLE.md)             | 关闭、限时恢复、彻底删除的规则 |
| [邮箱验证与找回密码](docs/EMAIL_RECOVERY.md)          | 验证码、限流与投递验收         |
| [Workbench 邮箱升级](docs/WORKBENCH_EMAIL_UPGRADE.md) | 服务器升级与回退步骤           |
| [部署说明](deploy/README.md)                          | 安装、HTTPS、备份、恢复、升级  |

## 当前状态

已上线：昵称与头像、修改密码、邮箱验证码注册与找回、空间解绑 / 关闭 / 限时恢复 / 彻底删除、统一品牌图标与页面视觉更新，以及统计自定义日期区间、时间分桶和双人对比。生产入口为 [web.littlenotes.cn](https://web.littlenotes.cn)，各阶段的交付与验收记录见[功能规划](docs/ROADMAP.md)。

尚未实现：账号注销、数据导出、备份异地保存等，见[待办总表](docs/TODO.md)。

不在当前版本范围：图片附件、外部通知、社交内容、付费功能。

## 许可

MIT
