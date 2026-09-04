/* providers.js — OpenAI 兼容的流式 API 客户端（Kimi / DeepSeek） */

const PROVIDERS = {
  moonshot: {
    name: 'Kimi',
    base: 'https://api.moonshot.cn/v1',
    keyField: 'moonshotKey',
    supportsSearch: true,   // 官方工具通道 + $web_search builtin
  },
  deepseek: {
    name: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    keyField: 'deepseekKey',
    supportsSearch: false,  // 借道 Kimi 官方工具执行
  },
  qwen: {
    name: '千问',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyField: 'qwenKey',
    supportsSearch: false,  // 借道 Kimi 官方工具执行
  },
};

const DEFAULT_MODELS = {
  moonshot: 'kimi-k2.6',
  deepseek: 'deepseek-v4-flash',   // 多模态快速模型，聊天/识图/Responses 通用
  deepseekVision: '',
  qwen: 'qwen3.8-flash',           // 多模态快速模型；实测 web_search + code_interpreter 可用
  qwenVision: '',
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  /* 转成老人也能看懂的话 */
  friendly() {
    if (this.status === 401) return 'API Key 不对或已失效，请让家人检查设置里的 Key。';
    if (this.status === 402) return '账户余额不足了，请让家人去平台充值。';
    if (this.status === 429) return '用得太快或额度到了，稍等一会儿再试。';
    if (this.status === 400) return '请求有问题（可能是图片太大或内容太长），换一句话试试。';
    if (this.status >= 500) return '服务器忙，稍后再试一次。';
    return '网络好像不太通，检查一下网络再试。';
  }
}

async function apiFetch(provider, path, key, options = {}) {
  const url = PROVIDERS[provider].base + path;
  let resp;
  try {
    resp = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    throw new ApiError(0, 'network: ' + e.message);
  }
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try {
      const data = await resp.json();
      msg = data.error?.message || msg;
    } catch (_) {}
    throw new ApiError(resp.status, msg);
  }
  return resp;
}

/* 拉取模型列表，失败返回空数组 */
async function listModels(provider, key) {
  try {
    const resp = await apiFetch(provider, '/models', key);
    const data = await resp.json();
    return (data.data || []).map((m) => m.id).sort();
  } catch (_) {
    return [];
  }
}

/*
 * 流式聊天补全。
 * 回调：
 *   onContent(text)   正文增量
 *   onThinking(text)  思考过程增量（推理模型）
 * 返回 { content, thinking, toolCalls, finishReason }
 *   toolCalls: [{id, name, arguments}]（arguments 为完整 JSON 字符串）
 */
