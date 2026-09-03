/* sandbox.js — 端侧 Python 沙盒（Pyodide，Web Worker）主线程接口 */

const Sandbox = (() => {
  let worker = null;
  let loading = null;       // Promise | null
  let pending = null;       // 当前执行的 {resolve, reject, timer}
  const RUN_TIMEOUT = 30000;

  function spawn() {
    worker = new Worker('pyworker.js');
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        // 由 loading 的 then 处理
      } else if (msg.type === 'progress') {
        Sandbox.onProgress && Sandbox.onProgress(msg.text);
      } else if (msg.type === 'result' && pending) {
        clearTimeout(pending.timer);
        const p = pending; pending = null;
        p.resolve(msg);
      }
    };
    worker.onerror = (e) => {
      if (pending) {
        clearTimeout(pending.timer);
        const p = pending; pending = null;
        p.resolve({ stdout: '', stderr: '', error: '沙盒出错了：' + (e.message || '未知错误'), images: [] });
      }
    };
  }

  /* 懒加载 Pyodide，返回 Promise */
  function ensureLoaded() {
    if (worker) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      spawn();
      const onMsg = (e) => {
        if (e.data.type === 'ready') {
          worker.removeEventListener('message', onMsg);
          resolve();
        } else if (e.data.type === 'init-error') {
          worker.removeEventListener('message', onMsg);
          reset();
          reject(new Error(e.data.error));
        }
      };
      worker.addEventListener('message', onMsg);
    });
    return loading;
  }

  function reset() {
    if (worker) { worker.terminate(); worker = null; }
    loading = null;
    if (pending) {
      clearTimeout(pending.timer);
      const p = pending; pending = null;
      p.resolve({ stdout: '', stderr: '', error: '计算超时，已重新开始。', images: [] });
    }
  }

  /*
   * 执行 Python 代码。
   * 返回 { stdout, stderr, error, images:[dataURL...] }
   */
  async function run(code) {
    await ensureLoaded();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        reset(); // 超时：杀掉 worker，下次重新加载
      }, RUN_TIMEOUT);
      pending = { resolve, timer, reject: resolve };
      worker.postMessage({ type: 'run', code });
    });
  }

  return { run, ensureLoaded, reset, onProgress: null };
})();
