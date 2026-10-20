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

## 原生 select 在 140% 缩放下的文字会被裁掉下半截

- 日期：2026-10-20
- 场景：全站重设计后，用户在 Windows 140% 缩放的 1825×923 窗口里看到筛选栏「全部分类 / 全部状态」只剩上半截字。
- 症状：`<select>` 的文字被一条水平线切掉底部；同样字号同样内边距的 `<div>` 渲染正常。DPR 1 时不明显，1.4 时稳定复现。
- 根因：Chrome 对 select 内部行盒的高度有额外要求，固定 `height: 40px` 且上下内边距较小时，文字会溢出内容盒并被 `overflow: clip` 裁切；改 `line-height`、`appearance: none` 都无效。
- 做法：`appearance: none` + 自绘 chevron，模板不再依赖原生箭头；select 改为 `height: auto`、上下内边距 12px（自然高约 47px），并把同组输入框、按钮统一到 46px，保证一行控件等高。
- 预防：不要给 select 写死高度；任何「文字被横切」的现象先用 1.4 倍 DPR 复现，再对比同款 div 的渲染，能快速判断是控件还是布局问题。
