# Love Diary

一个手机端优先的双人恋爱日记 Web App。两位记录者可以使用各自的身份密码写日记，访客可以只读浏览公开内容。

本仓库是经过脱敏的通用版本，不包含真实昵称、纪念日、生日、登录密码、云环境 ID、线上数据库内容、私人照片或商业音乐文件。

## 功能

- 双人无标题日记、文字颜色、心情、天气、标签和收藏
- 时间线、日历、相册、翻页日记本、回忆回顾和恋爱月报
- “想和你做的 100 件事”、纪念日、时间胶囊和日记回应
- 手机照片压缩、完整备份包、PWA 桌面安装和离线缓存
- 公开访客只读；身份密码仅在服务端环境变量中配置
- 腾讯云 CloudBase 数据库与对象存储支持

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000/`。

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

```text
https://<你的 GitHub 用户名>.github.io/love-diary/
```

Pages 版本不连接私人数据库。访客可以使用公开演示密码体验发布、编辑、删除日记和上传图片，数据只保存在访客自己的浏览器中：

```text
恋人A：demo-a
恋人B：demo-b
```

设置页提供“恢复示例数据”，不同访客之间不会共享或互相覆盖体验内容。

## 私人媒体

`public/bg.wav` 和 `public/og.png` 被有意排除在公开仓库之外。若需要背景音乐，请放入自己拥有版权或已获授权的音频文件；若需要社交分享图，可自行添加不含私人信息的图片并更新页面元数据。

## 数据说明

源码仓库不等于数据库备份。线上日记、照片和完整备份包都不会随 GitHub 源码上传，请通过应用内“设置 → 数据安全”单独导出并妥善保管。
