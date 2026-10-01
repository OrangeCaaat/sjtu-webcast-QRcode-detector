# 课堂哨 · 开发说明

本文件面向维护者，说明源码结构、构建、测试与发布流程。安装和日常使用见 [README.md](README.md)。

当前版本 **0.1.1**，技术栈为 **TypeScript、Vite、原生 HTML/CSS、Manifest V3、ZXing-WASM**。支持 Google Chrome 和 Microsoft Edge；最低 Chromium API 基线为 116，不代表每个历史版本均已实测。

## 环境与构建

需要 Node.js **22.12+**，推荐 24；浏览器测试和手动测试工具还需要 Python。以下命令均在项目根目录运行。

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

构建脚本先检查类型、准备本地 WASM 和许可证，再分别构建扩展页面及 content script。输出：


| 路径                           | 用途                                         |
| -------------------------------- | ---------------------------------------------- |
| `dist/`                        | 可直接加载的扩展目录，包含`manifest.json`    |
| `课堂哨-Edge-Chrome-0.1.1.zip` | 用户安装包                                   |
| `temp/build/<时间戳>/`         | 每次构建的独立暂存目录；安装包仅包含本次产物 |

在 Chrome / Edge 的扩展管理页开启开发者模式，加载 `dist/`。修改后重新构建、重载扩展并刷新课程页。Vite 开发服务器用于页面预览和自动化测试，不能替代完整扩展的采集权限验证。

## 项目结构


| 路径                                           | 职责                                                   |
| ------------------------------------------------ | -------------------------------------------------------- |
| `public/manifest.json`                         | 版本、权限、入口及 CSP                                 |
| `extension/`                                   | 弹出面板、声音设置和 offscreen 的 HTML 入口            |
| `src/service-worker.ts`                        | 会话、消息、通知、设置、开页及恢复                     |
| `src/offscreen.ts`                             | 标签采集、区域裁剪、帧调度、检测线程及声音协调         |
| `src/content.ts`                               | 播放器定位、手动选区、坐标更新、可收起及拖动的网页控件 |
| `src/detection/`                               | 解码、定位符候选及轮次/冷却/去重规则                   |
| `src/audio.ts`                                 | 默认声音、自定义音乐、音量、循环与停止                 |
| `src/shared/`                                  | 消息和状态类型、设置验证、IndexedDB 音频存储           |
| `src/popup.ts`、`src/options.ts`、`src/ui.css` | 面板和设置页交互与样式                                 |
| `tests/`                                       | 单元测试、合成素材生成器、浏览器和扩展测试             |
| `tools/manual/`                                | 可分发的手动验收页面、合成二维码及本机服务器           |
| `scripts/`                                     | 构建、依赖准备及 ZIP 打包                              |
| `tools/ci/checks.yml`                          | 可选 GitHub Actions 模板，尚未启用                     |
| `temp/`、`test-results/`、`tests/private/`     | 本地中间文件、输出和私有素材，不提交                   |

## 运行机制

用户从工具栏开启后，Service Worker 建立会话，通过 `tabCapture` 获取标签页视频流，由 offscreen 文档采集。直播声音保留；关闭面板不停止采集。

Content script 确认当前大播放器或手动选区，将区域和视口尺寸发送给采集端。只裁剪并识别该区域，不检测整个浏览器界面。区域无法确认时进入恢复/问题状态；手动区域在滚动、缩放或视口变化后需重新确认。

Web Worker 使用本地 ZXing-WASM 做整体、分块及候选放大扫描。未解码候选需通过三定位符几何关系、二维黑白方环、分隔区和对比度检查，减少文字及装饰误报。检测任务不堆积，忙时跳过旧帧。

- 解码成功连续两次确认后报警；未解码候选持续至少 1.5 秒、出现至少两次后报警。
- 检测间隔内部为 `250 / 500 / 1000 / 2000` 毫秒，默认 `500`。
- 健康状态、二维码轮次和声音消警独立管理；消警只停止声音。
- 所有二维码连续消失达到冷却时间后进入下一轮；同轮动态刷新不重复响。
- 自动打开默认关闭。每处二维码每轮首次解码时后台打开 HTTP/HTTPS，同轮完整链接去重；位置身份不确定时暂停自动开页。
- 暂停播放器时继续检测当前画面；静止 PPT 不因画面不变而故障报警。播放器声称正在播放但时间长时间不推进时诊断可能断流。
- 监听采集轨道结束、线程异常与心跳丢失；条件允许时最多重试 10 秒，失败后故障报警。正常 Service Worker 休眠不作为故障，周期检查兜底。

