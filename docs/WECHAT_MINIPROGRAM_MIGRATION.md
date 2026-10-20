# 微信小程序迁移方案

更新日期：2026-10-19。状态：方案建议，未开始实施。本文只描述迁移路径，不代表已经确认排期。

## 0. 结论

- **后端继续复用，不重写。** `apps/api` 已经是纯 JSON API，业务规则（空间权限、版本校验、事务）都在服务端，这些是小纸条最值钱的部分。小程序改造集中在鉴权入口：Cookie 会话扩展为 Bearer Token，新增微信登录。
- **前端不直接搬。** `apps/web` 的 Vue 组件、vue-router、Tailwind、`<dialog>`、`<canvas>` 头像裁剪都依赖浏览器运行时。推荐新建 `apps/miniprogram`（uni-app，Vue 3 + TS + Vite），复用 `types.ts`、`store.ts` 和大部分请求/权限逻辑，模板与样式按 WXSS 重写。
- **真正的关键路径不在代码。** 小程序主体与类目、小程序备案、服务器域名，这三件事决定能不能上线；其中备案通常要等数个工作日到数周。
- **双端并存。** 现有网页端继续用，两端共用一套 API 和一套业务规则；登录方式按端区分，不互相干扰。

预估工作量：约 30–40 人日；含提审与备案等待，单人 7–9 周，两人并行 4–5 周。

## 1. 先决条件（先办，不要等代码写完）

| 事项 | 为什么 | 要做的事 | 周期 |
| --- | --- | --- | --- |
| 主体 | 个人主体的可选类目、可用能力（如手机号快速验证）明显更少，审核也更看重内容导向 | 决定用个人还是企业/个体工商户主体注册小程序；企业主体后续可接开放平台打通 unionid | 1–3 天 |
| 类目 | 类目决定审核标准和可用接口 | 建议选「工具 > 效率」或「工具 > 笔记」。**不要**选「社交-社区/论坛」「婚恋交友」，这两类通常要额外资质，且审核会按公开社区标准要求内容治理 | 1 天 |
| 小程序备案 | 2023-09 起新小程序必须先完成备案才能发布；网站备案号（沪ICP备2026047310号）**不能**代替小程序备案 | 微信公众平台 → 设置 → 基本设置 → 小程序备案，提交主体证件、负责人、应急联系方式 | 数个工作日到数周 |
| 服务器域名 | `wx.request` 只允许 HTTPS 且已备案的域名，不能用 IP、localhost、http | 当前 `web.littlenotes.cn` 已是 HTTPS + 备案，可以直接填。需要同时配置到 **request**、**uploadFile**、**downloadFile** 三类（头像 `<image>` 走 downloadFile） | 1 天，配置后即时生效 |
| 用户隐私保护指引 | 收集头像、昵称、相册/相机、设备信息必须在后台声明，否则相关接口调用会被拦截 | 公众平台声明 + 代码里处理 `onNeedPrivacyAuthorization` / `wx.requirePrivacyAuthorize` | 1 天，审核约 1–2 天 |
| 内容安全 | 有 UGC（记录、视角、约定、昵称）就必须接入文本/图片检测，审核会实际验证 | 后端接 `msgSecCheck`（文本）与 `mediaCheckAsync`（图片），准备 openid 与 access_token 缓存 | 2–3 天 |
| 小程序名称 | 「小纸条」可能已被占用 | 准备 2–3 个备选名称与简介，名称不要出现"情侣""交友"等导向词 | 即时 |

> 平台规则会变，具体以微信公众平台当期文档为准。上面写的是通常要求，不是承诺。

## 2. 技术路线选型

| 方案 | 复用程度 | 代价 | 判断 |
| --- | --- | --- | --- |
| **uni-app（Vue 3 + TS + Vite）** | 高：Vue 语法、Pinia、`types.ts`、`api.ts` 结构基本照搬；可同时产出 H5 | 模板要换成 `view/text/image`；vue-router 换成 `pages.json`；部分 CSS 写法不生效 | **推荐**。团队已经是 Vue 3，迁移心智负担最小；上线后还能顺带产出 H5 版 |
| 原生小程序 + TS | 低：模板与样式全部重写 | 只能用 `miniprogram-api-typings`；生态组件（TDesign / Vant Weapp）需另选型；无 Vite 构建体验 | 适合追求包体最小、不想要框架层风险，且愿意完全重写视图的场景 |
| Taro（React） | 低：Vue 组件要改写成 React | 学习与改写成本翻倍 | 不推荐 |
| web-view 套壳现有网页 | 极高：几乎零改造 | 体验割裂（返回键、下拉刷新、键盘、登录态都不对）；分享只能分享外链；审核对"套壳"敏感；业务域名要单独校验 | 只适合内部演示或临时验证，不要作为正式方案 |

