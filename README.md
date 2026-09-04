# ParentHelper · 父母的手机 AI 助手

<p>
  <img src="icon.svg" width="72" alt="ParentHelper 图标" />
</p>

给父母用的手机 AI 助手：打字提问、拍照识图、联网查新闻、沙盒算账、读文件
**纯前端网页（PWA），零后端、零服务器成本**，仅需自带浏览器便可直连**Kimi**/**DeepSeek**/**千问**API。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-可安装到桌面-blue.svg)](manifest.webmanifest)
[![架构](https://img.shields.io/badge/架构-纯前端%20零后端-orange.svg)](#技术架构)

> 在线体验（作者部署的一份自用网站）：<https://parents-helper.pages.dev>
> 建议fork后自己部署，体验地址不保证长期维护，且免费部署有限流。

## 为什么做这个

想给父母用上 AI，但现成的方案都不合适：

- **官方 App**：绑定在特定模型上/订阅费贵/注册难/根本不开放注册；
- **现有聚合工具**：配置（对父母而言）复杂，若出现bug仅靠父母难以修复；

于是vibe coding了这个纯前端方案：在自己手机上填好 API Key、生成二维码，父母识别一下二维码就配置完成，避开了填key、配置模型的问题。

## 主要功能

### 对父母

- **大字体聊天**：字号滑块 16–30px 实时调，大按钮、单层设置页，不套娃
-  **首页快捷场景**：「查天气」「算日子」「问健康」一键提问，子女可远程定制
-  **拍照识图**：药盒、说明书、商品、植物，一次最多连拍 9 张（多页合同/报价单）
-  **文件上传**：PDF / Word / Excel / txt 手机本地解析；扫描件 PDF 自动转图片走识图
-  **夜间模式**：默认 22:00–7:00 自动开启
-  **过程可见**：AI 的思考过程、搜了什么关键词、算了什么代码，都能展开
-  **自动构建快捷场景**：短期多次询问同类问题，可自动生成新快捷功能并询问添加到首页

### 对配置者

- **扫码配置**：填好 Key 生成二维码，父母微信长按识别即完成；可选同时分享人设和快捷按钮
- **三家 API 自由切换**：Kimi（kimi-k2.6，默认）/ DeepSeek / 千问 Qwen，聊天和识图可分别指定渠道
- **联网搜索**：Kimi 官方工具通道（思考+搜索可并用），失败自动回退；任何聊天渠道都能借道 Kimi 搜索
- **双引擎沙盒**：日常算账/画图走端侧 JavaScript 沙盒（内置 ECharts，毫秒级启动）；重型数据分析走端侧 Pyodide；配了 Kimi Key 时优先尝试官方 code-runner 云端执行
- **方便维护**：代码修改后直接部署，父母下次打开时版本自动更新
- **一键检测**：设置页跑通**连接/模型/文本/识图/工具调用/联网搜索**，失败直接显示原始错误
- **错误报告**：一键生成，父母分享就能定位问题
- **底线提示词**：内置不可修改的真实、积极、防焦虑规则

## 快速开始

### 本地预览（不用部署）

双击 `启动本地测试.bat`（需要装有 Python）：自动起本地服务并打开浏览器，窗口里还会显示手机局域网测试地址。看到旧版本按 Ctrl+Shift+R 强制刷新。

### Cloudflare部署

> ⚠️ 一定要用 **Cloudflare Pages**，不要用 Workers：`*.workers.dev` 域名在国内被 DNS 污染。
> `*.pages.dev` 目前在国内可以直连。追求最稳可在 Pages 上绑一个自己的便宜域名。

1. Fork / 下载本仓库；
2. 注册登录 <[www.cloudflare.com](https://www.cloudflare.com/zh-cn/)>，左侧`build`-`Compute`-`Workers & Pages`-蓝色按钮`Create application`；
3. 底部小字`Continue to Pages`-`Drag and drop your files`-`Get started`
4. 给自己的项目起个名，只能用小写字母+`0-9`数字+`-`
5. 把整个文件夹拖进去（`pyodide/` 约 55MB，耐心等待），得到 `https://xxx.pages.dev`；
6. 如果要改代码，进项目「创建新部署」再拖一次即可。

### 手机端配置

1. 打开部署好的网址 → 右上角 ⚙️ 设置
2. 填入API Key，可选 Kimi /DeepSeek / 千问
3. 点`获取模型列表`确认 Key 有效 → 选择模型
4. 根据需求修改预设与首页快捷按钮
5. 点击`开始一键检测`，确认模型工作正常
6. `保存全部设置` → `生成配置二维码`

### 父母手机端：

1. 将链接复制到浏览器，按引导条**添加到主屏幕**，以后点击桌面图标就能用
2. 把二维码图片用微信发给父母/直接将屏幕给爸妈看
3. 在父母端程序设置中`从相册选二维码图片`/`扫一扫导入配置`，提示配置成功则可开始使用

## 技术架构

```
手机浏览器（PWA）
 ├── providers.js   Kimi / DeepSeek / 千问 流式 SSE 客户端
 ├── agent.js       tool_calls 循环：官方工具 web_search / code-runner
 │                  └─ 失败回退：内置 $web_search / 端侧沙盒
 ├── jssandbox.js   端侧 JavaScript 沙盒（sandboxed iframe + ECharts 图表）
 ├── sandbox.js     Pyodide Web Worker（numpy/pandas/matplotlib 本地跑）
 └── app.js         对话 / 设置 / 扫码 / 检测 / 文件解析 / 夜间模式
```

- **零后端**：所有请求由浏览器直连三家大模型 API，API Key 只存在本机浏览器，不经过任何第三方服务器；
- **存储**：对话记录（含图片）放 IndexedDB，配置放 localStorage；
- **国产 ROM 适配**：各功能均已在小米、鸿蒙、vivo自带浏览器上测试过，工作正常

## 常见问题

- **要花多少钱？** 部署免费；API 按用量计费（Kimi/DeepSeek 都很便宜，qwen新用户有大量免费token），记得在平台控制台设「余额预警」。
- **Key 安全吗？** Key 只存在你爸妈手机的浏览器里，代码开源可自查；万一泄露，去平台控制台作废重发，再扫一次码。
- **我的xxx手机能用吗？** 在小米、鸿蒙、vivo进行了测试，为此阉割了部分 Web API （如语音输入和输出），App 内都有兜底或明确提示。IOS因为缺少测试机，所以暂时不适配，欢迎魔改。
- **GitHub Pages / Vercel 能部署吗？** 能跑，但默认域名在国内访问不稳定，给父母用不推荐。

## 后续计划
1. 增加本地记忆库功能，收集父母在对话中提出的个人信息，改善后续对话质量（不上传至云端）

## 开源许可

[MIT License](LICENSE) © Zheng-Chen-WH

本工具不替代专业医疗/法律建议。欢迎 Issue 和 PR——尤其是各品牌国产浏览器的真机适配反馈。