async function streamChat({ provider, key, model, messages, tools, onContent, onThinking, signal, extraBody }) {
  const body = {
    model,
    messages,
    stream: true,
    // 不传 temperature/top_p：Kimi 新一代推理模型（k2.6/k3 等）只允许默认值，传了会 400
    // max_tokens 要给足：联网搜索结果注入后，思考+回答常超过 2000 token，太小会截断成空回答
    max_tokens: 16384,
    ...(extraBody || {}),   // 渠道扩展参数（如千问的 enable_search）
  };
  if (tools && tools.length) body.tools = tools;

  const resp = await apiFetch(provider, '/chat/completions', key, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let content = '';
  let thinking = '';
  let finishReason = null;
  // tool_calls 增量按 index 累积
  const tcMap = new Map();

  const handleData = (payload) => {
    if (payload === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(payload); } catch (_) { return; }
    const choice = chunk.choices && chunk.choices[0];
    if (!choice) return;
    const delta = choice.delta || {};
    if (delta.content) {
      content += delta.content;
      onContent && onContent(delta.content);
    }
    if (delta.reasoning_content) {
      thinking += delta.reasoning_content;
      onThinking && onThinking(delta.reasoning_content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const i = tc.index ?? 0;
        if (!tcMap.has(i)) tcMap.set(i, { id: '', type: '', name: '', arguments: '' });
        const acc = tcMap.get(i);
        if (tc.id) acc.id += tc.id;
        if (tc.type) acc.type = tc.type;   // $web_search 是 'builtin_function'，必须原样保留否则服务端不执行搜索
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) handleData(line.slice(5).trim());
    }
  }
  if (buf.trim().startsWith('data:')) handleData(buf.trim().slice(5).trim());

  const toolCalls = [...tcMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);

  return {
    content,
    thinking,
    toolCalls,
    finishReason: finishReason || (toolCalls.length ? 'tool_calls' : 'stop'),
  };
}

/*
 * OpenAI Responses API 流式客户端（DeepSeek / 千问百炼）。
 * 用于两家的服务端工具：web_search（两家都有）、code_interpreter（千问百炼）。
 * 注意：此路径目前无法用真实 Key 验证过（开发方没有 DS/千问 Key），如异常请用设置页一键检测排查。
 * 返回 { content, toolEvents:[{kind:'search',query}|{kind:'python',code,engine}] }
 */
async function streamResponses({ provider, key, model, messages, tools, onContent, onStatus, signal, extraBody }) {
  // 消息转换：system → instructions；图片部件转 Responses 格式
  let instructions = '';
  const input = [];
  for (const m of messages) {
    if (m.role === 'system') { instructions += (instructions ? '\n\n' : '') + m.content; continue; }
    if (typeof m.content === 'string') {
      input.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const parts = m.content.map((p) => {
        if (p.type === 'image_url') return { type: 'input_image', image_url: p.image_url.url };
        return { type: 'input_text', text: p.text || '' };
      });
      input.push({ role: m.role, content: parts });
    }
  }

  const body = { model, input, stream: true, ...(extraBody || {}) };
  if (instructions) body.instructions = instructions;
  if (tools && tools.length) body.tools = tools;

  const resp = await apiFetch(provider, '/responses', key, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let content = '';
  let finalResp = null;

  const handleEvent = (eventType, payload) => {
    let data;
    try { data = JSON.parse(payload); } catch (_) { return; }
    if (eventType === 'response.output_text.delta' && data.delta) {
      content += data.delta;
      onContent && onContent(data.delta);
    } else if (eventType === 'response.completed' || eventType === 'response.incomplete') {
      finalResp = data.response || data;
    } else if (eventType === 'response.failed') {
      const msg = data.response?.error?.message || 'Responses 调用失败';
      throw new ApiError(0, msg);
    }
  };

  let eventType = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) handleEvent(eventType, line.slice(5).trim());
    }
  }

  // 从最终响应里提取工具活动（搜索/代码执行）
  const toolEvents = [];
  for (const item of (finalResp && finalResp.output) || []) {
    if (item.type === 'web_search_call') {
      toolEvents.push({ kind: 'search', query: item.action?.query || '' });
    } else if (item.type === 'code_interpreter_call') {
      // 防御式收集图片：实测百炼 code_interpreter 把图片以 markdown 形式放在 outputs[].logs 文本里
      // （![fig-001](http://...oss.../xxx.png?security-token=...)），所以要扫文本内嵌 URL，不只是独立字段
      const imgs = [];
      const scan = (v, k) => {
        if (v == null) return;
        if (typeof v === 'string') {
          if (/^data:image\//.test(v)) { imgs.push(v); return; }
          const m = v.match(/https?:\/\/[^\s)"']+?\.(?:png|jpe?g|gif|webp)(?:\?[^\s)"']*)?/gi);
          if (m) { imgs.push(...m); return; }
          if (/^https?:\/\/\S+$/.test(v)) imgs.push(v);
          else if (k && /b64|base64/i.test(k) && v.length > 500) imgs.push('data:image/png;base64,' + v);
          return;
        }
        if (Array.isArray(v)) return v.forEach((x) => scan(x, k));
        if (typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => scan(vv, kk));
      };
      scan(item);
      // OSS 签名 URL 是 http://，页面若是 https（pages.dev）会被浏览器按混合内容拦截，统一升级
      const uniq = [...new Set(imgs)].map((u) => u.replace(/^http:\/\//, 'https://'));
      toolEvents.push({ kind: 'python', code: item.code || '', stdout: '', error: '', imageCount: uniq.length, engine: '云端', images: uniq.length ? uniq : undefined });
    }
  }

  return { content, toolEvents };
}
