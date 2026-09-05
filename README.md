# 小纸条

一个给情侣使用的矛盾记录与共同复盘网站。把一次沟通变成可以回头查看的记录，把共同商量的办法变成可以跟进的小行动。

**记录 → 双方视角 → 共同约定 → 独立回访 → 关联历史。**

## 本地运行

环境：Node.js 24、pnpm 11。开发机不需要额外安装数据库。

```powershell
pnpm install
pnpm run setup
pnpm dev
```

请使用 `pnpm run setup`，显式运行项目脚本。初始化会在没有配置文件时复制 `.env.example`，生成 Prisma Client，并应用数据库迁移；已有配置和记录不会被覆盖。

重新运行初始化或修改数据库模型前，先停止开发服务和浏览器测试，避免 Windows 锁定正在使用的 Prisma 引擎文件。

- 网站：[http://localhost:5173](http://localhost:5173)
- API 文档：[http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- 健康检查：[http://localhost:3000/api/health](http://localhost:3000/api/health)

### 第一次使用

1. 注册自己的账号，创建共同空间。
2. 在“我们的空间”生成邀请链接。
3. 对方用独立的浏览器会话注册账号，打开邀请链接并主动接受。
4. 写一张私密草稿；准备好后分享，双方分别补充自己的视角。
5. 任一方提出解决方案，双方各自确认。
6. 到期后，从首页待办进入回访，分别记录行动与改善情况。

在一台电脑上体验双人协作时，可以使用普通窗口和无痕窗口，或者两个不同的浏览器。普通浏览器的多个标签页会共享登录状态。开发服务默认只监听本机，适合先验证流程；此时生成的 localhost 邀请也只能在同一台电脑打开。

界面提供刷新按钮；第一版通过页面加载和操作结果更新数据，没有后台推送或实时共同编辑。

## 已实现的内容

- 用户名注册登录、Argon2id 密码哈希、HttpOnly Cookie 会话、退出登录。
- 多对情侣的独立空间，每个账号一个空间，每个空间最多两人。
- 48 小时、一次有效的邀请，支持撤销与重新生成。
- 私密草稿、主动发布、事件概况、分类、标签和分页搜索。
- 双方独立填写视角，支持私密保存与公开发布；再次编辑保留上一份已发布快照。
- 解决方案版本、双方确认、原子生效、旧版本留存。
- 每轮独立回访、并列展示改善差异、调整回访日期、开启下一轮回访。
- 首页个人待办：草稿、视角、确认、到期回访和待确认归档。
- 双方分别标记和好；和好标记不清除回访任务。
- 双方共同归档、历史记录关联、分类与月份统计、重复主题和回访分布。
- 手机布局、键盘操作、错误提示、空状态和加载状态。
- AI 接口契约与供应商适配边界，默认关闭，前端无入口。

## 业务约束

### 记录与权限

共享数据始终通过服务端检查当前登录用户的空间身份。草稿只允许作者读取；事件概况只允许记录者修改；个人视角只允许本人编辑。伙伴只能读取已发布快照，不能从 API、列表或统计中读取未共享内容。

记录状态：`draft`（草稿）→ `review`（复盘中）→ `followup`（跟进中）→ `archived`（已归档）。归档由双方分别确认，之后内容只读。已共享的纸条不能单方删除。

### 约定与回访

约定状态独立于记录状态：`pending`、`active`、`superseded`。

提交新版本时会替代上一份待确认方案，之前生效的约定继续有效。双方必须确认同一份最新方案；重复确认幂等，过时确认返回冲突。第二人确认时，在一个事务中切换生效版本并建立第一轮回访。

回访默认安排在生效后七天，也可以指定日期。一人提交回访只会清除自己的待办。当前轮次双方都完成后，再次安排日期会开启新一轮；历史回访保留。尚未完成时调整日期不会清空已有回访。

记录概况、个人视角和解决方案带有版本校验；页面过时会明确提示刷新，避免无提示地覆盖另一页面的修改。

### 回顾统计

支持最近 30、90、365 天，事件按发生时间筛选、按北京时间月份汇总。私密草稿不进入共享统计。回访按提交或更新时间计入区间，每人每轮计一次。

重复主题由手动建立的历史关联形成，同一分类本身不会被当作重复矛盾。主题展示相关的历史纸条，便于对照过去的约定和回访。

## 工程结构

```text
apps/
  api/
    prisma/               SQLite 模型和初始迁移
    src/                  NestJS 控制器、服务、DTO、权限和 AI 契约
    test/                 API 集成测试
  web/
    src/
      views/              页面
      components/         视角、约定、回访和通用组件
      api.ts              请求、错误和操作提示
      store.ts            Pinia 会话与空间状态
      types.ts            前端业务类型
scripts/                  环境初始化和独立浏览器测试服务
tests/                    Playwright 双人完整流程
```

前端使用 Vue 3、TypeScript、Vite、Vue Router、Pinia、Tailwind CSS 和 Lucide 图标。后端使用 NestJS、Prisma、class-validator 与 Swagger。Vite 将 `/api` 代理到 NestJS，浏览器使用同源 Cookie。

SQLite 写事务在本地进程内排队，并使用数据库唯一约束保护成员、约定版本、确认和回访。正式迁移到 PostgreSQL、引入多个服务实例时，应重新验证并发与数据迁移行为。

## 配置和数据

配置位于 `apps/api/.env`：

| 变量           | 默认值                                        | 用途                                       |
| -------------- | --------------------------------------------- | ------------------------------------------ |
| `DATABASE_URL` | `file:./dev.db`                               | SQLite 文件，相对 Prisma schema 所在目录   |
| `PORT`         | `3000`                                        | API 端口                                   |
| `HOST`         | `127.0.0.1`                                   | 本机监听地址                               |
| `WEB_ORIGIN`   | `http://localhost:5173,http://127.0.0.1:5173` | 允许提交写请求的页面来源，多个值用逗号分隔 |
| `AI_ENABLED`   | `false`                                       | AI 功能开关，第一版保持关闭                |

本地记录保存在 `apps/api/prisma/dev.db`，重启不会丢失。数据库、会话数据、环境文件与测试产物已加入忽略规则。备份时先停止服务，再复制数据库文件；存在 `-wal`、`-shm` 等伴随文件时也需一并保留。

若更改 API 端口，同时通过 `API_PROXY` 环境变量设置前端代理目标；若更改浏览器访问地址，同时更新 `WEB_ORIGIN`。生产模式的 Cookie 使用 `Secure`，需要 HTTPS。

## AI 接口

接口位于 `apps/api/src/ai.ts`：

```typescript
interface AiProvider {
  summarizeRecord(record: SharedAiRecord): Promise<SummarySuggestion>;
  suggestRelatedRecords(
    record: SharedAiRecord,
    history: SharedAiRecord[],
  ): Promise<RelatedSuggestion[]>;
}
```

- `POST /api/ai/records/:id/summarize`：预留内容整理。
- `POST /api/ai/records/:id/related`：预留重复问题分析。

关闭时返回 `403 / AI_DISABLED`，不产生供应商网络请求。开启开关但尚未配置适配器时返回 `503 / AI_NOT_CONFIGURED`。请求始终先检查空间与共享权限。

投影给未来适配器的数据仅包含本空间已共享记录、已发布视角、曾生效约定与回访；未发布草稿不进入投影。未来接入需要增加主动触发、建议预览和确认采用流程，不自动改写共识。

## 检查与测试

```powershell
pnpm build
pnpm test
pnpm test:e2e
```

- `build`：后端 TypeScript 编译、前端 Vue 类型检查和生产构建。
- `test`：使用系统临时目录中的独立 SQLite 数据库，验证权限、邀请竞争、发布快照、版本确认、回访差异、统计边界、归档、会话与重启持久化。
- `test:e2e`：先构建，再通过 Playwright 在桌面与 390px 手机布局中操作两个独立浏览器会话；同时检查横向溢出、浏览器异常和主要页面的 WCAG A/AA 可访问性。

Windows 上已安装标准路径 Chrome 时会自动使用；其他环境先执行 `pnpm exec playwright install chromium`。也可通过 `PLAYWRIGHT_CHANNEL` 指定本机浏览器通道，例如 `chrome` 或 `msedge`。

浏览器测试使用 `5174` 和 `18081` 端口，在 `.cache` 下建立独立数据库，不触碰日常使用的数据库。页面截图在 `test-results`，报告在 `playwright-report`，可使用 `pnpm exec playwright show-report` 查看。

## 后续公开上线阶段

本版本完成本地验证流程。公开上线前补齐密码找回、解除配对与历史数据处理规则、账号注销、数据导出、备份与恢复、PostgreSQL 迁移和部署运维。

图片附件、外部通知、社交内容、付费功能和正式 AI 接入不在这一版范围内。