运行消息携带会话编号，旧会话结果拒绝处理。设置使用本机存储，自定义音频使用 IndexedDB；临时状态支持 Service Worker 重新唤醒。画面不上传，不保存二维码历史，不在诊断报告中记录完整二维码参数。

基础权限为 `activeTab`、`scripting`、`tabCapture`、`offscreen`、`storage`、`notifications`、`alarms`；没有默认全网站权限、麦克风权限或读取所有标签页的 `tabs` 权限。测试副本的 localhost 权限不得混入正式清单。

## 自动化测试

安装 Python 测试依赖和独立 Chromium，再生成公开合成素材：

```powershell
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
python tests/generate_fixtures.py
```

先完成 `npm run build`，然后在一个终端启动服务器：

```powershell
npm run dev -- --port 5173
```

另一个终端执行：

```powershell
npm run test:browser
npm run test:extension
npm run test:pipeline
npm run test:regression
python tests/package_check.py
```


| 命令                     | 覆盖范围                                                           |
| -------------------------- | -------------------------------------------------------------------- |
| `npm run typecheck`      | TypeScript 类型检查                                                |
| `npm test`               | 定位符、设置、确认、轮次、冷却及开页去重规则                       |
| `test:browser`           | 使用 API 桩的 GUI 行为、输入、声音入口和布局                       |
| `test:extension`         | 隔离配置下加载实际 MV3 包、消息、选区、控件及重启异常提示          |
| `test:pipeline`          | 合成媒体下的完整内部链路、35 秒静默、报警、开页、去重及故障恢复    |
| `test:regression`        | 合成负例、默认声音输出、静音与停止；存在私有误报截图时追加裁剪回归 |
| `tests/package_check.py` | 安装包 CRC、清单、离线资源、许可及权限                             |

`test:pipeline` 替换采集授权入口和媒体源，不能代替真实 `tabCapture`、交大页面或最小化验证。`test:extension` 使用独立 Chromium，也不能替代两种用户浏览器的实机验收。

私有截图可保存在 `tests/private/`，不进入公开仓库。`test:samples` 是针对原始两张课程截图的定制裁剪测试，默认读取 `sample1.png`、`sample2.png`，也可显式传路径；不应当作任意截图的通用验收器。无私有素材时可以运行公开回归：

```powershell
python tests/visual_regression.py --public-only
```

测试输出统一位于 `test-results/`；浏览器测试配置及构建暂存位于 `temp/`。

## 手动验收工具

工具使用合成课程 canvas 和示例链接，不包含真实签到链接、用户截图或账号数据。支持两码显示/隐藏、同处刷新、10 秒与 30 分钟定时，用于真实采集和后台持续检查。

源码直接运行：

```powershell
python tools/manual/serve.py
```

服务器仅监听 `127.0.0.1`，使用空闲端口并打开默认浏览器；将打印的地址复制到 Chrome 或 Edge。按 `Ctrl+C` 停止。无需 Python 第三方依赖。

打包命令：

```powershell
python scripts/package-manual.py
```

输出根目录 `课堂哨-手动验收工具.zip`，包含启动脚本、辅助页面、合成图片及中文说明。先更新验收记录和相关指南，再打包，保证工具内文档与发布版本一致。

## 验收状态

0.1.1 工程验证包括：20 项规则测试、20 项 GUI 检查、19 项隔离扩展检查、11 项合成链路检查；误报截图 8 个裁剪区域及 3 个合成负例无检出，原始三个二维码成功解码。真实 Chrome 标签采集、交大课程二维码片段、暂停画面、消警及控件操作已通过快速检查。

**2026 年 10 月 1 日，使用者反馈需要手动完成的测试已全部完成并通过。** 此结果属于使用者实机验收反馈；本次未新增逐项延迟和资源占用数据。结果已同步到 [验收记录.md](验收记录.md)，保留工程自动化和用户实测的来源区分。

## 发布包

`npm run build` 同时生成 `课堂哨-使用指南.md`，并将相同内容作为 `使用指南.md` 放入插件 ZIP。该说明来自 README 的用户使用章节，排除末尾的测试工具和开发说明入口。

GitHub Release 仅上传插件安装包及独立用户使用指南。开发说明、测试工具、测试代码和验收记录保留在源码仓库，不作为 Release 附件或安装包内容。
