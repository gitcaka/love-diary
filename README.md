# Love Diary

一个手机端优先的双人恋爱日记 Web App。此公开仓库提供脱敏的浏览器本地演示，不连接私人站点或数据库。

[♡ 在线体验 GitHub Pages](https://gitcaka.github.io/love-diary/)

本仓库是经过脱敏的通用版本，不包含真实昵称、纪念日、生日、登录密码、云环境 ID、线上数据库内容、私人照片或商业音乐文件。

## 功能

- 简洁紧凑的手机与电脑自适应界面
- 双人无标题日记、三色文字输入、心情和天气选择
- 首页筛选、相册、仿真翻页日记本和纪念日
- 头像与文字组成的简洁日记回应
- 手机照片压缩、PWA 桌面安装和应用外壳缓存
- 演示身份登录，发布、编辑与删除仅影响当前浏览器

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run build:pages
npx vite preview --config vite.github.config.ts --host 127.0.0.1
```

打开终端显示的地址并加上 `/love-diary/`（默认 `http://127.0.0.1:4173/love-diary/`）。

## 检查

```bash
npm run lint
npx tsc --noEmit
npm test
```

## 腾讯云 CloudBase 配置

1. 复制 `cloudbaserc.example.json` 为 `cloudbaserc.json`，填写自己的环境 ID。
2. 在 `tencent-web/index.html` 的 `love-diary-api-base` 中填写自己的 HTTP 云函数地址。
3. 为 `love-diary-api` 云函数配置以下服务端环境变量：

```text
TCB_ENV_ID=你的 CloudBase 环境 ID
DIARY_WRITE_KEY=足够长的随机签名密钥
DIARY_PERSON1_PASSWORD=第一位记录者的密码
DIARY_PERSON2_PASSWORD=第二位记录者的密码
```

不要把真实密码、签名密钥或 `.env` 文件提交到 Git。

构建腾讯云静态前端：

```bash
npm run build:tencent
```

## Cloudflare 配置

项目也保留了 Cloudflare D1/KV 构建路径。创建自己的资源后，通过环境变量提供资源 ID：

```bash
npx wrangler d1 create love-diary
npx wrangler kv namespace create love-diary-media --binding MEDIA
npm run build
npx wrangler d1 migrations apply love-diary --remote --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json
```

## GitHub Pages 预览

推送到 `main` 分支后，`.github/workflows/pages.yml` 会自动构建并发布脱敏示例页面：

在线预览：[https://gitcaka.github.io/love-diary/](https://gitcaka.github.io/love-diary/)

Pages 版本不连接私人数据库。访客可以使用公开演示密码体验发布、编辑、删除日记和上传图片，数据只保存在访客自己的浏览器中：

```text
恋人A：demo-a
恋人B：demo-b
```

设置页提供“恢复示例数据”，不同访客之间不会共享或互相覆盖体验内容。

## 私人媒体

`public/bg.wav` 和 `public/og.png` 被有意排除在公开仓库之外。若需要背景音乐，请放入自己拥有版权或已获授权的音频文件；若需要社交分享图，可自行添加不含私人信息的图片并更新页面元数据。

## 数据说明

源码仓库不等于数据库备份。真实日记、照片和完整备份包不会随 GitHub 源码上传。演示数据只保存在当前浏览器，清除网站数据会丢失演示内容；自部署时应在服务器端单独备份数据库和媒体。
