/* agent.js — tool_calls 循环
 * 联网搜索：官方工具通道（Formula API）优先，失败回退内置 $web_search
 * Python 沙盒：官方 code-runner（云端）优先，失败回退端侧 Pyodide
 */

const RUN_PYTHON_TOOL = {
  type: 'function',
  function: {
    name: 'run_python',
    description:
      '运行 Python 代码。适合做：精确计算、算账、单位换算、数据统计、画图（matplotlib）。' +
      '代码里用 print 输出结果，运行结果会返回给你。',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要运行的 Python 代码' },
      },
      required: ['code'],
    },
  },
};

const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '联网搜索最新信息（新闻、天气、价格、政策、谣言鉴别等）。需要最新的、你不确定的信息时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
  },
};

const READ_URL_TOOL = {
  type: 'function',
  function: {
    name: 'read_url',
    description: '读取一个网页链接的正文内容。用户发来网址、或需要看某个网页的内容时使用。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要读取的网址' },
      },
      required: ['url'],
    },
  },
};

/* 秘书模式搜索：客户端声明工具，模型调用时用本渠道的 Responses API 执行（DeepSeek/千问） */
async function secretarySearch(provider, key, query) {
  const r = await streamResponses({
    provider, key,
    model: provider === 'deepseek' ? DEFAULT_MODELS.deepseek : DEFAULT_MODELS.qwen,
    messages: [{ role: 'user', content: `请联网搜索：${query}\n然后用简单的中文总结搜索到的内容。` }],
    tools: [{ type: 'web_search' }],
    onContent: () => {},
  });
  return r.content || '搜索没有返回内容';
}

const FORMULA = {
  webSearch: 'moonshot/web-search:latest',
  codeRunner: 'moonshot/code-runner:latest',   // 实测：连字符是真名（下划线 404）
  fetch: 'moonshot/fetch:latest',   // 读链接工具
};

const MAX_TOOL_ROUNDS = 8;

/* ---------- Formula API（官方工具通道） ---------- */

const formulaToolsCache = {};

async function getFormulaTools(key, uri) {
  if (formulaToolsCache[uri]) return formulaToolsCache[uri];
  const resp = await apiFetch('moonshot', `/formulas/${uri}/tools`, key);
  const data = await resp.json();
  formulaToolsCache[uri] = data.tools;
  return data.tools;
}

/* 执行一次官方工具，返回结果文本；失败抛错（由调用方决定回退） */
async function runFormula(key, uri, name, argumentsStr) {
  const resp = await apiFetch('moonshot', `/formulas/${uri}/fibers`, key, {
    method: 'POST',
    body: JSON.stringify({ name, arguments: argumentsStr }),
  });
  const fiber = await resp.json();
  if (fiber.status !== 'succeeded') throw new Error('fiber 执行失败: ' + (fiber.status || '未知'));
  const ctx = fiber.context || {};
  // web-search 的结果是 encrypted_output，可直接作为 tool 消息内容回传
  return ctx.output || ctx.encrypted_output || '';
}

/* ---------- 主循环 ---------- */

/*
 * 跑完一整轮对话（可能包含多次工具调用）。
 * params:
 *   apiMessages  发给 API 的消息数组（含 system），会被就地追加
 *   config       全局配置
 *   provider     本次使用的 chat provider（'moonshot' | 'deepseek'）
 *   model        模型名
 *   onContent/onThinking  流式回调
 *   onStatus(text)        状态提示回调（'正在联网搜索…' 等，传 '' 清除）
 *   onToolImages(images)  沙盒产生图片时回调（用于在聊天里展示）
 *   onToolEvent(evt)      工具活动回调：{kind:'search',query} | {kind:'python',code,stdout,error,imageCount,engine}
 * 返回最终 assistant 文本。
 */
