# XIE YIFAN

个人站点。Astro 6 静态生成，手写 CSS，没有前端框架。浅色为主、深色自动跟随系统并可手动切换。

## 页面

| 路径 | 内容 |
| --- | --- |
| `/` | 首页：署名 hero（网格光效随指针亮起）、站点体量、最新文章 |
| `/about` | 关于：个人介绍、技术栈、教育经历、荣誉与证书（点击放大） |
| `/posts`、`/posts/[slug]` | 文章列表与详情，带阅读进度条 |
| `/projects` | 开源项目列表 |
| `/tools` | 工具索引，下面六个工具页 |
| `/links` | 友链，以及交换友链需要的本站信息 |

六个工具**全部在浏览器里跑**，文件不上传到任何服务器：

- `/tools/image-converter` 图片格式转换。PNG / JPEG / WEBP 走 Canvas，BMP / TIFF / GIF / ICO 是本仓库自己写的编码器（`src/scripts/image/`），SVG 内嵌 PNG data URL。多文件会打包成一个 ZIP（`src/scripts/zip.ts` 手写的 store 模式）。
- `/tools/video-converter` 视频转码与抽音轨，ffmpeg.wasm 从 CDN 按需加载，整个会话只加载一次。
- `/tools/base64` 文本与图片的 Base64 互转。
- `/tools/color-converter` HEX / RGB / HSL 实时互转，带系统取色器。
- `/tools/timestamp` 时间戳与日期互转，可换时区，夏令时按当天实际偏移算。
- `/tools/markdown-reader` Markdown 预览与编辑，自带渲染器（`src/scripts/markdown.ts`，全文转义，不引第三方库）。

## 目录结构

```
public/
├── certificates/         # 证书图片
├── friends/              # 友链头像（建议本地化，别直挂对方的图）
├── portrait.webp         # 关于页头像（透明底）
├── profile.webp          # 分享用头像（白底不透明）
└── viewer.min.{css,js}   # 证书大图查看器
src/
├── components/           # Nav / PageHeader / PostCard / Tag / ToolShell / FriendCard / ThemeToggle / HeroFx
├── content/blog/         # 文章（Markdown）
├── layouts/Layout.astro  # 全局 head、主题初始化、页顶装饰带、回到顶部
├── pages/                # 路由，pages/tools/ 下是六个工具页
├── scripts/              # 工具页的纯逻辑，与页面解耦，可单独测
└── styles/
    ├── tokens.css        # 设计令牌：颜色、字号、间距、圆角、动效
    ├── base.css          # 重置 + u- 前缀工具类
    ├── tool.css          # t- 前缀的工具页控件
    └── markdown.css      # 正文排版，文章页与 Markdown 阅读器共用
```

## 改样式

`src/styles/tokens.css` 是全站唯一的数值来源。颜色、字号、行高、字距、间距、圆角、动效时长和缓动曲线都在这里，页面样式只写 `var(--x)`，不写深色专用规则——深色是同一批变量名的另一套值。

几条约定：

- 命名按语义不按外观：`--text-2` 是"次要文字"而不是"灰色"。
- 字号、行高、字距成套定义（`--fs-h1` / `--lh-h1` / `--ls-h1`），字距随字号变，不存在一个全局 `letter-spacing`。
- 正文行长由 `--measure` 决定，容器宽度 `--w-narrow` 从它倒推。因为 `box-sizing: border-box`，容器的 `max-width` 里含栏距，正文外面还套着一张有内边距的纸——直接写一个像素值会让实际行长比预期短一大截。
- 无障碍偏好（`prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast`）在 tokens 层统一响应。

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 构建到 dist/
npm run preview    # 预览构建结果
```

`npm run build` 只转译不做类型检查。要类型检查得先装 `@astrojs/check` 和 `typescript`，本仓库刻意没装。

## 加内容

**文章**：在 `src/content/blog/` 新建 `.md`，文件名就是 URL slug。frontmatter：

```yaml
---
title: 文章标题
description: 一句话摘要
date: 2026-05-08
tags:
    - 标签1
    - 标签2
---
```

**项目**：改 `src/pages/projects.astro` 的 `projects` 数组，字段 `name` / `description` / `url` / `tags`。

**荣誉与证书**：图片放进 `public/certificates/`，路径按顺序加到 `src/pages/about.astro` 的 `allCerts` 数组；然后在 `awards` 里加一条，用 `certIndex` 指向 `allCerts` 的下标。没有对应证书的荣誉写 `certIndex: -1`，卡片就不可点。

```js
const awards = [{ title: '荣誉名称', certIndex: 0 }];
```

**友链**：改 `src/pages/links.astro` 的 `friends` 数组，只要三样——`name`、`bio`，以及可选的 `avatar` 和 `url`。头像先下载到 `public/friends/` 再引用；没有 `avatar` 会退回昵称首字，没有 `url` 就渲染成不可点的卡片。

## 部署

纯静态站点，产物在 `dist/`，任意静态托管都能用。Cloudflare Pages / Vercel / Netlify 连上仓库后，构建命令 `npm run build`，输出目录 `dist`。

## 待补：域名

`astro.config.mjs` 里的 `site` 还是注释状态。拿到正式域名后填进去并取消注释，两件事会自动生效：

1. `src/layouts/Layout.astro` 里的 canonical 链接与 `og:image` 绝对地址；
2. sitemap —— `@astrojs/sitemap` 已在依赖里，但它强制要求 `site`，提前启用会直接构建失败，所以先注释掉。

友链页展示的"本站信息"里的头像和站点地址也是从 `Astro.site` 取的，域名填好就自动变成完整地址。

## 技术栈

Astro 6 · Content Collections · 手写 CSS（无框架、无预处理器）· ffmpeg.wasm（仅视频工具页按需加载）

