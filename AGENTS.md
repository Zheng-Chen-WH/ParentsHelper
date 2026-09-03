# ParentHelper（智能助手）— 项目约定

给父母用的手机 AI 助手：纯前端 PWA，零后端。手机浏览器直连 Kimi/DeepSeek API，Python 沙盒用端侧 Pyodide。

## 发版规则（每次改代码都必须执行）

1. `app.js` 里的 `APP_VERSION` 递增 0.01（如 v0.12 → v0.13），用户用它确认真机已刷新。
2. `sw.js` 里的 `CACHE` 版本号递增（如 kj-assistant-v14 → v15），否则旧缓存会顶住新代码。
3. 部署：整个文件夹拖到 Cloudflare Pages 项目 `parenthelper` → Create deployment。域名 `parenthelper.pages.dev` 不变，二维码不用重新生成。

## 文件结构

- `index.html` / `style.css` — 界面与样式（字号用 rem，根字号由设置页滑块驱动）
- `app.js` — 主逻辑（多对话、设置、场景按钮、扫码、检测、夜间模式、引导、错误报告、文件解析）
- `providers.js` — Kimi/DeepSeek/千问（DashScope 兼容模式）流式 SSE 客户端
- `agent.js` — tool_calls 循环（官方工具 web_search/code-runner + 内置 $web_search 回退 + run_python）
- `sandbox.js` / `pyworker.js` — Pyodide Web Worker 沙盒（code-runner 失败时的回退）
- `voice.js` — 朗读 TTS（语音识别已移除：国产浏览器普遍阉割，改造成了文件上传 📎）
- `pyodide/` — 本地托管的 Pyodide 0.26.4 运行时（约 55MB，缺文件会加载失败）
- `vendor/` — qrcode.js（生成）、jsQR.js（解码）、pdf.min.js+pdf.worker.min.js（PDF 解析）、mammoth.min.js（docx 解析）

## API 踩坑记录（改动前必读，全部用真实 Key 验证过）

- **联网搜索主通道 = 官方工具（Formula API）**：`GET /v1/formulas/moonshot/web-search:latest/tools` 拿声明 → 标准 function tool 流程 → `POST /v1/formulas/{uri}/fibers` 执行。**K2.6 思考+搜索可并用**（实测 3 轮搜索全程带 reasoning_content）。失败时回退内置 `$web_search`。
- **没 Kimi Key 时的自给自足通道（Responses API，未经真实 Key 验证）**：千问走 `dashscope.../v1/responses`（`web_search` + `code_interpreter`），DeepSeek 走 `api.deepseek.com/v1/responses`（`web_search`）。工具全部服务端执行，无 tool_calls 循环；事件流解析 `response.output_text.delta` / `response.completed`。
- **沙盒主通道 = 官方 code-runner**：URI 是 `moonshot/code_runner:latest`（**下划线**；web-search/fetch 才是连字符，写成 `code-runner` 会 404 被静默回退端侧——v0.33 修过一次）。工具名 `code_runner`，参数 `{code}`，结果在 `context.output`；失败回退端侧 Pyodide（回退前会把原始错误写进错误日志）。官方工具从同一账户余额按次计费（限时免费中）。
- **不要传 temperature/top_p**：K2.6/K2.5 推理模型只允许默认值，传了报 400 `only 1 is allowed`。
- **`max_tokens` 必须给足**（当前 16384）：联网搜索注入结果后思考+回答常超 2000 token，太小会截断成空回答。
- **`$web_search`（内置，回退路径）回传的 tool_call 必须保留 `"type": "builtin_function"`**：流式累积时容易丢，丢了服务端不注入搜索结果，模型会声称"没法联网"。
- `$web_search` 的 arguments 里没有 query 字段，只有 `search_result.search_id`；官方通道的 `web_search` 有明文 query。
- assistant 回传消息 `content` 用空串 `''` 不用 `null`；思考模型的 `reasoning_content` 必须原样保留。
- 联网搜索实测：设置页一键检测第 5 项跑完整循环（官方通道），失败时看原始错误。
- **模型可能一次发起多个并行 tool_calls**（如 `web_search:0` 和 `web_search:1`），必须每个都回 tool 消息，漏一个下轮就 400 `must be followed by tool messages`。

## 国产 ROM 适配要点（目标用户不用 Chrome）

- 扫码：纯 JS jsQR，不依赖 BarcodeDetector。
- 语音：SpeechRecognition/speechSynthesis 在鸿蒙/vivo 自带浏览器普遍缺失，降级为提示用输入法语音键；朗读做触摸预热 + 中文嗓音挑选。
- 鸿蒙：杀后台激进（切走页面重载）→ 30 分钟内重载恢复对话现场；流式每 2 秒落盘。"添加到桌面"是轻应用容器，存储可能隔离 → 用「固定配置到网址」把配置编进 URL hash。
- **存储：对话记录（含图片）放 IndexedDB**（localStorage 只有 5MB 硬上限，几张照片就爆且会让发送流程整个卡死——血泪教训）；配置/prompt/场景仍在 localStorage。启动时调 `navigator.storage.persist()` 防自动清理。
- 旧内核：structuredClone 有 JSON 兜底；dvh 有 vh 回退。

## 测试

本机 `python -m http.server 8765` 后打开 `http://localhost:8765`。核心链路（SSE、tool_calls、沙盒、QR 编解码）曾用 Node 脚本 + 真实 API 验证；改 agent.js/providers.js 后应重跑真实 API 端到端验证。