选 uni-app 时要注意的实际限制：

- `vue-router` 不可用，路由改为 `pages.json` + `uni.navigateTo` / `switchTab`。
- 不能用浏览器专属 API：`window`、`document`、`fetch`、`localStorage`、`ImageBitmap`、`File`、`Blob`、`<dialog>`、`HTMLDialogElement`。
- CSS 选择器支持是 WXSS 子集：`*` 通配、部分伪类、`backdrop-filter` 不可靠；`gap`、`display:grid` 在新基础库可用，老安卓要实测。
- 小程序包体：主包 2 MB、总包 20 MB。当前 web 产物 289 KB，不构成约束。

## 3. 目标结构

```text
apps/
  api/                 不改结构，新增 wechat 模块与若干字段
  web/                 保持不变
  miniprogram/         新增（uni-app）
    src/pages/         home / records / agreements / statistics / space / login / invite
    src/api.ts         请求层（uni.request 版）
    src/store.ts       Pinia 会话与空间状态（大体复用）
    src/types.ts       建议抽到 packages/contracts 共享
    src/components/    视图组件
    src/App.wxss       迁移自 style.css
```

建议顺手把 `apps/web/src/types.ts` 与后端 DTO 里的枚举抽到 `packages/contracts`：两端各自维护类型，第一次改字段就会漂移。

## 4. 后端改造

### 4.1 会话：Cookie → Bearer Token

现状（`apps/api/src/auth.ts`）：

- `SessionGuard` 只读 `req.cookies.paper_session`；
- `AuthService.setSession` 只写 `Set-Cookie`；
- 小程序不能依赖 Cookie 持久化，必须改为显式 Token。

改法：把"签发会话"从"写 Cookie"里拆出来，返回 `{ token, expiresAt }`，由控制器决定是写 Cookie（web）还是在响应体返回 token（小程序）。

```ts
// SessionGuard.canActivate 中取 token 的位置
const header = req.headers.authorization;
const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
const token = bearer || req.cookies?.[cookieName];
```

注意点：

- Token 只放在 `Authorization` 头，不放 URL、不放日志。
- `wx.setStorageSync` 保存，`wx.removeStorageSync` 退出；不要放 `globalData` 之类易失位置。
- 微信登录接口返回的 `openid`、`session_key` 一律不返回给前端。
- 修改密码会撤销该用户全部会话（现有行为），小程序端收到 401 后重新 `wx.login` 即可恢复；如果希望"改密码踢掉其他设备"也覆盖小程序，需要给 Session 加 `client` 字段并按端区分策略——这是一个产品决策，建议先保持"微信端可自动重登"。

### 4.2 新增微信登录接口

```ts
POST /api/auth/wechat/login
body: { code: string }
// 服务端：code -> https://api.weixin.qq.com/sns/jscode2session
// 得到 openid/unionid -> 查 User.wechatOpenId
// 已绑定：签发 token，返回 { token, expiresAt, user }
// 未绑定：返回 { needBind: true, bindTicket }，由前端走"绑定老账号"或"新建账号"
```

- `code` 只能用一次，且有效期 5 分钟；不要缓存后复用。
- `access_token`（给内容安全、小程序码、订阅消息用）用 `stable_token` 接口并落库/落内存缓存，不要每次现取。
- 登录接口要做频率限制，现有 `AuthService.limit` 可以复用，但来源键建议改成 `openid` 或设备维度——小程序的出口 IP 是微信侧地址，按 IP 限流意义有限。

### 4.3 身份校验：邮箱验证会挡住所有小程序用户

这是最容易漏掉的一处。`SessionGuard` 现在对**所有非 Public 接口**强制要求 `emailVerifiedAt`，否则抛 `EMAIL_BINDING_REQUIRED`。小程序用户不会走邮箱流程，结果是登录成功后每个接口都 403。

改法（二选一，推荐 A）：

- **A. 引入"已验证身份"概念**：`identityVerified = emailVerifiedAt || wechatBoundAt`，Guard 只判断这一个。邮箱流程与相关错误码保持原样，web 端行为不变。
- B. 给小程序单独一套 Public 白名单：不推荐，会把权限判断分裂成两套。

