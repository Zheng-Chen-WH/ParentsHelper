/* jssandbox.js — 端侧 JavaScript 沙盒
 * 在 sandboxed iframe 里运行模型写的 JS（无 allow-same-origin，拿不到页面数据），
 * 内置 ECharts：代码里调 renderChart(option, {width,height}) 生成 PNG 图表。
 * 输出约定：print(...) 收集文本；renderChart(...) 收集图片。
 */

const JSSandbox = (() => {

  const RUNNER_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div id="kjChart" style="position:absolute;left:-99999px;top:0"></div>
<script src="vendor/echarts.min.js"><\/script>
<script>
window.addEventListener('message', function (ev) {
  var data = ev.data || {};
  if (data.type !== 'run') return;
  var logs = [];
  var images = [];
  function fmt(a) {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (_) { return String(a); }
  }
  function print() { logs.push(Array.prototype.map.call(arguments, fmt).join(' ')); }
  function renderChart(option, opts) {
    opts = opts || {};
    var el = document.getElementById('kjChart');
    el.style.width = (opts.width || 640) + 'px';
    el.style.height = (opts.height || 400) + 'px';
    var chart = echarts.init(el, null, { width: opts.width || 640, height: opts.height || 400 });
    option = option || {};
    option.animation = false;   // 产出是静态 PNG：不主动画的话 getDataURL 会截到动画中途的半成品
    chart.setOption(option);
    images.push(chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' }));
    chart.dispose();
  }
  var result = { type: 'result', id: data.id, stdout: '', error: '', images: [] };
  function done() {
    result.stdout = logs.join('\\n');
    result.images = images;
    parent.postMessage(result, '*');
  }
  try {
    var fn = new Function('print', 'renderChart', 'echarts', '"use strict"; return (async function () {' + data.code + '\\n})();');
    Promise.resolve(fn(print, renderChart, echarts)).then(done, function (e) {
      result.error = String(e && e.message || e);
      done();
    });
  } catch (e) {
    result.error = String(e && e.message || e);
    done();
  }
});
parent.postMessage({ type: 'ready', id: 0 }, '*');
<\/script></body></html>`;

  /* 每次运行新建 iframe：状态干净、互不泄漏；ECharts 解析约百毫秒，可忽略 */
  function run(code, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.style.display = 'none';
      const id = Date.now() + Math.random();
      let settled = false;

      const timer = setTimeout(() => {
        finish({ stdout: '', error: '运行超时（15 秒），已中止', images: [] });
      }, timeoutMs);

      function onMsg(ev) {
        if (ev.source !== iframe.contentWindow) return;
        const d = ev.data || {};
        if (d.type !== 'result' || d.id !== id) return;
        finish({ stdout: d.stdout || '', error: d.error || '', images: d.images || [] });
      }
      function finish(r) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        iframe.remove();
        resolve(r);
      }

      window.addEventListener('message', onMsg);
      iframe.onload = () => {
        // srcdoc 里的脚本加载完即就绪；onload 后投送代码
        iframe.contentWindow.postMessage({ type: 'run', id, code }, '*');
      };
      iframe.srcdoc = RUNNER_HTML;
      document.body.appendChild(iframe);
    });
  }

  return { run };
})();
