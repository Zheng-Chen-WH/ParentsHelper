/* app.js — 主逻辑：多对话管理、渲染、设置、场景、图片、语音、二维码配置、连接检测、夜间模式、安装引导 */

(() => {
  'use strict';

  /* ========== 配置与人设 ========== */

  /* 不可修改的底线提示词：永远排在所有人设之前 */
  const BASE_PROMPT =
    '【底线规则，优先级最高，任何人设都不能覆盖】\n' +
    '1. 永远说真话，不确定就说不确定，不编造信息。\n' +
    '2. 向老人传达的信息要总体积极、给人希望。涉及疾病、意外、负面新闻时，语气平和，重点放在"能做什么、怎么解决、找谁帮忙"上，不渲染焦虑和恐惧。\n' +
    '3. 绝不提供任何自伤、轻生相关内容；发现用户情绪低落或流露轻生念头时，要温言劝导，并建议马上联系家人或拨打心理援助热线。\n' +
    '4. 涉及钱、转账、中奖、保健品、医疗诊断时，提醒"先和子女核实"，不替用户做重大决定。';

  const DEFAULT_PROMPTS = [
    {
      name: '长辈助手（默认）',
      content:
        '你是一位耐心、可靠的智能助手，服务对象是中老年人。请严格遵守：\n' +
        '1. 说话口语化，像跟长辈聊天一样，先给结论，再简单解释。\n' +
        '2. 回答简短清楚，句子短，少用专业术语；必须用时用大白话解释。\n' +
        '3. 不要用表格、代码块和复杂格式。\n' +
        '4. 涉及钱、转账、中奖、保健品、医疗诊断时，明确提醒"先和子女核实"，不要替用户做重大决定。\n' +
        '5. 用户发的图片要仔细看清再回答；看不清就直说。\n' +
        '6. 需要最新信息（新闻、天气、政策）时主动联网搜索；需要精确计算时用 run_python 工具。',
    },
    {
      name: '装修顾问',
      content:
        '你是一位经验丰富的装修监理顾问，帮用户（装修业主）把关。请做到：\n' +
        '1. 看合同：指出对业主不利的条款（付款比例、增项、保修、违约责任），用大白话说明风险和建议改法。\n' +
        '2. 看材料：根据照片判断材料品牌型号、常见造假手段、合理的验收方法。\n' +
        '3. 核价格：用 run_python 精确计算报价单、面积、单价对比，给出市场参考区间。\n' +
        '4. 布局建议：基于户型图给出实用、适老化的布局建议。\n' +
        '5. 回答口语化、先给结论；重要风险单独强调。拿不准的就说拿不准，建议找专业机构。',
    },
  ];

  const DEFAULT_CONFIG = {
    moonshotKey: '',
    deepseekKey: '',
    qwenKey: '',
    chatProvider: 'moonshot',   // 'moonshot' | 'deepseek' | 'qwen'
    chatModels: { moonshot: DEFAULT_MODELS.moonshot, deepseek: DEFAULT_MODELS.deepseek, qwen: DEFAULT_MODELS.qwen },
    visionModels: { moonshot: '', deepseek: '', qwen: '' },   // 空 = 与聊天模型相同（三家默认模型都是多模态）
    visionProvider: '',         // '' = 跟随聊天渠道 | 'deepseek' | 'qwen'
    enableWebSearch: true,
    enableSandbox: true,
    autoSpeak: false,        // 已废弃（TTS 已移除），仅为兼容旧配置/二维码
    sendOriginal: false,     // 发原图（不压缩，细密文字更清楚）
    activePrompt: 0,
    fontSize: 20,          // 正文像素字号（16–30）
    nightMode: 'auto',     // 'auto' | 'on' | 'off'
    nightStart: '22:00',
    nightEnd: '07:00',
  };

  const APP_VERSION = 'v0.34';   // 每次发版递增 0.01，用于确认真机已刷新到新版本

  /* 旧内核没有 structuredClone，用 JSON 兜底 */
  function clone(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  }

  /* ========== 错误日志（错误报告用） ========== */

  let errLog = [];
  function logError(msg) {
    errLog.push({ t: new Date().toLocaleString('zh-CN'), msg: String(msg).slice(0, 300) });
    if (errLog.length > 20) errLog.shift();
    try { localStorage.setItem('kj_error_log', JSON.stringify(errLog)); } catch (_) {}
  }
  function loadErrorLog() {
    try { errLog = JSON.parse(localStorage.getItem('kj_error_log') || '[]'); } catch (_) { errLog = []; }
  }
  window.__kjLogError = logError;   // agent.js 等独立文件通过它落错误日志
  window.addEventListener('error', (e) => logError(e.message));
  window.addEventListener('unhandledrejection', (e) => logError('异步错误: ' + ((e.reason && e.reason.message) || e.reason)));

  async function buildErrorReport() {
    let storageInfo = '（无法获取）';
    try {
      const est = await navigator.storage.estimate();
      storageInfo = `已用 ${(est.usage / 1048576).toFixed(1)}MB / 配额 ${(est.quota / 1048576).toFixed(0)}MB`;
    } catch (_) {}
    const lines = [
      '=== 智能助手 错误报告 ===',
      '版本: ' + APP_VERSION,
      '时间: ' + new Date().toLocaleString('zh-CN'),
      'UA: ' + navigator.userAgent,
      '页面: ' + location.host,
      '聊天渠道: ' + config.chatProvider + ' / ' + config.chatModels[config.chatProvider],
      '识图渠道: ' + (config.visionProvider || '跟随聊天') + ' / ' + (config.visionModels[config.visionProvider || config.chatProvider] || '同聊天模型'),
      '开关: 搜索=' + config.enableWebSearch + ' 沙盒=' + config.enableSandbox,
      'Key 已配置: Kimi=' + !!config.moonshotKey + ' DeepSeek=' + !!config.deepseekKey + ' 千问=' + !!config.qwenKey,
      '对话数: ' + conversations.length,
      '存储: ' + storageInfo,
      '--- 最近错误 ---',
      ...(errLog.length ? errLog.map((e) => `[${e.t}] ${e.msg}`) : ['（无记录）']),
    ];
    return lines.join('\n');
  }

  const MAX_CONVS = 50;       // 最多保留的对话数
  const MAX_MSGS_PER_CONV = 80;

  let config = { ...DEFAULT_CONFIG };
  let prompts = [];
  let conversations = [];     // [{id, title, fav, updatedAt, messages:[{role,text,images?,thinking?,tools?}]}]
  let currentId = null;

  function loadState() {
    try { config = { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem('kj_config') || '{}') }; } catch (_) {}
    // 迁移旧字段
    if (config.useDeepseek && config.chatProvider === 'moonshot') { config.chatProvider = 'deepseek'; delete config.useDeepseek; }
    if (config.visionDeepseek && !config.visionProvider) { config.visionProvider = 'deepseek'; delete config.visionDeepseek; }
    if (typeof config.chatModel === 'string') { config.chatModels.moonshot = config.chatModel; delete config.chatModel; }
    if (typeof config.visionModel === 'string') { config.visionModels.moonshot = config.visionModel; delete config.visionModel; }
    if (!config.chatModels || typeof config.chatModels !== 'object') config.chatModels = { ...DEFAULT_CONFIG.chatModels };
    if (!config.visionModels || typeof config.visionModels !== 'object') config.visionModels = { ...DEFAULT_CONFIG.visionModels };
    try { prompts = JSON.parse(localStorage.getItem('kj_prompts') || 'null') || clone(DEFAULT_PROMPTS); } catch (_) { prompts = clone(DEFAULT_PROMPTS); }
    // 对话记录的加载/迁移在 loadConversations()（IndexedDB）里做
  }
  function saveConfig() { localStorage.setItem('kj_config', JSON.stringify(config)); }
  function savePrompts() { localStorage.setItem('kj_prompts', JSON.stringify(prompts)); }
  /* ========== 存储：对话记录放 IndexedDB（localStorage 只有 5MB，几张照片就爆） ========== */

  let idbDb = null;

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('kj-db', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { idbDb = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(key) {
    return new Promise((resolve) => {
      if (!idbDb) return resolve(null);
      const req = idbDb.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  function idbSet(key, value) {
    return new Promise((resolve) => {
      if (!idbDb) return resolve();
      const req = idbDb.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  }

  /* 加载对话：IndexedDB 优先；自动迁移旧的 localStorage 数据 */
  async function loadConversations() {
    try {
      await idbOpen();
      const saved = await idbGet('conversations');
      if (Array.isArray(saved)) conversations = saved;
      // 迁移：旧版 localStorage 里的对话
      const old = localStorage.getItem('kj_conversations');
      if (old) {
        if (!saved) {
          try { conversations = JSON.parse(old) || []; } catch (_) {}
        }
        localStorage.removeItem('kj_conversations');
      }
      // 更老的单对话存储
      const legacy = localStorage.getItem('kj_history');
      if (legacy) {
        try {
          const msgs = JSON.parse(legacy);
          if (Array.isArray(msgs) && msgs.length) {
            const conv = { id: 'c' + Date.now(), title: makeTitle(msgs), fav: false, updatedAt: Date.now(), messages: msgs };
            conversations.unshift(conv);
            currentId = conv.id;
          }
        } catch (_) {}
        localStorage.removeItem('kj_history');
      }
    } catch (_) {
      // IndexedDB 不可用（极少数浏览器）：退回 localStorage（有 5MB 上限风险）
      try { conversations = JSON.parse(localStorage.getItem('kj_conversations') || '[]'); } catch (_) {}
    }
    currentId = localStorage.getItem('kj_current') || currentId;
    if (currentId && !conversations.some((c) => c.id === currentId)) currentId = null;
  }

  function saveConversations() {
    try { localStorage.setItem('kj_current', currentId || ''); } catch (_) {}
    const data = conversations.slice(0, MAX_CONVS);
    if (idbDb) {
      idbSet('conversations', data);   // 异步落盘，火忘即可
      return;
    }
    // IndexedDB 不可用的兜底：localStorage，超限时存不带图片的副本
    try {
      localStorage.setItem('kj_conversations', JSON.stringify(data));
    } catch (e) {
      try {
        const stripped = data.map((c) => ({
          ...c,
          messages: c.messages.map((m) => (m.images ? { ...m, images: undefined } : m)),
        }));
        localStorage.setItem('kj_conversations', JSON.stringify(stripped));
      } catch (_) {}
    }
  }

  function currentConv() { return conversations.find((c) => c.id === currentId) || null; }
  function makeTitle(msgs) {
    const u = msgs.find((m) => m.role === 'user' && m.text);
    return u ? u.text.slice(0, 14) : '新对话';
  }
  function ensureConv() {
    let c = currentConv();
    if (!c) {
      c = { id: 'c' + Date.now(), title: '新对话', fav: false, updatedAt: Date.now(), messages: [] };
      conversations.unshift(c);
      currentId = c.id;
    }
    return c;
  }

  /* 扫码导入配置：#cfg=base64url(JSON)
     注意：微信里打开时不能清掉 hash——用户还要"在浏览器打开"，
     配置靠 hash 带到真正的浏览器里再导入一次 */
  function importConfigFromHash() {
    if (!location.hash.startsWith('#cfg=')) return false;
    try {
      let b64 = location.hash.slice(5).replace(/-/g, '+').replace(/_/g, '/');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);   // 补回编码时去掉的填充
      const data = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (data.m) config.moonshotKey = data.m;
      if (data.d) config.deepseekKey = data.d;
      if (data.q) config.qwenKey = data.q;
      if (data.cm) config.chatModels.moonshot = data.cm;         // 旧版二维码字段
      if (data.vm) config.visionModels.moonshot = data.vm;
      if (data.ms) config.chatModels = { ...config.chatModels, ...data.ms };
      if (data.vs) config.visionModels = { ...config.visionModels, ...data.vs };
      if (data.p) config.chatProvider = data.p;
      if (data.vd !== undefined) config.visionProvider = data.vd;
      if (typeof data.ws === 'boolean') config.enableWebSearch = data.ws;
      if (typeof data.sb === 'boolean') config.enableSandbox = data.sb;
      if (typeof data.as === 'boolean') config.autoSpeak = data.as;
      // 可选：人设预设和快捷按钮
      if (Array.isArray(data.pr) && data.pr.length) prompts = data.pr;
      if (typeof data.pi === 'number' && prompts[data.pi]) config.activePrompt = data.pi;
      if (Array.isArray(data.sc) && data.sc.length) { scenes = data.sc; saveScenes(); renderChips(); }
      saveConfig();
      savePrompts();
      if (!/MicroMessenger/i.test(navigator.userAgent)) {
        history.replaceState(null, '', location.pathname);
      }
      return true;
    } catch (e) {
      alert('配置链接不对，请让家人重新生成二维码。');
      return false;
    }
  }

  /* 把当前配置编码进地址栏（用于"带配置的桌面快捷方式"） */
  function putConfigInHash() {
    const payload = {
      m: config.moonshotKey, d: config.deepseekKey, q: config.qwenKey,
      ms: config.chatModels, vs: config.visionModels,
      p: config.chatProvider, vd: config.visionProvider,
      ws: config.enableWebSearch, sb: config.enableSandbox, as: config.autoSpeak,
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    location.hash = '#cfg=' + b64;
  }

  /* ========== 外观：字号 + 夜间模式 ========== */

  function applyFont() {
    // body 字号 = 1.25rem，故根字号 = fontSize / 1.25
    document.documentElement.style.fontSize = (config.fontSize / 1.25) + 'px';
  }

  function isNightNow() {
    if (config.nightMode === 'on') return true;
    if (config.nightMode === 'off') return false;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = (config.nightStart || '22:00').split(':').map(Number);
    const [eh, em] = (config.nightEnd || '07:00').split(':').map(Number);
    const s = sh * 60 + sm, e = eh * 60 + em;
    return s <= e ? (mins >= s && mins < e) : (mins >= s || mins < e);  // 跨午夜
  }

  function applyTheme() {
    document.documentElement.dataset.theme = isNightNow() ? 'dark' : '';
  }

  /* ========== DOM ========== */

  const $ = (id) => document.getElementById(id);
  const chatView = $('chatView'), settingsView = $('settingsView');
  const messagesEl = $('messages'), inputBox = $('inputBox');
  const statusLine = $('statusLine'), sceneChips = $('sceneChips');
  let pendingImages = [];   // dataURL 数组，一次最多 9 张
  let pendingDocImages = null;  // {name, images, totalPages} 扫描件长 PDF（分批读取）
  let pendingAttachment = null; // {name, ext, sizeKB, text?, truncated?, images?} 待发送附件
  const MAX_IMAGES = 9;

  const ATTACH_ICONS = { pdf: '📕', docx: '📘', xlsx: '📗', xls: '📗', txt: '📄', md: '📄', csv: '📗' };

  function renderPendingAttachment() {
    const box = $('pendingAttach');
    box.classList.toggle('hidden', !pendingAttachment);
    box.innerHTML = '';
    if (!pendingAttachment) return;
    const a = pendingAttachment;
    const card = document.createElement('div');
    card.className = 'attach-card';
    const pagesNote = a.pageCount ? ` · ${a.pageCount} 页` : '';
    card.innerHTML =
      `<span class="attach-icon">${ATTACH_ICONS[a.ext] || '📎'}</span>` +
      `<span class="attach-name">${escapeHtml(a.name)}</span>` +
      `<span class="attach-meta">${a.sizeKB}KB${pagesNote}${a.truncated ? ' · 截断' : ''}</span>`;
    const btn = document.createElement('button');
    btn.className = 'remove-img';
    btn.textContent = '✕';
    btn.addEventListener('click', () => {
      pendingAttachment = null;
      pendingDocImages = null;
      renderPendingAttachment();
    });
    card.appendChild(btn);
    box.appendChild(card);
  }

  /* 消息气泡里的附件卡片 */
  function attachCardHtml(att) {
    if (!att) return '';
    const pagesNote = att.pageCount ? ` · ${att.pageCount} 页` : '';
    return `<div class="attach-card">` +
      `<span class="attach-icon">${ATTACH_ICONS[att.ext] || '📎'}</span>` +
      `<span class="attach-name">${escapeHtml(att.name)}</span>` +
      `<span class="attach-meta">${att.sizeKB || ''}KB${pagesNote}</span>` +
      `</div>`;
  }
  let sending = false;
  let currentAbort = null;   // 进行中请求的 AbortController（停止键用）
  let wakeLock = null;       // 屏幕常亮锁（防熄屏断网）
  let pendingNetRetry = null;  // 待重试的网络失败 {conv, retryCount}
  let netRetryTimer = null;

  /* 网络失败后的重试：退避间隔；页面在后台则等回前台立即重试 */
  function runNetRetry() {
    const p = pendingNetRetry;
    if (!p) return;
    pendingNetRetry = null;
    requestAssistant(p.conv, p.retryCount);
  }

  /* ========== 渲染 ========== */

  /* 滚动：只在用户本来就停在底部时才自动跟滚，上滑看历史不被打断 */
  let pinnedBottom = true;
  messagesEl.addEventListener('scroll', () => {
    pinnedBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  }, { passive: true });
  function scrollBottom(force) {
    if (force) pinnedBottom = true;
    if (pinnedBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 极简 markdown：代码块折叠、表格渲染成真表格、加粗、换行、链接可点 */
  function renderMarkdown(text) {
    const parts = text.split(/```[\w]*\n?/);
    let html = '';
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        html += `<details><summary>查看详情</summary><pre>${escapeHtml(part)}</pre></details>`;
        return;
      }
      const lines = part.split('\n');
      let buf = [];
      let inTable = false;
      let tableRows = [];
      const inline = (s) =>
        escapeHtml(s)
          .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
          .replace(/`([^`]+)`/g, '<code>$1</code>');
      const flushText = () => {
        if (!buf.length) return;
        html += buf.map((l) =>
          inline(l)
            .replace(/^#{1,4}\s*(.*)$/, '<b>$1</b>')
            // 网址变成可点的链接（显示域名），方便核对来源
            .replace(/(https?:\/\/[^\s<>"'）】。，；！？、]+)/g, (u) => {
              let host = u;
              try { host = new URL(u.replace(/&amp;/g, '&')).hostname; } catch (_) {}
              return `<a href="${u}" target="_blank" rel="noopener">🔗${host}</a>`;
            })
        ).join('<br>');
        buf = [];
      };
      const flushTable = () => {
        if (!inTable) return;
        const rows = tableRows
          .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
          .filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c)));   // 跳过 |---|---| 分隔行
        if (rows.length) {
          let t = '<div class="table-wrap"><table>';
          rows.forEach((cells, ri) => {
            const tag = ri === 0 ? 'th' : 'td';
            t += '<tr>' + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>';
          });
          t += '</table></div>';
          html += t;
        }
        inTable = false;
        tableRows = [];
      };
      for (const line of lines) {
        if (line.trim().startsWith('|')) {
          if (!inTable) { flushText(); inTable = true; tableRows = []; }
          tableRows.push(line.trim());
        } else {
          if (inTable) flushTable();
          buf.push(line);
        }
      }
      flushText(); flushTable();
    });
    return html;
  }

  /* 工具活动的展示（搜索/沙盒），默认折叠，可展开看细节 */
  function renderToolEvents(tools) {
    return (tools || []).map((ev) => {
      if (ev.kind === 'search') {
        return `<details class="tool-detail"><summary>🔍 联网搜索了${ev.query ? `：“${escapeHtml(ev.query)}”` : ''}</summary>` +
          `<div class="hint">搜索由 Kimi 服务端完成</div></details>`;
      }
      if (ev.kind === 'fetch') {
        return `<details class="tool-detail"><summary>🌐 读取了链接${ev.url ? `：${escapeHtml(ev.url.slice(0, 60))}` : ''}</summary>` +
          `<div class="hint">网页正文已提取给模型</div></details>`;
      }
      if (ev.kind === 'python') {
        let inner = `<pre>${escapeHtml(ev.code || '')}</pre>`;
        if (ev.stdout) inner += `<pre>结果：${escapeHtml(ev.stdout)}</pre>`;
        if (ev.error) inner += `<pre>出错了：${escapeHtml(ev.error)}</pre>`;
        if (ev.imageCount) inner += `<div class="hint">生成了 ${ev.imageCount} 张图，见下方</div>`;
        return `<details class="tool-detail"><summary>🧮 用 Python 计算（${ev.engine || '本机'}沙盒，展开看代码和结果）</summary>${inner}</details>`;
      }
      return '';
    }).join('');
  }

  /* 轻提示 toast（复制成功等） */
  let toastTimer = null;
  function toast(text) {
    let el = document.getElementById('kjToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kjToast';
      el.className = 'kj-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }

  function copyText(text) {
    const done = () => toast('✅ 已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { toast('复制失败，请手动长按选择'); }
    ta.remove();
  }

  /* 给消息气泡绑定长按复制（rawText 可为字符串或返回字符串的函数） */
  function bindLongPressCopy(el, rawText) {
    const get = () => (typeof rawText === 'function' ? rawText() : rawText);
    let timer = null;
    el.addEventListener('touchstart', () => {
      timer = setTimeout(() => { timer = null; copyText(get()); }, 550);
    }, { passive: true });
    el.addEventListener('touchend', () => { if (timer) { clearTimeout(timer); timer = null; } });
    el.addEventListener('touchmove', () => { if (timer) { clearTimeout(timer); timer = null; } }, { passive: true });
    el.addEventListener('contextmenu', (e) => {   // 桌面端右键也能复制
      e.preventDefault();
      copyText(get());
    });
  }

  function addMessageEl(role, text, images, thinking, tools, attachment) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    let inner = '';
    if (attachment) inner += attachCardHtml(attachment);
    if (thinking) inner += `<details class="thinking"><summary>思考过程</summary>${escapeHtml(thinking)}</details>`;
    if (tools && tools.length) inner += renderToolEvents(tools);
    inner += role === 'assistant' ? renderMarkdown(text) : escapeHtml(text);
    (images || []).forEach((src) => {
      inner += `<img class="chat-img" src="${src}" alt="图片">`;
    });
    div.innerHTML = inner;
    bindLongPressCopy(div, text);
    messagesEl.appendChild(div);
    scrollBottom(true);   // 追加整条消息（发送/加载历史）时强制滚到底
    return div;
  }

  function setStatus(text) {
    statusLine.textContent = text;
    statusLine.classList.toggle('hidden', !text);
  }

  function refreshChips() {
    const conv = currentConv();
    sceneChips.classList.toggle('hidden', !!(conv && conv.messages.length));
  }

  function renderCurrentConv() {
    messagesEl.innerHTML = '';
    const conv = currentConv();
    if (conv && conv.messages.length) {
      conv.messages.forEach((m) => addMessageEl(m.role, m.text, m.images, m.thinking, m.tools, m.attachment));
    } else {
      showWelcome();
    }
    refreshChips();
  }

  /* ========== 对话列表抽屉 ========== */

  let drawerMode = 'all';   // 'all' | 'fav'

  function openDrawer() {
    renderConvList();
    $('drawer').classList.remove('hidden');
    $('drawerMask').classList.remove('hidden');
  }
  function closeDrawer() {
    $('drawer').classList.add('hidden');
    $('drawerMask').classList.add('hidden');
  }

  function sortedConvs() {
    const list = drawerMode === 'fav' ? conversations.filter((c) => c.fav) : conversations;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function renderConvList() {
    const list = $('convList');
    list.innerHTML = '';
    $('btnFavList').classList.toggle('on', drawerMode === 'fav');
    const items = sortedConvs();
    if (!items.length) {
      list.innerHTML = `<p class="hint" style="padding:0 10px">${drawerMode === 'fav' ? '收藏夹是空的，点对话右边的 ☆ 可以收藏' : '还没有对话记录'}</p>`;
      return;
    }
    items.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'conv-item' + (c.id === currentId ? ' active' : '');
      const date = new Date(c.updatedAt);
      row.innerHTML =
        `<span class="conv-title${c.fav ? ' fav' : ''}">${escapeHtml(c.title)}</span>` +
        `<span class="conv-date">${date.getMonth() + 1}-${date.getDate()}</span>` +
        `<button class="conv-op" data-op="fav" title="收藏">${c.fav ? '★' : '☆'}</button>` +
        `<button class="conv-op" data-op="del" title="删除">✕</button>`;
      row.addEventListener('click', (e) => {
        const op = e.target.dataset && e.target.dataset.op;
        if (op === 'fav') {
          c.fav = !c.fav;
          saveConversations();
          renderConvList();
        } else if (op === 'del') {
          if (confirm(`删除对话「${c.title}」？`)) {
            conversations = conversations.filter((x) => x.id !== c.id);
            if (currentId === c.id) currentId = null;
            saveConversations();
            renderConvList();
            renderCurrentConv();
          }
        } else {
          currentId = c.id;
          saveConversations();
          renderCurrentConv();
          closeDrawer();
        }
      });
      list.appendChild(row);
    });
  }

  /* ========== 图片 ========== */

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        // 发原图：只压到 4K 上限（官方推荐上限），否则压到 2048 保证上传速度
        const MAX = config.sendOriginal ? 4096 : 2048;
        const QUALITY = config.sendOriginal ? 0.92 : 0.85;
        let { width, height } = img;
        if (Math.max(width, height) > MAX) {
          const scale = MAX / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  /* 解析上传的文档（PDF/Word/文本），返回 {name, text, truncated} */
  async function parseDocument(file) {
    const name = file.name || '文件';
    const ext = (name.split('.').pop() || '').toLowerCase();
    let text = '';
    if (['txt', 'md', 'csv'].includes(ext)) {
      text = await file.text();
    } else if (['xlsx', 'xls'].includes(ext)) {
      if (typeof XLSX === 'undefined') throw new Error('表格解析组件没加载成功，请刷新页面再试。');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      text = wb.SheetNames
        .map((sn) => `【工作表：${sn}】\n` + XLSX.utils.sheet_to_csv(wb.Sheets[sn]))
        .join('\n');
    } else if (ext === 'docx') {
      if (typeof mammoth === 'undefined') throw new Error('Word 解析组件没加载成功，请刷新页面再试。');
      const buf = await file.arrayBuffer();
      const r = await mammoth.extractRawText({ arrayBuffer: buf });
      text = r.value || '';
    } else if (ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') throw new Error('PDF 解析组件没加载成功，请刷新页面再试。');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const parts = [];
      const maxPages = Math.min(pdf.numPages, 30);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        parts.push(tc.items.map((it) => it.str).join(' '));
      }
      if (pdf.numPages > maxPages) parts.push(`（这份 PDF 共 ${pdf.numPages} 页，只解析了前 ${maxPages} 页）`);
      text = parts.join('\n');
    } else {
      throw new Error('不支持 .' + ext + ' 格式，支持 PDF / Word（.docx）/ txt');
    }
    text = text.trim();
    if (!text) throw new Error('没解析出文字内容（扫描件 PDF 没有文字层，请改用 📷 拍照识别）。');
    const CAP = 8000;
    const truncated = text.length > CAP;
    if (truncated) text = text.slice(0, CAP);
    return { name, text, truncated };
  }

  /* 扫描件 PDF：逐页渲染成图片，走拍照识图通道（最多渲染 24 页，太长会拆批处理） */
  async function pdfToImages(file, maxPages = 24) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF 组件没加载成功，请刷新页面再试。');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const n = Math.min(pdf.numPages, maxPages);
    const images = [];
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85));
    }
    return { images, totalPages: pdf.numPages };
  }

  function renderPendingImages() {
    const box = $('pendingImage');
    box.classList.toggle('hidden', !pendingImages.length);
    box.innerHTML = '';
    pendingImages.forEach((src, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'pending-thumb';
      const img = document.createElement('img');
      img.src = src;
      img.alt = `待发送图片 ${i + 1}`;
      const btn = document.createElement('button');
      btn.className = 'remove-img';
      btn.textContent = '✕';
      btn.addEventListener('click', () => { pendingImages.splice(i, 1); renderPendingImages(); });
      wrap.append(img, btn);
      box.appendChild(wrap);
    });
  }

  async function addPendingFiles(files) {
    for (const file of files) {
      if (!file) continue;
      if (pendingImages.length >= MAX_IMAGES) {
        alert(`一次最多发 ${MAX_IMAGES} 张图，多余的没加上。`);
        break;
      }
      try {
        pendingImages.push(await compressImage(file));
      } catch (_) {
        alert('有一张图片读取失败，已跳过。');
      }
    }
    renderPendingImages();
  }

  /* ========== 对话 ========== */

  /* 构造发给 API 的消息：system + 最近历史
     图片策略：最近 2 条带图消息保留图片（多页合同场景），更早的替换成文字省 token */
  function buildApiMessages(conv) {
    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const persona = prompts[config.activePrompt]?.content || DEFAULT_PROMPTS[0].content;
    const sys = BASE_PROMPT + '\n\n' + persona + `\n\n今天是${today}。` +
      (config.enableWebSearch ? '\n如果你使用了联网搜索，请在回答末尾用「来源：」列出你参考的网页链接。' : '');
    const msgs = [{ role: 'system', content: sys }];
    const recent = conv.messages.slice(-20);
    // 从后往前数，最近 2 条带图的消息保留图片
    const imgMsgIdx = [];
    recent.forEach((m, i) => { if (m.images && m.images.length) imgMsgIdx.push(i); });
    const keepSet = new Set(imgMsgIdx.slice(-2));
    recent.forEach((m, idx) => {
      if (m.images && m.images.length) {
        const content = [];
        if (keepSet.has(idx)) {
          m.images.forEach((src) => content.push({ type: 'image_url', image_url: { url: src } }));
          content.push({ type: 'text', text: m.text || '请看这张图。' });
        } else {
          content.push({ type: 'text', text: (m.text || '') + '（这条消息之前附过图片，现在已省略）' });
        }
        msgs.push({ role: 'user', content });
      } else {
        let c = m.text;
        if (m.attachment && m.attachment.text) {
          c += `\n【文件《${m.attachment.name}》的内容${m.attachment.truncated ? '（太长，只取前 8000 字）' : ''}】\n` + m.attachment.text;
        }
        msgs.push({ role: m.role, content: c });
      }
    });
    return msgs;
  }

  /* 本次请求用哪个 provider/模型 */
  function pickRoute(hasImage) {
    const want = hasImage ? (config.visionProvider || config.chatProvider) : config.chatProvider;
    const p = (want && config[PROVIDERS[want].keyField]) ? want : 'moonshot';
    const model = hasImage ? (config.visionModels[p] || config.chatModels[p]) : config.chatModels[p];
    return { provider: p, model };
  }

  /* 长扫描件 MapReduce：每 6 页一批逐字提取（map），汇总成文字上下文后正常回答（reduce） */
  async function sendBatchedDocument(text, doc, att) {
    sending = true;
    const sendBtn = $('btnSend');
    const abortCtl = new AbortController();
    currentAbort = abortCtl;
    sendBtn.disabled = false;
    sendBtn.classList.add('stop');
    sendBtn.textContent = '⏹';

    const conv = ensureConv();
    const question = text || '请分析这份文件。';
    const attRecord = att ? { name: att.name, ext: att.ext, sizeKB: att.sizeKB, pageCount: att.pageCount } : undefined;
    const userLabel = `${question}\n【文件《${doc.name}》，共 ${doc.totalPages} 页】`;
    conv.messages.push({ role: 'user', text: userLabel, images: [doc.images[0]], attachment: attRecord });
    if (conv.title === '新对话') conv.title = makeTitle(conv.messages);
    conv.updatedAt = Date.now();
    addMessageEl('user', userLabel, [doc.images[0]], null, null, attRecord);
    saveConversations();
    refreshChips();

    const route = pickRoute(true);   // 用识图渠道逐批提取
    const BATCH = 6;
    const parts = [];
    let stopped = false;
    for (let b = 0; b < doc.images.length && !stopped; b += BATCH) {
      const batch = doc.images.slice(b, b + BATCH);
      const content = batch.map((src) => ({ type: 'image_url', image_url: { url: src } }));
      content.push({ type: 'text', text: `这是文件《${doc.name}》的第 ${b + 1}–${b + batch.length} 页。请完整、逐字提取这些页面上的所有文字、条款和数字，不要遗漏，不要评论。` });
      // 失败自动重试（网络/限流/服务器错误），最多 3 次
      let done = false;
      for (let attempt = 0; attempt < 3 && !done && !stopped; attempt++) {
        setStatus(`📄 正在读取第 ${b + 1}–${b + batch.length} 页（共 ${doc.images.length} 页）${attempt ? `，第 ${attempt + 1} 次尝试` : ''}…`);
        try {
          const r = await streamChat({
            provider: route.provider,
            key: config[PROVIDERS[route.provider].keyField],
            model: route.model,
            messages: [{ role: 'user', content }],
            signal: abortCtl.signal,
          });
          parts.push(`【第 ${b + 1}–${b + batch.length} 页】\n${r.content}`);
          done = true;
        } catch (err) {
          if (err && (err.name === 'AbortError' || abortCtl.signal.aborted)) {
            stopped = true;
            parts.push('【后续页面已停止读取】');
          } else {
            const retryable = !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500;
            if (retryable && attempt < 2) {
              setStatus(`📄 第 ${b + 1}–${b + batch.length} 页读取失败，${2 * (attempt + 1)} 秒后重试…`);
              await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
            } else {
              parts.push(`【第 ${b + 1}–${b + batch.length} 页：这批读取失败】`);
              done = true;
            }
          }
        }
      }
    }
    setStatus('');

    // 把提取结果写回用户消息：后续轮次用文字上下文，不再重复传图，省 token
    conv.messages[conv.messages.length - 1] = {
      role: 'user',
      text: `${question}\n【文件《${doc.name}》全部内容（共 ${doc.images.length} 页）】\n${parts.join('\n\n')}`,
      images: [doc.images[0]],
      attachment: attRecord,
    };
    conv.updatedAt = Date.now();
    saveConversations();

    sending = false;
    currentAbort = null;
    sendBtn.classList.remove('stop');
    sendBtn.textContent = '发送';
    await requestAssistant(conv);
  }

  async function send(text, images) {
    if (sending) return;
    text = (text || '').trim();
    const att = pendingAttachment;
    if (!text && !(images && images.length) && !att && !pendingDocImages) return;
    if (!config.moonshotKey && !config.deepseekKey && !config.qwenKey) {
      alert('还没设置 API Key，请点右上角 ⚙️ 进设置填写，或让家人帮你扫码配置。');
      return;
    }
    // 新提问前清掉挂起的网络重试
    pendingNetRetry = null;
    clearTimeout(netRetryTimer);

    // 扫描件长 PDF：分批读取（MapReduce）再汇总回答
    if (pendingDocImages) {
      const doc = pendingDocImages;
      pendingDocImages = null;
      pendingAttachment = null;
      renderPendingAttachment();
      inputBox.value = '';
      autoResize();
      await sendBatchedDocument(text, doc, att);
      return;
    }

    pendingAttachment = null;
    renderPendingAttachment();
    inputBox.value = '';
    autoResize();

    // 组装用户消息：附件以卡片展示，内容进上下文
    let msgText = text;
    let msgImages = images;
    let msgAttachment = null;
    if (att && att.text) {
      msgAttachment = { name: att.name, ext: att.ext, sizeKB: att.sizeKB, truncated: att.truncated, text: att.text };
      if (!msgText) msgText = '请看这个文件。';
    } else if (att && att.images) {
      msgAttachment = { name: att.name, ext: att.ext, sizeKB: att.sizeKB, pageCount: att.pageCount };
      msgImages = [...(images || []), ...att.images];
      if (!msgText) msgText = '请看这个文件（页面照片）。';
    }

    const conv = ensureConv();
    conv.messages.push({ role: 'user', text: msgText, images: msgImages, attachment: msgAttachment });
    if (conv.title === '新对话' && msgText) conv.title = makeTitle(conv.messages);
    conv.updatedAt = Date.now();
    addMessageEl('user', msgText, msgImages, null, null, msgAttachment);
    saveConversations();
    refreshChips();
    pendingImages = [];
    renderPendingImages();
    bumpAndMaybeSuggest();

    await requestAssistant(conv);
  }

  /* 向模型请求回答；失败时气泡上给重试按钮；网络错误自动重试（切后台断连场景） */
  async function requestAssistant(conv, retryCount = 0) {
    sending = true;
    const sendBtn = $('btnSend');
    const abortCtl = new AbortController();
    currentAbort = abortCtl;
    sendBtn.disabled = false;             // 思考中变成可点的「停止」键
    sendBtn.classList.add('stop');
    sendBtn.textContent = '⏹';

    // 输出期间尽量保持屏幕常亮（防熄屏断网；切后台管不了，浏览器限制）
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    }

    // 分区的气泡：思考过程 / 工具活动 / 正文
    const bubble = document.createElement('div');
    bubble.className = 'msg assistant';
    const thinkingEl = document.createElement('details');
    thinkingEl.className = 'thinking hidden';
    const toolsEl = document.createElement('div');
    const contentEl = document.createElement('div');
    contentEl.textContent = '…';
    bubble.append(thinkingEl, toolsEl, contentEl);
    messagesEl.appendChild(bubble);
    bindLongPressCopy(bubble, () => acc);
    scrollBottom();

    let acc = '';
    let thinkingAcc = '';
    const toolEvents = [];

    // 流式中途定期落盘：切后台/进程被杀时，半成品回复不丢
    let partialIdx = -1;
    const savePartial = () => {
      if (!acc) return;
      if (partialIdx < 0) {
        conv.messages.push({ role: 'assistant', text: acc, thinking: thinkingAcc || undefined, tools: toolEvents.length ? [...toolEvents] : undefined });
        partialIdx = conv.messages.length - 1;
      } else if (conv.messages[partialIdx]) {
        conv.messages[partialIdx].text = acc;
        conv.messages[partialIdx].thinking = thinkingAcc || undefined;
        if (toolEvents.length) conv.messages[partialIdx].tools = [...toolEvents];
      }
      conv.updatedAt = Date.now();
      saveConversations();
    };
    const partialTimer = setInterval(savePartial, 2000);
    const onHide = () => { if (document.hidden) savePartial(); };
    document.addEventListener('visibilitychange', onHide);

    const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
    const route = pickRoute(!!(lastUser && lastUser.images && lastUser.images.length));

    try {
      const finalText = await runAgentTurn({
        apiMessages: buildApiMessages(conv),
        config,
        provider: route.provider,
        model: route.model,
        signal: abortCtl.signal,
        onContent: (t) => {
          acc += t;
          contentEl.innerHTML = renderMarkdown(acc);
          scrollBottom();
        },
        onThinking: (t) => {
          thinkingAcc += t;
          thinkingEl.classList.remove('hidden');
          thinkingEl.open = true;   // 思考时展开，结束后自动折叠
          thinkingEl.innerHTML = `<summary>🤔 正在思考…</summary>${escapeHtml(thinkingAcc)}`;
          scrollBottom();
        },
        onStatus: setStatus,
        onToolImages: (imgs) => {
          imgs.forEach((src) => {
            const img = document.createElement('img');
            img.className = 'chat-img';
            img.src = src;
            contentEl.appendChild(img);
          });
          scrollBottom();
        },
        onToolEvent: (ev) => {
          toolEvents.push(ev);
          toolsEl.innerHTML = renderToolEvents(toolEvents);
          scrollBottom();
        },
      });
      // 结束：思考过程自动折叠
      if (thinkingAcc) {
        thinkingEl.open = false;
        thinkingEl.querySelector('summary').textContent = '思考过程';
      }
      const finalMsg = {
        role: 'assistant',
        text: finalText,
        thinking: thinkingAcc || undefined,
        tools: toolEvents.length ? toolEvents : undefined,
      };
      if (partialIdx >= 0 && conv.messages[partialIdx]) conv.messages[partialIdx] = finalMsg;
      else conv.messages.push(finalMsg);
      conv.updatedAt = Date.now();
      if (conv.messages.length > MAX_MSGS_PER_CONV) conv.messages = conv.messages.slice(-MAX_MSGS_PER_CONV);
      pendingNetRetry = null;   // 成功，清掉待重试
    } catch (e) {
      if (e && (e.name === 'AbortError' || abortCtl.signal.aborted)) {
        // 用户点了停止：已输出的部分保留
        pendingNetRetry = null;
        clearTimeout(netRetryTimer);
        const stoppedText = acc ? acc + '\n\n（已停止）' : '（已停止）';
        contentEl.innerHTML = renderMarkdown(stoppedText);
        if (thinkingAcc) thinkingEl.open = false;
        const stoppedMsg = { role: 'assistant', text: stoppedText, thinking: thinkingAcc || undefined, tools: toolEvents.length ? toolEvents : undefined };
        if (partialIdx >= 0 && conv.messages[partialIdx]) conv.messages[partialIdx] = stoppedMsg;
        else conv.messages.push(stoppedMsg);
        conv.updatedAt = Date.now();
      } else if (e instanceof ApiError && e.status === 0 && retryCount < 3) {
        // 网络波动（切后台被断连等）：退避重试 2s/5s/10s；页面在后台则等回到前台立即重试
        if (partialIdx >= 0 && conv.messages[partialIdx]) {
          conv.messages.splice(partialIdx, 1);   // 移除半成品，避免带进下次上下文
          saveConversations();
        }
        bubble.remove();
        const delay = [2000, 5000, 10000][retryCount] || 10000;
        setStatus(document.hidden
          ? `📶 网络断了，回到本页面后自动重试（第 ${retryCount + 1} 次）…`
          : `📶 网络波动，${delay / 1000} 秒后自动重试（第 ${retryCount + 1} 次）…`);
        pendingNetRetry = { conv, retryCount: retryCount + 1 };
        clearTimeout(netRetryTimer);
        if (!document.hidden) netRetryTimer = setTimeout(runNetRetry, delay);
      } else {
        pendingNetRetry = null;
        console.error(e);
        const friendly = e instanceof ApiError ? e.friendly() : ('出了点问题：' + (e.message || e));
        const raw = (e && e.message) ? String(e.message) : String(e);
        logError('请求失败: ' + friendly + ' | 状态码 ' + (e.status ?? '无') + ' ' + raw);
        contentEl.innerHTML = escapeHtml('😔 ' + friendly) +
          `<details><summary>技术细节（给家人看）</summary><pre>${escapeHtml('状态码 ' + (e.status ?? '无') + '\n' + raw)}</pre></details>`;
        if (thinkingAcc) thinkingEl.open = false;
        // 重试按钮：点一下重新请求（错误消息不落库）
        const retryBtn = document.createElement('button');
        retryBtn.className = 'set-btn primary';
        retryBtn.textContent = '🔄 重试';
        retryBtn.addEventListener('click', async () => {
          if (sending) return;
          bubble.remove();
          await requestAssistant(conv);
        });
        contentEl.appendChild(retryBtn);
      }
    } finally {
      currentAbort = null;
      if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
      clearInterval(partialTimer);
      document.removeEventListener('visibilitychange', onHide);
      setStatus('');
      saveConversations();
      sending = false;
      sendBtn.classList.remove('stop');
      sendBtn.textContent = '发送';
      sendBtn.disabled = false;
    }
  }

  /* ========== 快捷场景（可配置） ========== */

  const DEFAULT_SCENES = [
    { icon: '📄', label: '装修合同把关', prompt: '我要发一份装修合同的照片给你，请帮我看看有没有对我不利的条款。', needsImage: true },
    { icon: '🧱', label: '材料真伪识别', prompt: '我要发一张装修材料的照片，请帮我看看品牌型号和真伪鉴别方法。', needsImage: true },
    { icon: '🧮', label: '算账核价', prompt: '帮我算一笔账：', needsImage: false },
    { icon: '🛡️', label: '辨别谣言/诈骗', prompt: '我收到一条短信/消息，帮我看看是不是骗子：', needsImage: false },
    { icon: '📰', label: '问问新闻', prompt: '最近有什么重要新闻？请联网搜一下，用简单的话讲给我听。', needsImage: false },
    { icon: '💊', label: '看看药怎么吃', prompt: '我要发一张药盒或说明书的照片，请告诉我这个药怎么吃、注意什么。', needsImage: true },
  ];

  let scenes = [];

  function loadScenes() {
    try { scenes = JSON.parse(localStorage.getItem('kj_scenes') || 'null') || clone(DEFAULT_SCENES); }
    catch (_) { scenes = clone(DEFAULT_SCENES); }
  }
  function saveScenes() { localStorage.setItem('kj_scenes', JSON.stringify(scenes)); }

  function renderChips() {
    sceneChips.innerHTML = '';
    scenes.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.idx = i;
      btn.textContent = `${s.icon || ''} ${s.label}`.trim();
      sceneChips.appendChild(btn);
    });
  }

  /* ========== 输入栏 ========== */

  function autoResize() {
    inputBox.style.height = 'auto';
    inputBox.style.height = Math.min(inputBox.scrollHeight, 160) + 'px';
  }

  function bindInput() {
    inputBox.addEventListener('input', autoResize);

    $('btnSend').addEventListener('click', () => {
      if (sending && currentAbort) { currentAbort.abort(); return; }   // 思考中 → 停止
      send(inputBox.value, pendingImages.length ? [...pendingImages] : null);
    });

    $('btnPhoto').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      addPendingFiles(files);
    });

    // 粘贴图片（可能一次多张）
    document.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.items || [])]
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile());
      if (files.length) addPendingFiles(files);
    });

    // 上传文件（PDF / Word / 文本），解析出文字放进输入框
    $('btnFile').addEventListener('click', () => $('docInput').click());
    $('docInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      setStatus('📄 正在解析文件…');
      try {
        const r = await parseDocument(file);
        pendingAttachment = {
          name: r.name,
          ext: (r.name.split('.').pop() || '').toLowerCase(),
          sizeKB: Math.max(1, Math.round(file.size / 1024)),
          text: r.text,
          truncated: r.truncated,
        };
        renderPendingAttachment();
        inputBox.focus();
      } catch (err) {
        // 解析不出文字（扫描件/图片型 PDF）：转成图片走识图通道
        if (/pdf$/i.test(file.name || '') && typeof pdfjsLib !== 'undefined') {
          try {
            setStatus('📄 扫描件，正在转成图片…');
            const r2 = await pdfToImages(file);
            const ext = 'pdf';
            const sizeKB = Math.max(1, Math.round(file.size / 1024));
            if (r2.images.length <= 6) {
              pendingAttachment = { name: file.name, ext, sizeKB, images: r2.images, pageCount: r2.totalPages };
            } else {
              pendingDocImages = { name: file.name, images: r2.images, totalPages: r2.totalPages };
              pendingAttachment = { name: file.name, ext, sizeKB, pageCount: r2.totalPages, batched: true };
            }
            renderPendingAttachment();
            inputBox.focus();
          } catch (e2) {
            alert(err.message || '文件解析失败。');
          }
        } else {
          alert(err.message || '文件解析失败。');
        }
      } finally {
        setStatus('');
      }
    });

    // 场景按钮
    sceneChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const s = scenes[parseInt(chip.dataset.idx, 10)];
      if (!s) return;
      inputBox.value = s.prompt;
      autoResize();
      if (s.needsImage) {
        $('fileInput').click();
      } else {
        inputBox.focus();
      }
    });
  }

  /* ========== 顶栏 ========== */

  function bindTopbar() {
    $('btnMenu').addEventListener('click', openDrawer);
    $('drawerMask').addEventListener('click', closeDrawer);
    $('btnNewChat').addEventListener('click', () => {
      currentId = null;
      drawerMode = 'all';
      saveConversations();
      renderCurrentConv();
      closeDrawer();
    });
    $('btnFavList').addEventListener('click', () => {
      drawerMode = drawerMode === 'fav' ? 'all' : 'fav';
      renderConvList();
    });
    $('btnSettings').addEventListener('click', () => { openSettings(); });    $('btnClear').addEventListener('click', () => {
      const conv = currentConv();
      if (!conv || !conv.messages.length) return;
      if (confirm('清空当前对话的内容？（对话本身保留在列表里）')) {
        conv.messages = [];
        conv.updatedAt = Date.now();
        saveConversations();
        renderCurrentConv();
      }
    });
  }

  function showWelcome() {
    addMessageEl('assistant',
      '您好！我是您的智能助手。\n\n' +
      '· 想问什么，打字告诉我\n' +
      '· 想看东西（药盒、合同、材料），点 📷 拍照\n' +
      '· 想发文件（PDF、Word），点 📎\n' +
      '· 下面几个按钮是常用的事，点一下就能用');
  }

  /* ========== 安装引导 ========== */

  let deferredInstallPrompt = null;

  function isWeChat() {
    return /MicroMessenger/i.test(navigator.userAgent);
  }

  function isInstalled() {
    return matchMedia('(display-mode: standalone)').matches ||
           matchMedia('(display-mode: fullscreen)').matches ||
           navigator.standalone === true;
  }

  /* 按品牌给出「添加到桌面」的具体路径（国产浏览器叫法和位置都不一样） */
  function installHintText() {
    const ua = navigator.userAgent;
    if (/HuaweiBrowser/i.test(ua)) return '点右下角「∷」→「添加至」→ 选「桌面」';
    if (/VivoBrowser/i.test(ua)) return '点右上角「⋮」→「添加到桌面」';
    if (/MiuiBrowser/i.test(ua)) return '点底部菜单「≡」→「添加到桌面」';
    if (/HeyTapBrowser|OppoBrowser/i.test(ua)) return '点底部菜单 →「添加到桌面」';
    return '点浏览器菜单（右上角 ⋮ 或底部 ≡）→「添加到主屏幕 / 添加到桌面」';
  }

  function maybeShowInstallBanner() {
    if (isInstalled()) return;
    if (localStorage.getItem('kj_no_install_banner')) return;
    const banner = $('installBanner');
    const textEl = banner.querySelector('.banner-text');
    const installBtn = $('btnInstallApp');
    if (isWeChat()) {
      // 微信内置浏览器不支持安装到桌面，引导跳到系统浏览器
      textEl.textContent = '💡 微信里不能装到桌面：请点右上角「···」→「在浏览器打开」，再按提示安装';
      installBtn.classList.add('hidden');
    } else {
      textEl.textContent = '💡 ' + installHintText() + '。如果跳到了"应用信息"页，进去把「创建桌面快捷方式」权限打开，再回来点一次安装';
      installBtn.classList.toggle('hidden', !deferredInstallPrompt);
    }
    banner.classList.remove('hidden');
  }

  function bindInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      maybeShowInstallBanner();
    });
    window.addEventListener('appinstalled', () => {
      $('installBanner').classList.add('hidden');
    });
    $('btnInstallApp').addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice.catch(() => {});
        deferredInstallPrompt = null;
      }
    });
    $('btnDismissInstall').addEventListener('click', () => {
      $('installBanner').classList.add('hidden');
      localStorage.setItem('kj_no_install_banner', '1');
    });
    // 没有 beforeinstallprompt（如微信内置浏览器）也显示文字引导
    setTimeout(maybeShowInstallBanner, 3000);
  }

  /* ========== 设置页 ========== */

  function openSettings() {
    ['moonshot', 'deepseek', 'qwen'].forEach((p) => {
      $('cfgKey_' + p).value = config[PROVIDERS[p].keyField] || '';
      $('cfgChat_' + p).value = config.chatModels[p] || '';
      $('cfgVis_' + p).value = config.visionModels[p] || '';
      $('cfgChatPick_' + p).checked = config.chatProvider === p;
      $('cfgVisPick_' + p).checked = config.visionProvider === p;
    });
    $('cfgVisPick_auto').checked = !config.visionProvider;
    $('cfgFontSize').value = config.fontSize;
    $('cfgNightMode').value = config.nightMode;
    $('cfgNightStart').value = config.nightStart;
    $('cfgNightEnd').value = config.nightEnd;
    updateFontPreview();
    refreshPromptSelect();
    renderSceneEditor();
    chatView.classList.add('hidden');
    settingsView.classList.remove('hidden');
  }

  function closeSettings() {
    settingsView.classList.add('hidden');
    chatView.classList.remove('hidden');
  }

  /* 读取设置页表单当前值（不要求已保存），用于检测 */
  function formConfig() {
    const chatProvider = ['moonshot', 'deepseek', 'qwen'].find((p) => $('cfgChatPick_' + p).checked) || 'moonshot';
    const visionProvider = ['moonshot', 'deepseek', 'qwen'].find((p) => $('cfgVisPick_' + p).checked) || '';
    return {
      keys: {
        moonshot: $('cfgKey_moonshot').value.trim(),
        deepseek: $('cfgKey_deepseek').value.trim(),
        qwen: $('cfgKey_qwen').value.trim(),
      },
      chatModels: {
        moonshot: $('cfgChat_moonshot').value.trim() || DEFAULT_MODELS.moonshot,
        deepseek: $('cfgChat_deepseek').value.trim() || DEFAULT_MODELS.deepseek,
        qwen: $('cfgChat_qwen').value.trim() || DEFAULT_MODELS.qwen,
      },
      visionModels: {
        moonshot: $('cfgVis_moonshot').value.trim(),
        deepseek: $('cfgVis_deepseek').value.trim() || DEFAULT_MODELS.deepseekVision,
        qwen: $('cfgVis_qwen').value.trim() || DEFAULT_MODELS.qwenVision,
      },
      chatProvider,
      visionProvider,
      enableWebSearch: true,
      enableSandbox: true,
    };
  }

  function refreshPromptSelect() {
    const sel = $('cfgPromptSelect');
    sel.innerHTML = '';
    prompts.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = p.name + (i === config.activePrompt ? '（使用中）' : '');
      sel.appendChild(opt);
    });
    sel.value = config.activePrompt;
    $('cfgPromptText').value = prompts[config.activePrompt]?.content || '';
  }

  /* ========== 字号与夜间模式 ========== */

  function updateFontPreview() {
    $('fontPreview').style.fontSize = $('cfgFontSize').value + 'px';
  }

  function bindAppearance() {
    $('cfgFontSize').addEventListener('input', () => {
      config.fontSize = parseInt($('cfgFontSize').value, 10);
      applyFont();          // 实时预览：整个界面跟着变
      updateFontPreview();
      saveConfig();
    });
    const onNightChange = () => {
      config.nightMode = $('cfgNightMode').value;
      config.nightStart = $('cfgNightStart').value || '22:00';
      config.nightEnd = $('cfgNightEnd').value || '07:00';
      applyTheme();
      saveConfig();
    };
    $('cfgNightMode').addEventListener('change', onNightChange);
    $('cfgNightStart').addEventListener('change', onNightChange);
    $('cfgNightEnd').addEventListener('change', onNightChange);
  }

  /* ========== 快捷按钮编辑器（设置页） ========== */

  function renderSceneEditor() {
    const box = $('sceneList');
    box.innerHTML = '';
    scenes.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'scene-edit';
      const row = document.createElement('div');
      row.className = 'scene-edit-row';

      const iconIn = document.createElement('input');
      iconIn.type = 'text'; iconIn.className = 'scene-icon'; iconIn.value = s.icon || ''; iconIn.placeholder = '图标';
      iconIn.addEventListener('input', () => { s.icon = iconIn.value; saveScenes(); renderChips(); });

      const labelIn = document.createElement('input');
      labelIn.type = 'text'; labelIn.className = 'scene-label'; labelIn.value = s.label; labelIn.placeholder = '按钮名';
      labelIn.addEventListener('input', () => { s.label = labelIn.value; saveScenes(); renderChips(); });

      const imgLabel = document.createElement('label');
      imgLabel.className = 'switch-row'; imgLabel.style.margin = '0';
      const imgCk = document.createElement('input');
      imgCk.type = 'checkbox'; imgCk.checked = !!s.needsImage;
      imgCk.addEventListener('change', () => { s.needsImage = imgCk.checked; saveScenes(); });
      imgLabel.append(imgCk, document.createTextNode(' 📷'));

      const delBtn = document.createElement('button');
      delBtn.className = 'set-btn danger'; delBtn.textContent = '删';
      delBtn.addEventListener('click', () => {
        if (confirm(`删除按钮「${s.label}」？`)) { scenes.splice(i, 1); saveScenes(); renderChips(); renderSceneEditor(); }
      });

      row.append(iconIn, labelIn, imgLabel, delBtn);

      const ta = document.createElement('textarea');
      ta.rows = 2; ta.value = s.prompt; ta.placeholder = '点按钮后自动发送的话';
      ta.addEventListener('input', () => { s.prompt = ta.value; saveScenes(); });

      div.append(row, ta);
      box.appendChild(div);
    });
  }

  /* ========== 高频行为自动提炼按钮 ========== */

  const SUGGEST_EVERY = 10;   // 每 N 条用户提问提炼一次

  function bumpAndMaybeSuggest() {
    const n = parseInt(localStorage.getItem('kj_msg_count') || '0', 10) + 1;
    localStorage.setItem('kj_msg_count', n);
    if (n % SUGGEST_EVERY !== 0) return;
    if (localStorage.getItem('kj_pending_scene')) return;   // 已有一条待处理的建议
    suggestScene().catch(() => {});   // 静默失败，不打扰用户
  }

  async function suggestScene() {
    const provider = config.moonshotKey ? 'moonshot' : 'deepseek';
    const key = config[PROVIDERS[provider].keyField];
    if (!key) return;
    const model = config.chatModels[provider] || DEFAULT_MODELS[provider];
    // 收集最近的用户提问
    const userTexts = [];
    for (const c of conversations) {
      for (const m of c.messages) if (m.role === 'user' && m.text) userTexts.push(m.text);
    }
    const recent = userTexts.slice(-20);
    if (recent.length < 6) return;
    const resp = await apiFetch(provider, '/chat/completions', key, {
      method: 'POST',
      body: JSON.stringify({
        model, stream: false, max_tokens: 512,
        messages: [
          {
            role: 'system',
            content: '根据用户的历史提问记录，如果发现反复出现的主题、或适合做成一键直达的常用功能，输出一个 JSON：{"label":"按钮名（不超过6个字）","icon":"一个emoji","prompt":"点按钮后自动发送的一句话"}。' +
              '不要和这些已有按钮重复：' + scenes.map((s) => s.label).join('、') + '。如果没有合适的，只输出两个字：不需要',
          },
          { role: 'user', content: recent.map((t, i) => `${i + 1}. ${t}`).join('\n') },
        ],
      }),
    });
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return;
    let obj;
    try { obj = JSON.parse(m[0]); } catch (_) { return; }
    if (!obj.label || !obj.prompt) return;
    if (scenes.some((s) => s.label === obj.label)) return;
    localStorage.setItem('kj_pending_scene', JSON.stringify(obj));
  }

  function showPendingSuggestion() {
    const raw = localStorage.getItem('kj_pending_scene');
    if (!raw) return;
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { localStorage.removeItem('kj_pending_scene'); return; }
    if (!obj.label || !obj.prompt) { localStorage.removeItem('kj_pending_scene'); return; }
    const box = $('sceneSuggest');
    box.querySelector('.suggest-text').textContent = `💡 要不要加一个「${(obj.icon || '') + ' ' + obj.label}」的快捷按钮？`;
    box.classList.remove('hidden');
    $('btnSuggestYes').onclick = () => {
      scenes.push({ icon: obj.icon || '💡', label: obj.label, prompt: obj.prompt, needsImage: false });
      saveScenes(); renderChips();
      localStorage.removeItem('kj_pending_scene');
      box.classList.add('hidden');
    };
    $('btnSuggestNo').onclick = () => {
      localStorage.removeItem('kj_pending_scene');
      box.classList.add('hidden');
    };
  }

  /* ========== 首次使用引导 ========== */

  function bindOnboarding() {
    const steps = ['obStepRole', 'obStepKey', 'obStepGuide', 'obStepParent'];
    const show = (id) => steps.forEach((s) => $(s).classList.toggle('hidden', s !== id));
    const done = () => {
      $('onboardModal').classList.add('hidden');
      localStorage.setItem('kj_onboarded', '1');
    };
    $('obChild').addEventListener('click', () => show('obStepKey'));
    $('obParent').addEventListener('click', () => show('obStepParent'));
    $('obHasKey').addEventListener('click', () => { done(); openSettings(); });
    $('obNoKey').addEventListener('click', () => show('obStepGuide'));
    $('obGuideDone').addEventListener('click', () => { done(); openSettings(); });
    $('obParentScan').addEventListener('click', () => { done(); openSettings(); startScan(); });
    $('obParentImg').addEventListener('click', () => { done(); openSettings(); $('qrImageInput').click(); });
    $('obParentSkip').addEventListener('click', done);

    // 两个 Key 都没有且没完成过引导 → 弹出
    if (!config.moonshotKey && !config.deepseekKey && !localStorage.getItem('kj_onboarded')) {
      $('onboardModal').classList.remove('hidden');
      show('obStepRole');
    }
  }

  /* ========== 连接检测 ========== */

  /* 一张 48×48 纯红色小图，用于测识图 */
  const DIAG_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAQklEQVR4nO3OQQ0AIAwAsSmZf1GIwQXHo0kFdM7uVyYfCAkJCdUDISEhoXogJCQkVA+EhISE6oGQkJBQPRASEnrsAuEy2Ii2PBH4AAAAAElFTkSuQmCC';

  async function diagChat(provider, key, body) {
    try {
      const resp = await apiFetch(provider, '/chat/completions', key, {
        method: 'POST',
        body: JSON.stringify({ stream: false, ...body }),
      });
      return { ok: true, data: await resp.json() };
    } catch (e) {
      return { ok: false, error: `HTTP ${e.status}: ${e.message}` };
    }
  }

  async function runDiagnostics() {
    const box = $('diagResult');
    const btn = $('btnDiag');
    box.innerHTML = '';
    btn.disabled = true;
    btn.textContent = '检测中…';

    const add = (name, ok, detail) => {
      const div = document.createElement('div');
      div.className = 'diag-item';
      div.innerHTML = `${ok ? '✅' : '❌'} ${escapeHtml(name)}` +
        (detail ? `<div class="raw">${escapeHtml(detail)}</div>` : '');
      box.appendChild(div);
    };

    const cfg = formConfig();
    const provider = cfg.chatProvider;
    const key = cfg.keys[provider];
    const model = cfg.chatModels[provider];

    // 0. Key
    if (!key) {
      add('API Key', false, '未填写 ' + PROVIDERS[provider].name + ' 的 Key');
      btn.disabled = false; btn.textContent = '开始一键检测';
      return;
    }
    add('使用渠道', true, `${PROVIDERS[provider].name} / 模型：${model}`);

    // 1. 连接
    let modelList = [];
    try {
      modelList = await listModels(provider, key);
    } catch (_) {}
    if (modelList.length) {
      const has = modelList.includes(model);
      add('连接与 Key', true, `连接正常，账号下有 ${modelList.length} 个模型`);
      add('模型名检查', has,
        has ? `模型 ${model} 存在` : `模型列表里没有「${model}」！可用模型示例：${modelList.slice(0, 8).join(', ')}`);
    } else {
      // listModels 失败时给出原始错误
      const r = await diagChat(provider, key, { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 });
      add('连接与 Key', r.ok, r.ok ? '连接正常' : r.error);
      if (!r.ok) { btn.disabled = false; btn.textContent = '开始一键检测'; return; }
    }

    // 2. 纯文本对话
    const t2 = await diagChat(provider, key, {
      model,
      messages: [{ role: 'user', content: '只回复两个字：可以' }],
      max_tokens: 1024,
    });
    add('文本对话', t2.ok && !!(t2.data.choices?.[0]?.message?.content),
      t2.ok ? ('模型回复：' + (t2.data.choices?.[0]?.message?.content || '（空）')).slice(0, 80) : t2.error);

    // 3. 识图
    const vProvider = cfg.visionProvider || cfg.chatProvider;
    const vKey = cfg.keys[vProvider];
    const vModel = cfg.visionModels[vProvider] || cfg.chatModels[vProvider];
    if (!vKey) {
      add('识图', false, '识图渠道 ' + PROVIDERS[vProvider].name + ' 没填 Key');
    } else {
      const t3 = await diagChat(vProvider, vKey, {
        model: vModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: DIAG_IMAGE } },
            { type: 'text', text: '这张图片是什么颜色？' },
          ],
        }],
        max_tokens: 1024,
      });
      add(`识图（${PROVIDERS[vProvider].name} / ${vModel}）`, t3.ok,
        t3.ok ? ('模型回复：' + (t3.data.choices?.[0]?.message?.content || '（空）')).slice(0, 80) : t3.error);
    }

    // 4. 工具调用（联网 + 沙盒）
    const tools = [];
    if (provider === 'moonshot' && cfg.enableWebSearch) {
      tools.push({ type: 'builtin_function', function: { name: '$web_search' } });
    }
    if (cfg.enableSandbox) tools.push(RUN_PYTHON_TOOL);
    if (!tools.length) {
      add('工具调用', false, '联网和沙盒开关都关了，无从检测');
    } else {
      const t4 = await diagChat(provider, key, {
        model,
        messages: [{ role: 'user', content: '请调用 run_python 工具计算 123 乘以 456，不要口算。' }],
        tools,
        max_tokens: 2048,
      });
      const tcs = t4.ok ? (t4.data.choices?.[0]?.message?.tool_calls || []) : [];
      add('工具调用', t4.ok && tcs.length > 0,
        t4.ok
          ? (tcs.length ? `模型请求调用：${tcs.map((t) => t.function.name).join(', ')}` : '模型没有发起工具调用（finish_reason=' + (t4.data.choices?.[0]?.finish_reason || '?') + '）')
          : t4.error);
    }

    // 5. 联网搜索实测（按渠道分流：Kimi 官方工具 / 千问 Responses / DeepSeek Responses）
    if (cfg.enableWebSearch && provider === 'moonshot' && cfg.keys.moonshot) {
      try {
        const sTools = await getFormulaTools(cfg.keys.moonshot, FORMULA.webSearch);
        const sMsgs = [{ role: 'user', content: '请联网搜索一下：今天是几月几号？最近有什么新闻？' }];
        const s1 = await diagChat('moonshot', cfg.keys.moonshot, { model: cfg.chatModels.moonshot, messages: sMsgs, tools: sTools, max_tokens: 8192 });
        if (!s1.ok) {
          add('联网搜索实测（Kimi 官方通道）', false, s1.error);
        } else {
          const m1 = s1.data.choices?.[0]?.message || {};
          const tcs = m1.tool_calls || [];
          const searchCall = tcs.find((t) => t.function?.name === 'web_search');
          if (!searchCall) {
            add('联网搜索实测（Kimi 官方通道）', false, '模型没有发起搜索（回复：' + (m1.content || '（空）').slice(0, 60) + '）');
          } else {
            // 模型可能一次发起多个并行搜索，必须每个 tool_call 都有对应的 tool 回复
            sMsgs.push(m1);
            for (const tc of tcs) {
              let content;
              if (tc.function?.name === 'web_search') {
                content = await runFormula(cfg.keys.moonshot, FORMULA.webSearch, tc.function.name, tc.function.arguments);
              } else {
                content = JSON.stringify({ error: 'unknown tool' });
              }
              sMsgs.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content });
            }
            const s2 = await diagChat('moonshot', cfg.keys.moonshot, { model: cfg.chatModels.moonshot, messages: sMsgs, tools: sTools, max_tokens: 8192 });
            const ans = s2.ok ? (s2.data.choices?.[0]?.message?.content || '') : '';
            const fr = s2.ok ? (s2.data.choices?.[0]?.finish_reason || '?') : '';
            add('联网搜索实测（Kimi 官方通道）', s2.ok && !!ans,
              s2.ok
                ? (ans ? ('搜索完成，回答：' + ans.slice(0, 80)) : `回答为空（finish_reason=${fr}，疑似 max_tokens 截断）`)
                : s2.error);
          }
        }
      } catch (e) {
        add('联网搜索实测（Kimi 官方通道）', false, String(e.message || e) + '（正式使用时会自动回退到内置搜索）');
      }
    } else if (cfg.enableWebSearch && provider === 'qwen' && cfg.keys.qwen) {
      try {
        const r = await streamResponses({
          provider: 'qwen', key: cfg.keys.qwen, model: cfg.chatModels.qwen,
          messages: [{ role: 'user', content: '请联网搜索：今天有什么新闻？' }],
          tools: [{ type: 'web_search' }],
          onContent: () => {},
        });
        add('联网搜索实测（千问 Responses）', !!r.content,
          r.content ? ('回答：' + r.content.slice(0, 80)) : '返回为空');
      } catch (e) {
        add('联网搜索实测（千问 Responses）', false, String(e.message || e));
      }
    } else if (cfg.enableWebSearch && provider === 'deepseek' && cfg.keys.deepseek && !cfg.enableSandbox) {
      try {
        const r = await streamResponses({
          provider: 'deepseek', key: cfg.keys.deepseek, model: cfg.chatModels.deepseek,
          messages: [{ role: 'user', content: '请联网搜索：今天有什么新闻？' }],
          tools: [{ type: 'web_search' }],
          onContent: () => {},
        });
        add('联网搜索实测（DeepSeek Responses）', !!r.content,
          r.content ? ('回答：' + r.content.slice(0, 80)) : '返回为空');
      } catch (e) {
        add('联网搜索实测（DeepSeek Responses）', false, String(e.message || e));
      }
    } else if (cfg.enableWebSearch && provider === 'deepseek' && cfg.enableSandbox) {
      add('联网搜索实测', false, 'DeepSeek 的搜索和沙盒互斥：开了沙盒就无联网（平台限制）；关掉沙盒可测');
    } else if (!cfg.enableWebSearch) {
      add('联网搜索实测', false, '联网搜索开关是关的');
    }

    // 6. 云端沙盒实测（Kimi 官方 code-runner；目前普通账户普遍无权限，失败不影响使用，会自动用本机沙盒）
    if (cfg.enableSandbox && cfg.keys.moonshot) {
      try {
        const out = await runFormula(cfg.keys.moonshot, FORMULA.codeRunner, 'code_runner', JSON.stringify({ code: 'print(123*456)' }));
        add('云端沙盒实测（Kimi code-runner）', String(out).includes('56088'),
          String(out).slice(0, 80) || '返回为空');
      } catch (e) {
        const msg = String(e.message || e);
        const noPerm = /permission|not found|not open|forbidden/i.test(msg);
        add('云端沙盒实测（Kimi code-runner）', false,
          noPerm
            ? '你的账户没有云端沙盒权限（code-runner 目前未对普通账户开放）。不影响使用：计算会直接用本机沙盒，首次计算需下载约 15MB 组件。'
            : msg + '（正式使用时会自动回退到本机沙盒）');
      }
    }

    btn.disabled = false;
    btn.textContent = '开始一键检测';
  }

  /* ========== 应用内扫码 ========== */

  let scanStream = null;
  let scanTimer = null;

  /* 用 jsQR 解码一块画布上的图像（过大先缩小，加快速度） */
  function decodeQRFromImage(source, width, height) {
    const MAX = 1280;
    const scale = Math.min(1, MAX / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(frame.data, frame.width, frame.height);
  }

  async function startScan() {
    if (typeof jsQR === 'undefined') {
      alert('扫码组件没加载成功，请刷新页面再试。');
      return;
    }
    const overlay = $('scanOverlay');
    const video = $('scanVideo');
    overlay.classList.remove('hidden');
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = scanStream;
      await video.play();
      scanTimer = setInterval(() => {
        try {
          if (!video.videoWidth) return;
          const code = decodeQRFromImage(video, video.videoWidth, video.videoHeight);
          if (code && code.data) {
            stopScan();
            handleScanned(code.data);
          }
        } catch (_) {}
      }, 500);
    } catch (e) {
      stopScan();
      alert('打不开摄像头：请允许使用相机，或改用「从相册选二维码图片」。');
    }
  }

  function stopScan() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
    $('scanOverlay').classList.add('hidden');
  }

  function handleScanned(text) {
    try {
      const u = new URL(text);
      if (u.hash.startsWith('#cfg=')) {
        location.hash = u.hash;
        if (importConfigFromHash()) {
          closeSettings();
          alert('✅ 配置已导入，可以直接用了！');
        }
        return;
      }
    } catch (_) {}
    alert('这个二维码不是本应用的配置码。');
  }

  /* ========== 设置页事件 ========== */

  function bindSettings() {
    $('btnBack').addEventListener('click', () => { closeSettings(); });
    $('verText').textContent = APP_VERSION;

    $('btnSaveCfg').addEventListener('click', () => {
      const fc = formConfig();
      config.moonshotKey = fc.keys.moonshot;
      config.deepseekKey = fc.keys.deepseek;
      config.qwenKey = fc.keys.qwen;
      config.chatProvider = fc.chatProvider;
      config.visionProvider = fc.visionProvider;
      config.chatModels = fc.chatModels;
      config.visionModels = fc.visionModels;
      config.enableWebSearch = fc.enableWebSearch;
      config.enableSandbox = fc.enableSandbox;
      config.sendOriginal = $('cfgSendOriginal').checked;
      config.activePrompt = parseInt($('cfgPromptSelect').value, 10) || 0;
      saveConfig();
      alert('设置已保存 ✅');
    });

    // 模型列表：每个渠道一个按钮，结果渲染在该渠道区块内
    let lastModelInput = null;
    ['moonshot', 'deepseek', 'qwen'].forEach((p) => {
      $('cfgChat_' + p).addEventListener('focus', () => { lastModelInput = $('cfgChat_' + p); });
      $('cfgVis_' + p).addEventListener('focus', () => { lastModelInput = $('cfgVis_' + p); });
    });

    /* 千问是聚合平台，模型几百个，按用途过滤；其他渠道全量展示 */
    function filterModels(p, models) {
      if (p !== 'qwen') return { chat: models, vision: [] };
      const vision = models.filter((m) => /vl/i.test(m));
      const chat = models.filter((m) =>
        /^(qwen3|qwen-plus|qwen-max|qwen-flash|qwen-turbo|qwen-long|qwq)/i.test(m) &&
        !/(image|audio|edit|math|coder|asr|omni|realtime|character|deep-research|deep-search)/i.test(m));
      return { chat: chat.length ? chat : models, vision };
    }

    document.querySelectorAll('.btnFetchModels').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const p = btn.dataset.provider;
        const key = $('cfgKey_' + p).value.trim() || config[PROVIDERS[p].keyField];
        if (!key) { alert(`先填 ${PROVIDERS[p].name} 的 API Key`); return; }
        btn.textContent = '获取中…';
        const models = await listModels(p, key);
        btn.textContent = '获取模型列表';
        const box = $('chips_' + p);
        box.innerHTML = '';
        if (!models.length) { alert('没拿到模型列表，请检查 Key 和网络。'); return; }
        const { chat, vision } = filterModels(p, models);
        const addGroup = (label, list) => {
          if (!list.length) return;
          const tag = document.createElement('span');
          tag.className = 'hint';
          tag.textContent = label;
          box.appendChild(tag);
          list.forEach((m) => {
            const chip = document.createElement('button');
            chip.className = 'model-chip';
            chip.textContent = m;
            chip.addEventListener('click', () => {
              const target = lastModelInput || $('cfgChat_' + p);
              target.value = m;
            });
            box.appendChild(chip);
          });
        };
        if (vision.length) addGroup('识图：', vision);
        addGroup(p === 'qwen' ? `聊天（已从 ${models.length} 个过滤）：` : '聊天：', chat);
      });
    });

    $('btnDiag').addEventListener('click', runDiagnostics);
    $('btnScanQR').addEventListener('click', startScan);
    $('btnScanClose').addEventListener('click', stopScan);
    $('btnScanImage').addEventListener('click', () => $('qrImageInput').click());
    $('qrImageInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (typeof jsQR === 'undefined') {
        alert('扫码组件没加载成功，请刷新页面再试。');
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const code = decodeQRFromImage(img, img.naturalWidth, img.naturalHeight);
          if (code && code.data) handleScanned(code.data);
          else alert('没认出二维码，换一张更清晰的截图试试。');
        } catch (_) {
          alert('识别失败，请直接用相机或微信扫码。');
        }
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => alert('图片读取失败。');
      img.src = URL.createObjectURL(file);
    });

    // 错误报告
    $('btnErrorReport').addEventListener('click', async () => {
      const report = await buildErrorReport();
      if (navigator.share) {
        try { await navigator.share({ title: '智能助手错误报告', text: report }); return; } catch (_) {}
      }
      try {
        await navigator.clipboard.writeText(report);
        alert('✅ 错误报告已复制到剪贴板，直接粘贴发给家人即可。');
      } catch (_) {
        prompt('长按复制以下内容发给家人：', report);
      }
    });

    // 首页快捷按钮
    $('btnAddScene').addEventListener('click', () => {
      scenes.push({ icon: '💡', label: '新按钮', prompt: '', needsImage: false });
      saveScenes(); renderChips(); renderSceneEditor();
    });

    // prompt 预设管理
    $('cfgPromptSelect').addEventListener('change', (e) => {
      $('cfgPromptText').value = prompts[parseInt(e.target.value, 10)]?.content || '';
    });
    $('btnSavePrompt').addEventListener('click', () => {
      const i = parseInt($('cfgPromptSelect').value, 10) || 0;
      prompts[i].content = $('cfgPromptText').value;
      savePrompts();
      alert('人设已保存 ✅');
    });
    $('btnNewPrompt').addEventListener('click', () => {
      const name = prompt('新预设叫什么名字？');
      if (!name) return;
      prompts.push({ name, content: '' });
      config.activePrompt = prompts.length - 1;
      savePrompts(); saveConfig();
      refreshPromptSelect();
      alert(`已创建空白预设「${name}」，在下方文本框里写内容，写完点「保存修改」。`);
    });
    $('btnDelPrompt').addEventListener('click', () => {
      if (prompts.length <= 1) { alert('至少保留一个预设。'); return; }
      const i = parseInt($('cfgPromptSelect').value, 10) || 0;
      if (!confirm(`删除预设「${prompts[i].name}」？`)) return;
      prompts.splice(i, 1);
      config.activePrompt = 0;
      savePrompts(); saveConfig();
      refreshPromptSelect();
    });

    // 配置二维码
    $('btnMakeQR').addEventListener('click', () => {
      const payload = {
        m: $('cfgKey_moonshot').value.trim() || config.moonshotKey,
        d: $('cfgKey_deepseek').value.trim() || config.deepseekKey,
        q: $('cfgKey_qwen').value.trim() || config.qwenKey || '',
        ms: formConfig().chatModels,
        vs: formConfig().visionModels,
        p: formConfig().chatProvider,
        vd: formConfig().visionProvider,
        ws: true,
        sb: true,
      };
      if ($('cfgQrFull').checked) {
        payload.pr = prompts;
        payload.pi = config.activePrompt;
        payload.sc = scenes;
      }
      if (!payload.m && !payload.d && !payload.q) { alert('先填至少一个 API Key 再生成。'); return; }
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const url = location.origin + location.pathname + '#cfg=' + b64;
      try {
        const qr = qrcode(0, 'L');   // L 纠错容量最大
        qr.addData(url);
        qr.make();
        $('qrBox').innerHTML = qr.createImgTag(6, 10);
      } catch (e) {
        logError('二维码生成失败: ' + (e.message || e));
        alert('内容太多，二维码放不下。\n请取消勾选「同时分享人设预设和首页快捷按钮」，或精简预设后再试。');
      }
    });

    $('btnWipe').addEventListener('click', () => {
      if (confirm('清空本机的 Key、对话和全部设置？此操作不可恢复！')) {
        localStorage.clear();
        location.href = location.pathname;
      }
    });

    $('btnPinCfg').addEventListener('click', () => {
      if (!config.moonshotKey && !config.deepseekKey) { alert('先填至少一个 API Key。'); return; }
      putConfigInHash();
      alert('✅ 配置已写进网址。\n\n现在请点浏览器菜单 →「添加到主屏幕 / 书签」。\n以后即使浏览器数据被清空，打开这个图标也会自动恢复配置。');
    });

    // 对话记录导出/导入（防清数据丢失）
    $('btnExportConv').addEventListener('click', () => {
      if (!conversations.length) { alert('还没有对话记录。'); return; }
      const json = JSON.stringify(conversations, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '对话记录-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      alert('已导出。如果浏览器没有弹出下载，请检查浏览器的下载目录。');
    });
    $('btnImportConv').addEventListener('click', () => $('convFileInput').click());
    $('convFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data) || !data.every((c) => c && c.id && Array.isArray(c.messages))) {
          throw new Error('bad format');
        }
        if (!confirm(`导入 ${data.length} 条对话？会覆盖本机现有的对话记录！`)) return;
        conversations = data;
        currentId = null;
        saveConversations();
        renderCurrentConv();
        alert('✅ 导入完成');
      } catch (_) {
        alert('文件不对，请选之前导出的 .json 文件。');
      }
    });
  }

  /* ========== 启动 ========== */

  async function init() {
    loadState();
    loadScenes();
    loadErrorLog();
    applyFont();
    applyTheme();
    setInterval(applyTheme, 60000);   // 每分钟检查是否进出夜间时段
    await loadConversations();        // IndexedDB（异步）
    // 请求浏览器不要自动清理本站存储（鸿蒙等激进清理场景）
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const imported = importConfigFromHash();

    // 回到前台时，如果有挂起的网络重试，立即执行
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && pendingNetRetry) {
        clearTimeout(netRetryTimer);
        setStatus('📶 回来了，正在重新连接…');
        runNetRetry();
      }
    });

    // 启动策略：30 分钟内被杀后台重载 → 恢复刚才的对话；超过 30 分钟 → 回到新对话首页
    if (!imported) {
      const last = conversations.find((c) => c.id === currentId);
      if (!(last && last.messages.length && Date.now() - last.updatedAt < 30 * 60 * 1000)) {
        currentId = null;
        localStorage.setItem('kj_current', '');
      }
    }

    bindInput();
    bindTopbar();
    bindSettings();
    bindAppearance();
    bindInstall();
    bindOnboarding();

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    Sandbox.onProgress = (t) => setStatus('🧮 ' + t);

    renderChips();
    renderCurrentConv();
    showPendingSuggestion();

    // 「发原图」勾选状态恢复
    $('cfgSendOriginal').checked = !!config.sendOriginal;
    $('cfgSendOriginal').addEventListener('change', () => {
      config.sendOriginal = $('cfgSendOriginal').checked;
      saveConfig();
    });

    if (imported) {
      setTimeout(() => {
        if (/MicroMessenger/i.test(navigator.userAgent)) {
          alert('✅ 配置已识别！\n\n但这是微信内置浏览器，还不能长期使用。\n请点右上角「···」→「在浏览器打开」，到手机浏览器里会自动再配置一次，才能真正保存。');
        } else {
          alert('✅ 配置已完成，直接点下方按钮就能用了！');
        }
      }, 300);
    }
  }

  init().catch((e) => console.error('启动失败:', e));
})();