同时保留现有 `EMAIL_BINDING_REQUIRED` 对 web 的语义——这个错误码目前驱动 `apps/web/src/api.ts` 里的事件，改 Guard 时不要动返回结构。

### 4.4 老账号绑定

| 策略 | 体验 | 数据 | 建议 |
| --- | --- | --- | --- |
| 微信即账号，老用户登录后输入用户名+密码绑定 openid | 老用户多一步，新用户零成本 | 完整保留 | **推荐** |
| 小程序全新建号，与网站账号互不相通 | 最简单 | 老用户数据分裂 | 不可取 |
| 手机号快速验证绑定 | 最顺滑 | 完整保留 | 需要企业主体，且按次计费；没必要为了这个引入 |

数据模型增量（SQLite 与 PostgreSQL 两份迁移，字段可空，对旧数据零影响）：

```prisma
model User {
  // ...现有字段
  wechatOpenId  String?   @unique
  wechatUnionId String?
  wechatBoundAt DateTime?
}

model Session {
  // ...现有字段
  client String? // "web" | "mp"，仅用于统计与排查
}
```

`wechatOpenId` 唯一索引要注意：一个微信只能绑一个账号，绑定失败要回滚，不要留下半绑定状态。

### 4.5 邀请：64 字符 token 塞不进小程序码

现状：`spaces.ts` 里 `randomBytes(32).toString('hex')` = 64 字符，路由是 `/invite/:token`，前端拼 `window.location.origin + '/invite/' + token`。

小程序码 `wxacode.getUnlimited` 的 `scene` 上限 32 字符，64 位 token 放不进去。改法：

- `Invitation` 增加 `shortCode`（8–10 位 base62，唯一索引），与 `token` 一一对应；
- 小程序码 `scene=shortCode`，落地页 `pages/invite/index?scene=xxx`；
- 小程序内邀请优先用**分享卡片**（`onShareAppMessage` 的 `path` 带 shortCode），比让用户扫自己手机上的码自然得多；
- web 端继续用长 token，两端映射同一邀请记录，48 小时/一次有效的规则不变。

`space-access`、`accept` 的校验逻辑不要复制第二份，统一走一个 `resolveInvitation(tokenOrCode)`。

### 4.6 内容安全

| 内容 | 接口 | 时机 |
| --- | --- | --- |
| 记录概况、视角、约定、昵称、搜索词 | `msgSecCheck`（version=2，带 openid、scene） | 写入前同步调用，不通过直接 400 |
| 头像等图片 | `mediaCheckAsync` | 上传后异步检测，未通过则置为默认头像并记录 |
| 邀请留言（若有） | `msgSecCheck` | 同上 |

策略上不要"检测失败就放行"：审核抽查到未拦截内容，会按平台规则处理。检测服务不可用时，选择拒绝写入并提示稍后重试，比静默放过安全。

### 4.7 回访提醒：邮件换成订阅消息

现有到期提醒靠首页待办 + 邮件。小程序里邮件入口很弱，建议用一次性订阅消息：

- 用户在"安排回访 / 调整回访日期"时调用 `wx.requestSubscribeMessage`，一次授权对应一条消息；
- 服务端复用 `SpaceCleanupService` 那种每分钟扫描的定时任务，到点前发送（模板字段与回访日期对齐，模板需在公共模板库选用并通过审核）；
- 用户拒绝授权不影响业务，只是收不到提醒；首页待办仍然是主路径。

### 4.8 其他后端改动

- **CORS/Origin 中间件不用改**：`wx.request` 不带 `Origin`，现有逻辑只在存在 Origin 时校验，天然放行；但不要因此放宽 web 的校验。
- **请求体上限**：Caddy 对 `/api/*` 限制 256 KB，头像裁剪后 192 KiB，够用。
- **`X-Space-Id` / `X-Space-Version`**：小程序可以直接带自定义头，保留现有并发冲突保护。
- **`/api/health`**：建议加 `build` 或 `version` 字段，方便灰度时确认线上是哪个版本。

## 5. 前端改造

### 5.1 路由映射

