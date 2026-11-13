// ===================== 记忆：自动保存 / 恢复上一次的编辑 =====================
// 设置（滑块、选项、图层位置、图像调整、区域形状、手动打乱、抽拉、手动换色……）存在浏览器的 localStorage 里，
// 导入过的图片存在 IndexedDB 里。全部只留在这台电脑的浏览器里，不会上传到任何地方。
// 打开页面时如果发现上次的编辑，会问你“恢复 / 重新开始”；在你选择之前不会自动保存，免得把旧的覆盖掉。

const SESSION_KEY = 'wm-session-v1';
let sessionReady = false, sessionTimer = null;

const idbOpen = () => new Promise((res, rej) => {
  const r = indexedDB.open('weave-machine', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function idbPut(key, val) { const db = await idbOpen(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function idbGet(key) { const db = await idbOpen(); return new Promise((res, rej) => { const rq = db.transaction('files').objectStore('files').get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
async function idbClear() { const db = await idbOpen(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').clear(); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }

function sessionSaveImage(k, file) { idbPut('img-' + k, file).catch(() => {}); }

function sessionSave() {                                          // 每次记录一步操作后调用（稍微等一下再存，避免拖滑条时频繁写入）
  if (!sessionReady) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    try {
      const s = snapshot(), L = {};
      for (const k in s.L) { const { img, ...rest } = s.L[k]; L[k] = rest; }
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ver: 1, build: BUILD, savedAt: Date.now(),
        inputs: s.inputs, L, names: s.names, tile: s.tile, shapes: s.shapes, extra: s.extra }));
    } catch (e) {}
  }, 500);
}

const loadBlobImage = blob => new Promise((res, rej) => {
  const im = new Image();
  im.onload = () => res(im); im.onerror = rej;
  im.src = URL.createObjectURL(blob);
});

async function sessionRestore(saved) {
  const imgs = {};
  for (const k of ['A', 'B', 'C', 'D']) {
    try { const blob = await idbGet('img-' + k); if (blob) imgs[k] = await loadBlobImage(blob); } catch (e) {}
  }
  const L = {};
  for (const k in saved.L) L[k] = { ...saved.L[k], img: imgs[k] || null };
  restore({ inputs: saved.inputs, L, names: saved.names || [], tile: saved.tile, shapes: saved.shapes, extra: saved.extra });
  hist.length = 0; hpos = -1;                                    // 历史从恢复后的状态重新开始
  pushHistory('Restored last session');
}

function sessionCheck() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}
  if (!saved || !saved.inputs) { sessionReady = true; return; }
  const bar = $('restoreBar');
  bar.hidden = false;
  $('restoreYes').onclick = async () => {
    bar.hidden = true;
    try { await sessionRestore(saved); } catch (e) { console.error('restore failed', e); }
    sessionReady = true; sessionSave();
  };
  $('restoreNo').onclick = () => {
    bar.hidden = true;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    idbClear().catch(() => {});
    sessionReady = true;
  };
}
