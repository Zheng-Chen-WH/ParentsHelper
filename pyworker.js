/* pyworker.js — Pyodide Web Worker：加载 Python 运行时并执行代码 */

let pyodide = null;
let stdoutBuf = '';
let stderrBuf = '';

function report(text) {
  postMessage({ type: 'progress', text });
}

async function init() {
  try {
    report('正在下载计算组件（约 15MB，仅第一次较慢）…');
    importScripts('pyodide/pyodide.js');
    // 用绝对路径，避免相对路径在 worker 里解析不一致
    pyodide = await loadPyodide({ indexURL: new URL('pyodide/', self.location.href).href });

    pyodide.setStdout({ batched: (s) => { stdoutBuf += s + '\n'; } });
    pyodide.setStderr({ batched: (s) => { stderrBuf += s + '\n'; } });

    report('正在准备科学计算包…');
    await pyodide.loadPackage(['numpy', 'pandas', 'matplotlib', 'micropip']);

    // 内置中文字体（如果站点带了 fonts/chinese.otf），没有也不影响使用
    try {
      const resp = await fetch('fonts/chinese.otf');
      if (resp.ok) {
        const buf = new Uint8Array(await resp.arrayBuffer());
        pyodide.FS.mkdirTree('/fonts');
        pyodide.FS.writeFile('/fonts/chinese.otf', buf);
      }
    } catch (_) {}

    await pyodide.runPythonAsync(`
import matplotlib
matplotlib.use('agg')
import matplotlib.pyplot as plt
import io, base64, os

__font_ok = False
if os.path.exists('/fonts/chinese.otf'):
    try:
        from matplotlib import font_manager
        font_manager.fontManager.addfont('/fonts/chinese.otf')
        __name = font_manager.FontProperties(fname='/fonts/chinese.otf').get_name()
        plt.rcParams['font.sans-serif'] = [__name] + plt.rcParams['font.sans-serif']
        plt.rcParams['axes.unicode_minus'] = False
        __font_ok = True
    except Exception:
        pass

def __harvest_figures():
    imgs = []
    for i in plt.get_fignums():
        fig = plt.figure(i)
        b = io.BytesIO()
        fig.savefig(b, format='png', dpi=110, bbox_inches='tight')
        imgs.append('data:image/png;base64,' + base64.b64encode(b.getvalue()).decode())
    plt.close('all')
    return imgs
`);
    postMessage({ type: 'ready' });
  } catch (e) {
    postMessage({ type: 'init-error', error: String(e && e.message || e) });
  }
}

onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== 'run' || !pyodide) return;

  stdoutBuf = '';
  stderrBuf = '';
  let error = '';
  let images = [];

  try {
    await pyodide.runPythonAsync(msg.code);
  } catch (err) {
    // 只保留最后一行错误，太长模型也读不动
    const s = String(err && err.message || err);
    error = s.split('\n').filter(Boolean).slice(-6).join('\n');
  }

  try {
    images = pyodide.globals.get('__harvest_figures')().toJs();
  } catch (_) { images = []; }

  postMessage({
    type: 'result',
    stdout: stdoutBuf.trim(),
    stderr: stderrBuf.trim(),
    error,
    images,
  });
};

init();