| 现有路由 | 小程序页面 | 说明 |
| --- | --- | --- |
| `/` | `pages/home/index` | tabBar |
| `/records` | `pages/records/index` | tabBar，分页改 `onReachBottom` |
| `/records/new` | `pages/records/new` | |
| `/records/:id` | `pages/records/detail?id=` | 分享落地页 |
| `/agreements` | `pages/agreements/index` | tabBar |
| `/statistics` | `pages/statistics/index` | tabBar |
| `/space` | `pages/space/index` | tabBar |
| `/invite/:token` | `pages/invite/index?scene=` | 小程序码 scene 解码 |
| `/login` | `pages/login/index` | 微信登录 + 老账号绑定 |
| `/bind-email` | 不迁移 | 微信身份替代邮箱验证 |
| `/forgot-password` | 不迁移 | 小程序内无法自助找回；文案引导到网页端 |
| `/dev-mail` | 不迁移 | 仅本地调试 |
| `/:pathMatch(.*)*` | 兜底页 + `onPageNotFound` | |

tabBar 正好 5 个（首页/纸条/约定/回顾/空间）。注意 tabBar 图标只支持 PNG，不能用 SVG。

### 5.2 请求层

`apps/web/src/api.ts` 的结构（`ApiError`、`setApiSpaceContext`、`useTask`、错误事件）可以整体保留，只替换传输层：

```ts
// 示意，不是最终实现
function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${BASE_URL}/api${path}`,
      method: options.method || 'GET',
      header: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...spaceHeaders,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      },
      data: options.body,
      success: (res) => {
        if (res.statusCode === 401) emit('session-expired');
        // 保留 ApiError 的 status / code / retryAfter 语义
      },
      fail: () => reject(new ApiError('暂时无法连接小纸条', 0)),
    });
  });
}
```

- 头像上传：`FormData` 改为 `uni.uploadFile({ url, filePath, name: 'file' })`，`Authorization` 放 header；字段名要和后端 `FileInterceptor` 的 `name` 一致。
- 错误码到提示的映射表尽量复用，`EMAIL_BINDING_REQUIRED`、`SPACE_`、`RESTORE_`、`409` 冲突提示都要保留。
- 开发阶段用微信开发者工具勾选"不校验合法域名"，生产必须走 `https://web.littlenotes.cn`。

### 5.3 状态与事件

- Pinia 在 uni-app 里可用，`store.ts` 的 `refresh/ensure/logout/expire` 逻辑几乎可以原样搬。
- `window.dispatchEvent(new Event('session-expired'))` 等 6 处事件，改为一个轻量 emitter（`uni.$emit` / `uni.$on` 也行），`App.vue` 里的监听改到 `App.vue` 的 `onLaunch/onShow`。
- 前台同步：`visibilitychange` + 60 秒轮询 → `onShow` 时同步一次；小程序没有多标签页，原来"普通窗口/无痕窗口"那套说明只适用于 web。
- `document.title` 改为 `uni.setNavigationBarTitle`。

### 5.4 组件映射

| 组件 | 处理 |
| --- | --- |
| `AppIcon.vue`（lucide-vue-next，40 个图标） | WXML 不支持渲染 SVG 组件。改成 iconfont（或 PNG 精灵图），保留 `name`/`size` 接口；深色/主题色需要字体图标方案，不能用 `currentColor` 换 SVG |
| `AvatarEditor.vue` | **最重的一块**。`<dialog>` + `HTMLDialogElement` + `createImageBitmap` + `canvas.getContext('2d')` + `Blob` 全部不可用。改用 `wx.chooseMedia` → Canvas 2D（`type="2d"`）绘制 → `wx.canvasToTempFilePath` → `wx.uploadFile`。拖拽手势用 `touchstart/move/end` 自己算。iOS/Android 的 `devicePixelRatio`、大图内存要真机验证 |
| `ConfirmDialog` / `PasswordChangeDialog` / `SpaceActionDialog` | `<dialog>` 改为自定义遮罩组件（`view` + `position: fixed` + 安全区），确认/取消事件语义保持不变 |
| `SecretField`（密码显隐） | 直接转 `input` + `password` 属性切换 |
| `ProfileSettings` | 头像改用 `button open-type="chooseAvatar"`，昵称用 `input type="nickname"`，仍可保留自定义裁剪入口 |
| `RecordCard` / `EmptyState` / `UserAvatar` | 直接转换，`img` → `image` |
| `PerspectivePanel` / `AgreementPanel` / `ReviewPanel` | 模板改写，交互逻辑（私密保存、双方确认、版本冲突）全部保留 |
| `SpaceLifecycleSettings` | 模板改写；关闭/解绑/恢复的三段确认流程在小屏上要重排 |
| `EmailVerification` | 不迁移 |