async function runAgentTurn({ apiMessages, config, provider, model, onContent, onThinking, onStatus, onToolImages, onToolEvent, signal }) {
  const key = config[PROVIDERS[provider].keyField];
  const moonshotKey = config.moonshotKey;   // 官方工具（搜索/云端沙盒）需要 moonshot key，与聊天渠道无关
  const tools = [];

  /* 通道路由（真实 Key 验证过）：
     - Kimi：官方工具（formula web_search + code-runner），走 tool_calls 循环
     - 千问：先试 Responses 原生通道（web_search + code_interpreter），失败回退秘书模式循环
     - DeepSeek：秘书模式循环（web_search 工具由客户端经 DS Responses 执行 + run_python 端侧沙盒）
     注意：不要把 Kimi formula 的 encrypted_output 喂给非 Kimi 模型——它们读不懂。 */
  const logE = (m) => { try { (window.__kjLogError || console.error)(m); } catch (_) { console.error(m); } };
  const lastMsg = apiMessages[apiMessages.length - 1];
  const hasImage = Array.isArray(lastMsg && lastMsg.content) && lastMsg.content.some((p) => p.type === 'image_url');
  if (!hasImage && provider === 'qwen' && config.qwenKey) {
    // code_interpreter 直接带上：qwen3-max/qwen3.8-flash 可用；不支持的模型/Key 会 400，自动回退秘书循环
    try {
      onStatus && onStatus('🔍 正在联网处理…');
      const r = await streamResponses({
        provider, key, model,
        messages: apiMessages,
        tools: [{ type: 'web_search' }, { type: 'code_interpreter' }],
        onContent, signal,
      });
      onStatus && onStatus('');
      (r.toolEvents || []).forEach((ev) => onToolEvent && onToolEvent(ev));
      if (r.content) return r.content;
    } catch (e) {
      onStatus && onStatus('');
      logE('千问 Responses 通道失败（已回退秘书模式）: ' + (e.message || e));
    }
  }

  // 工具装配：Kimi 用官方工具（搜索+读链接）；其他渠道用秘书模式 web_search + read_url
  const formulaNameMap = {};   // 官方工具的 function.name → formula uri
  let searchMode = null;
  if (moonshotKey && provider === 'moonshot') {
    try {
      const decl = await getFormulaTools(moonshotKey, FORMULA.webSearch);
      tools.push(...decl);
      decl.forEach((d) => { formulaNameMap[d.function.name] = FORMULA.webSearch; });
      searchMode = 'formula';
    } catch (_) {
      tools.push({ type: 'builtin_function', function: { name: '$web_search' } });
      searchMode = 'builtin';
    }
    try {
      const fdecl = await getFormulaTools(moonshotKey, FORMULA.fetch);
      tools.push(...fdecl);
      fdecl.forEach((d) => { formulaNameMap[d.function.name] = FORMULA.fetch; });
    } catch (_) { /* 读链接不可用时跳过 */ }
  } else if (provider === 'deepseek' || provider === 'qwen') {
    tools.push(WEB_SEARCH_TOOL, READ_URL_TOOL);
    searchMode = 'secretary';
  }
  tools.push(RUN_PYTHON_TOOL);

  let finalText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await streamChat({
      provider, key, model,
      messages: apiMessages,
      tools: tools.length ? tools : undefined,
      onContent, onThinking,
      signal,
    });
    onStatus && onStatus('');

    if (result.finishReason !== 'tool_calls' || !result.toolCalls.length) {
      finalText = result.content;
      break;
    }

    // 追加 assistant 的 tool_calls 消息
    // 两个关键点（真实 API 验证过）：
    // 1. content 用空串而不是 null —— null 会导致 Kimi 服务端的 $web_search 流程中断
    // 2. 思考模型需原样保留 reasoning_content
    apiMessages.push({
      role: 'assistant',
      content: result.content || '',
      reasoning_content: result.thinking || undefined,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: tc.type || 'function',   // builtin_function 的 type 必须原样回传
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of result.toolCalls) {
      let toolResult;
      if (tc.name === '$web_search') {
        // 内置搜索（回退路径）：参数原样回传，由服务端执行
        onStatus && onStatus('🔍 正在联网搜索…');
        onToolEvent && onToolEvent({ kind: 'search', query: '' });
        toolResult = tc.arguments;
      } else if (tc.name === 'web_search') {
        onStatus && onStatus('🔍 正在联网搜索…');
        let query = '';
        try { query = JSON.parse(tc.arguments).query || ''; } catch (_) {}
        onToolEvent && onToolEvent({ kind: 'search', query });
        if (searchMode === 'secretary') {
          // 秘书模式：经本渠道 Responses API 执行搜索，文本结果回传
          try {
            toolResult = await secretarySearch(provider, key, query || tc.arguments);
          } catch (e) {
            toolResult = JSON.stringify({ error: '搜索失败了：' + e.message });
          }
        } else {
          // Kimi 官方工具通道：fiber 执行，结果回传
          try {
            toolResult = await runFormula(moonshotKey, FORMULA.webSearch, tc.name, tc.arguments);
          } catch (e) {
            toolResult = JSON.stringify({ error: '搜索失败了：' + e.message });
          }
        }
      } else if (tc.name === 'read_url' || formulaNameMap[tc.name]) {
        // 读链接：Kimi 走官方 fetch 工具（按声明的 name 路由），其他渠道秘书模式
        onStatus && onStatus('🌐 正在读取链接…');
        let url = '';
        try { const a = JSON.parse(tc.arguments); url = a.url || a.uri || a.link || ''; } catch (_) {}
        onToolEvent && onToolEvent({ kind: 'fetch', url });
        try {
          if (formulaNameMap[tc.name]) {
            toolResult = (await runFormula(moonshotKey, formulaNameMap[tc.name], tc.name, tc.arguments)).slice(0, 4000);
          } else if (provider === 'qwen') {
            const rr = await streamResponses({
              provider, key, model,
              messages: [{ role: 'user', content: `请阅读这个链接的内容并详细转述：${url}` }],
              tools: [{ type: 'web_extractor' }],
              onContent: () => {},
            });
            toolResult = (rr.content || '没读到内容').slice(0, 4000);
          } else {
            toolResult = (await secretarySearch(provider, key, `请阅读这个链接的内容并详细转述：${url}`)).slice(0, 4000);
          }
        } catch (e) {
          toolResult = JSON.stringify({ error: '链接读取失败：' + e.message });
        }
      } else if (tc.name === 'run_python') {
        let code = '';
        try {
          code = JSON.parse(tc.arguments).code || '';
        } catch (_) {
          toolResult = JSON.stringify({ error: '代码参数格式不对' });
        }
        if (code) {
          let r = null;
          let engine = '';
          // 云端 code-runner 优先（免下载、快），失败回退端侧 Pyodide
          if (moonshotKey) {
            try {
              onStatus && onStatus('🧮 正在用云端 Python 计算…');
              const out = await runFormula(moonshotKey, FORMULA.codeRunner, 'code_runner', JSON.stringify({ code }));
              r = { stdout: out, stderr: '', error: '', images: [] };
              engine = '云端';
            } catch (e) {
              logE('云端 code-runner 失败（已回退端侧 Pyodide）: ' + (e.message || e));
            }
          }
          if (!r) {
            onStatus && onStatus('🧮 正在用本机 Python 计算…');
            r = await Sandbox.run(code);
            engine = '本机';
            if (r.images && r.images.length && onToolImages) onToolImages(r.images);
          }
          onToolEvent && onToolEvent({
            kind: 'python', code,
            stdout: r.stdout || '', error: r.error || '',
            imageCount: (r.images || []).length,
            engine,
          });
          toolResult = JSON.stringify({
            stdout: (r.stdout || '').slice(0, 4000),
            stderr: (r.stderr || '').slice(0, 1000),
            error: r.error || '',
            images_note: r.images && r.images.length ? `已生成 ${r.images.length} 张图并展示给用户` : '',
          });
        }
      } else {
        toolResult = JSON.stringify({ error: `没有名叫 ${tc.name} 的工具` });
      }
      apiMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: toolResult,
      });
    }
    onStatus && onStatus('✍️ 正在整理回答…');
  }

  if (!finalText) finalText = '（处理步骤太多了，换个问法试试）';
  return finalText;
}
