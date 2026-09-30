# 课堂哨 · SJTU Webcast QR Monitor

Edge / Chrome 的课程直播二维码提醒插件。手动开启后检测直播画面，用循环声音、系统通知和浮动控件提醒；可以选择把识别到的网页链接在后台标签页打开。

**当前状态：0.1.1 测试版。已通过 Chrome 真实标签采集、交大已登录课程页的暂停画面和二维码片段检查；Chrome / Edge 遮挡和最小化各 30 分钟的持续验收尚未完成。**

## 安装

下载 `课堂哨-Edge-Chrome-0.1.1.zip`，解压到固定文件夹。进入 `chrome://extensions` 或 `edge://extensions`，打开开发者模式，选择“加载已解压的扩展程序”，选中包含 `manifest.json` 的解压目录。不要直接选择 ZIP。

完整步骤见 [安装与使用.md](安装与使用.md)，测试范围和限制见 [验收记录.md](验收记录.md)。手动实机测试请按 [实机验收操作指南.md](实机验收操作指南.md) 操作；配套合成验收工具可定时显示二维码，便于检查遮挡、最小化和长时间静默后的报警。

## 功能

- 每个浏览器一次监控一门课程；默认识别交大页面的大播放器，也可换选或手动框选。
- 检测间隔：**0.25s / 0.5s / 1s / 2s**，默认 **0.5s**；冷却时间默认 10 秒，支持 1–300 秒整数输入。
- 解码二维码及连续出现的可信疑似结构均可报警。手动消警后继续监控，同轮不重复响。
- 网页控件可收起为指示灯，也可拖动；暂停视频时继续检测当前画面。
- 支持本地 MP3 / WAV / OGG、音量和声音测试；故障使用不同的提示音。
- 自动开页默认关闭；同处动态码每轮只打开一次，相同链接去重，只打开 HTTP / HTTPS。
- 画面与音乐只在本机处理，不上传、不保存二维码历史，不自动签到或答题。

## 开发

需要 Node.js 22.12+（推荐 24）。

```powershell
npm ci
npm test
npm run build
```

构建输出 `dist/` 和根目录 ZIP。每次构建使用新的 `temp/build/` 暂存目录，ZIP 仅包含本次构建文件；脚本不批量删除历史文件。

可选 GitHub Actions 配置保存在 `tools/ci/checks.yml`。启用时将其复制到 `.github/workflows/checks.yml`；通过 OAuth 凭据提交工作流需要 `workflow` 权限。该模板未自动启用，本轮验证在本机完成。

浏览器测试需要 Python 和 `tests/requirements.txt` 中的依赖，以及 Playwright Chromium。先运行 `npm run dev -- --port 5173`，再在另一终端运行：

```powershell
python tests/generate_fixtures.py
npm run test:browser
npm run test:extension
npm run test:pipeline
npm run test:regression
```

`test:pipeline` 使用独立测试配置、额外的 localhost 测试权限和合成媒体源，**不证明真实 tabCapture 或最小化可靠性**。`test:samples` 需要本地私有截图，可向 `tests/sample_detection.py` 传入两张截图路径；素材不进公开仓库。

`test:regression` 检查公开合成非二维码画面、默认声音输出及停止；若 `tests/private/regression/` 存在私有误报截图，还会检查其裁剪区域。私有素材和输出不提交。

## 技术结构

- Service Worker：会话、权限、通知、状态存储、开页和恢复。
- offscreen：标签页视频采集、裁剪、调度和声音；关闭弹出面板不停止它。
- Web Worker：本地 ZXing-WASM、多码分块解码及三定位符候选检测。
- Content script：播放器定位、手动选择、尺寸变化和页面浮动控件。

基础权限为 `activeTab`、`scripting`、`tabCapture`、`offscreen`、`storage`、`notifications`、`alarms`。没有默认的全网站权限、麦克风权限或 `tabs` 读取权限。最低 Chromium API 基线为 116；实际支持以验收记录为准。

## 已知边界

浏览器退出、扩展禁用和电脑睡眠期间无法报警；系统静音和通知设置会影响提醒。手动框选区域在滚动、缩放或改变窗口尺寸后需要重新确认。浏览器原生 video 全屏不能保证展示页面控件，可通过系统通知或退出全屏消警。模糊二维码可能仅能报警，未必可以解码或在电脑浏览器中完成课程操作。