### 5.5 样式迁移

`style.css` 3583 行、797 个自定义类、984 处 `px`、10 个媒体查询；Tailwind 只有 1 行 `@import 'tailwindcss'`，说明**界面主要靠手写 CSS**，这是好消息——不用引入 `weapp-tailwindcss`，直接迁移类名即可。

步骤：

1. 删除 `@import 'tailwindcss'`，把 `style.css` 改名为 `App.wxss`（或 `uni.scss` + 全局样式）。
2. `:root` 的 CSS 变量改到 `page {}`，变量名保留。WXSS 支持 CSS 变量。
3. `px` → `rpx`：按 750 设计稿换算（1px@375 ≈ 2rpx）。也可以保留 px 不换算——小程序里 px 是逻辑像素，在 375 宽机型上表现一致，宽屏会显得偏小；建议统一转 rpx，或至少对字号、间距转。
4. 逐个替换不可用写法：
   - `backdrop-filter`（2 处）→ 删掉或改半透明底色；
   - `display: grid`（12 处）→ 改 flex，老安卓更稳；
   - `gap`（118 处）→ 新基础库支持，但建议关键布局用 margin/padding 兜底；
   - `env(safe-area-inset-*)`（1 处）→ 底部固定元素要补 `padding-bottom: env(safe-area-inset-bottom)`，否则 iPhone 会被 Home Indicator 挡住；
   - `aspect-ratio`（1 处）→ 用 padding-top 百分比；
   - `min()`/`max()`/`calc()` → 大部分可用，`min/max` 少量处建议直接写死。
5. 媒体查询：小程序屏幕宽度固定为手机，10 个断点大部分可以删，只保留必要的窄屏适配。
6. 交互态：`hover` 在触屏无效，`active` 类 + `hover-class` 实现按压反馈；`focus-visible` 不可用，改为输入框 focus 时的边框色。

### 5.6 平台能力清单

| 能力 | 实现 |
| --- | --- |
| 分享给好友/群 | `onShareAppMessage`：详情页分享 `pages/records/detail?id=`，约定页分享约定摘要；标题文案不要出现"求分享"式诱导 |
| 分享到朋友圈 | `onShareTimeline`（单页模式能力有限，详情页可开） |
| 邀请 | 分享卡片 path 带 shortCode；跨端邀请用小程序码（scene=shortCode） |
| 下拉刷新 | 列表页 `enablePullDownRefresh` + `onPullDownRefresh`，对应现有"刷新按钮" |
| 分页 | `onReachBottom`，替换"加载更多"按钮 |
| 未保存拦截 | `wx.enableAlertBeforeUnload`（草稿页返回时提示） |
| 日期选择 | `picker mode="date"`，替换 `input type="date"`，注意回访日期的最早可选值 |
| 复制邀请信息 | 小程序没有"链接"概念，改为分享卡片 + 复制文字（`wx.setClipboardData`） |
| 头像/昵称 | `chooseAvatar` + `nickname` 输入；临时路径必须先上传，不能直接存 |
| 键盘遮挡 | `adjust-position`、`cursor-spacing`、`textarea` 的 `fixed` 定位；原生组件层级用 `cover-view` 兜底 |
| 返回顶部 | `scroll-view` + `scroll-top` |
| 日志 | `wx.getRealtimeLogManager`，真机排查比 console 可靠 |
| 深色模式 | 小程序跟随系统，样式里若用了硬编码浅色，需确认暗色下可读；可先关闭 `darkmode` 配置 |

## 6. 页面级改造量

| 页面 | 改造量 | 要点 |
| --- | --- | --- |
| 登录 | 中 | 微信一键登录 + 老账号绑定弹层；`code` 换取 token；错误态（绑定失败、账号已绑其他微信） |
| 首页 | 中 | 待办列表、空间状态、关闭/隐藏态提示；`onShow` 刷新 |
| 纸条列表 | 中 | 搜索、分类、分页、空状态；滚动位置保持 |
| 新建纸条 | 中 | 分类/标签选择器改 `picker`；草稿保存的离开拦截 |
| 纸条详情 | 大 | 视角、约定、回访、归档、和好全部在这页；四类弹层改自定义组件；版本冲突提示要保留 |
| 共同约定 | 中 | 双方确认、版本历史、冲突处理 |
| 一起回顾 | 中 | 30/90/365 天切换、分类统计、回访分布；图表若用了 SVG 要改 canvas 或纯 CSS |
| 我们的空间 | 大 | 邀请（分享/小程序码）、成员、账号安全、解绑关闭、彻底删除多段确认 |
| 邀请落地 | 小 | `scene` 解码、登录后继续接受、失效/被撤销提示 |
| 兜底页 | 小 | `onPageNotFound` |

