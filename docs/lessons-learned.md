# 经验记录

本文件只记录非显而易见的失败、根因和做法；通用编程知识、一次性流水账不写。

格式见 [开发流程](DEVELOPMENT.md) 附录 D。每条包含：日期、场景、症状、根因、做法、预防。

## 无语言标记的接口片段会被 Prettier 按 TS 重排

- 日期：2026-10-20
- 场景：给 `docs/WECHAT_MINIPROGRAM_MIGRATION.md` 加格式门禁时试跑 `prettier --check`。
- 症状：`POST /api/auth/wechat/login` 被改写成 `POST / api / auth / wechat / login;`，请求体也被展开成 TS 对象。
- 根因：代码块被标记或推断为 `ts`，Prettier 按 TypeScript 解析；内容本身不是合法 TS。
- 做法：在 `.prettierignore` 排除该迁移草稿；接口片段应使用 `text` 或 `http` 语言标记。
- 预防：文档里的伪代码、接口示例统一用 `text` 代码块；格式检查改动语义时先停下来核对。
