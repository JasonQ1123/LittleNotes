# 小纸条 · 协作入口

一个给情侣使用的矛盾记录与共同复盘网站。Vue 3 + NestJS + Prisma；本地 SQLite，生产 PostgreSQL 16；生产部署在阿里云 Docker Compose + Caddy。

先读 [开发流程](docs/DEVELOPMENT.md)。本文件只做索引和红线，不重复流程细节。

## 常用命令

在仓库根目录执行，环境为 Node.js 24 + pnpm 11：

```powershell
pnpm install
pnpm run setup          # 复制 .env、生成 Prisma Client、应用 SQLite 迁移
pnpm dev                # API :3000，网页 :5173
pnpm build              # API 编译 + Web 类型检查/构建
pnpm test               # API 集成测试
pnpm test:e2e           # 构建后跑 Playwright（桌面 + 390px）
pnpm test:postgres --e2e # PostgreSQL 独立 schema 回归
pnpm test:backup        # 备份脚本检查
pnpm test:deploy        # 部署前置检查
pnpm package:deploy     # 干净工作区下打部署包
pnpm format             # Prettier 写入
pnpm format:check       # Prettier 检查（CI 门禁）
```

## 改什么去哪里

- API 接口、权限、事务：`apps/api/src/`
- 数据模型与迁移：`apps/api/prisma/`（SQLite 是源，`postgresql/` 是生成副本）
- API 集成测试：`apps/api/test/`
- 页面：`apps/web/src/views/`
- 复用组件：`apps/web/src/components/`
- 请求与错误处理：`apps/web/src/api.ts`
- 双人流程 E2E：`tests/`
- 部署、备份、Caddy：`deploy/`
- 需求与交付记录：`docs/ROADMAP.md`、`docs/TODO.md`
- 流程、发布、回滚：`docs/DEVELOPMENT.md`

## 硬约束

- 生产用 PostgreSQL，本地用 SQLite。模型只改 `apps/api/prisma/schema.prisma`，然后执行 `pnpm db:postgres:sync`；每次模型变更两份迁移都要写。
- 迁移只向前：生产只跑 `prisma migrate deploy`；禁止 `migrate dev`、`db push`、`migrate reset` 和手工改生产 schema。
- 空间权限统一走 `space-access.ts`。草稿、未发布视角、已关闭空间内容不得出现在对方、统计、导出或 AI 投影里。
- 多表写入放在 `Database.atomic`；记录、视角、约定的修改保留版本校验。
- 密钥只放 `.env` 或服务器环境。不要读取、输出或提交 `.env`、Cookie、用户隐私、生产数据。
- 生产邮件必须使用真实 SMTP；`EMAIL_SMTP_VERIFIED` 守卫不得绕过。
- 新增依赖、改 CI、改部署脚本、改数据模型：先说明方案，维护者确认后再做。
- 不部署、不重启生产、不改生产数据，除非维护者在当前对话明确指示。
- 不 force push `main`，不删除共享分支，不合并 PR。
- 提交保留中文类型前缀；所有改动走短分支 + PR，详见开发流程第 5 节。

## 完成前

- 跑对应门禁，把实际命令和结果写进 PR；没跑过的检查不要写「通过」。
- 涉及模型的，确认两份 schema 和迁移一致，并跑 `pnpm test:postgres --e2e`。
- 更新 `docs/TODO.md` / `docs/ROADMAP.md` 和受影响文档；非显而易见的坑写 `docs/lessons-learned.md`。
- 保持工作区干净；未完成的部分说明原因和下一步。

## 文档索引

- [开发流程](docs/DEVELOPMENT.md)：需求、分支、提交、发布、回滚、AI 边界
- [功能规划](docs/ROADMAP.md)：已确认需求与交付记录
- [待办总表](docs/TODO.md)：未做事项与优先级
- [UI 待修改事项](docs/UI_TODO.md)
- [部署说明](deploy/README.md)
- [经验记录](docs/lessons-learned.md)