## 7. 里程碑

| 阶段 | 内容 | 验收 | 估时 |
| --- | --- | --- | --- |
| P0 打通 | 新建 `apps/miniprogram`，微信登录 → `/auth/me` → 首页只读 | 真机能登录、能读到自己的空间和昵称 | 3–5 天 |
| P1 账号与空间 | 老账号绑定、身份校验改造、邀请/分享、空间页 | 两台手机能建空间、互相邀请、接受成功 | 1 周 |
| P2 核心业务 | 记录 CRUD、私密草稿、双方视角、约定确认、回访 | 完整走通 README「第一次使用」的 6 步 | 2–3 周 |
| P3 平台能力 | 头像裁剪、订阅消息、分享卡片、小程序码、内容安全 | 头像上传成功；到期能收到订阅消息；文本违规被拦截 | 1 周 |
| P4 提审上线 | 隐私指引、类目、备案、真机兼容、体验版灰度 | 审核通过，正式版可分阶段发布 | 1–2 周（含等待） |

估时明细（人日）：后端微信登录与绑定 3–4；短码/小程序码/订阅消息/内容安全 4–6；请求层与骨架 2–3；11 个页面 10–14；样式迁移 5–7；头像裁剪 2–3；联调与真机修复 3–5。

## 8. 风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 类目或内容导向被拒 | 最可能打回，且会拖很久 | 定位"私密记录工具"，不做公开社区、不做用户匹配、不做付费；简介与截图避免情感交友表述 |
| 未接内容安全 | 审核抽检必查 UGC | 文本同步检测、图片异步检测，保留检测记录 |
| 备案未完成 | 无法发布，代码写完也没用 | 立项第一天就提交 |
| 老用户迁移摩擦 | 要在小程序里再输一次用户名密码 | 绑定流程做短（一屏两输入框 + 明确说明"数据会保留"）；网页端提前放公告 |
| 头像裁剪兼容 | iOS/Android 尺寸、方向、内存差异 | Canvas 2D + `devicePixelRatio`，真机各测一遍；超大图先缩放 |
| 双端不一致 | web 与小程序业务规则漂移 | 业务规则只在后端；类型抽 `packages/contracts`；两端共用测试用例 |
| 订阅消息到达率 | 用户拒绝授权或只授权一次 | 首页待办始终是主路径，订阅消息只做增强 |
| 审核反复 | 每次打回重排队 | 首次提交就准备好测试账号、体验路径说明、内容安全说明 |

## 9. 不建议的做法

- **web-view 套壳**：看起来最省事，实际体验最差（登录态、返回键、下拉刷新、键盘、分享全不对），而且审核对纯套壳不友好。只适合内部演示。
- **保留 Cookie 认证**：小程序对 Cookie 的持久化没有可靠保证，跨启动、跨版本都可能丢。
- **用邮箱验证码作为小程序主登录**：输入成本高，163 邮件到达率不可控，且与微信身份体系脱节。
- **在小程序里保留完整的注册/找回密码流程**：这些页面在 web 上继续存在即可，小程序只做微信登录 + 绑定。
- **前后端各写一套权限判断**：现有服务端权限（草稿私有、快照、双方确认）是小纸条的核心资产，小程序端只做展示层判断，不要复制规则。

## 10. 第一步（建议本周就做）

1. 注册小程序，拿到 AppID；决定主体与类目；同时提交小程序备案。
2. 在公众平台配置 `web.littlenotes.cn` 到 request / uploadFile / downloadFile。
3. 后端加 `POST /api/auth/wechat/login`、`SessionGuard` 支持 Bearer、`identityVerified` 判断；写接口测试（现有 `apps/api/test` 里加）。
4. 新建 `apps/miniprogram`（uni-app + Vue 3 + TS），只做三件事：登录、首页、我的空间只读。
5. 真机验证登录态持久化、头像加载、401 重登，再决定是否全面铺开。

第 3、4 步的产出就是一个可运行的 PoC，能在一周内回答"这条路走不走得通"，再投入剩下的页面迁移。
