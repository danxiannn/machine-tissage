// ===================== 图像调整：色阶 / 曲线 / 色调分离 / 双色调 ... =====================
// 每个图层（A、B、C）各自有一组调整参数（layers[k].adj）。
// 处理后的图像存在 layers[k].proc，drawLayer 会优先使用它，所以格子模式和手工模式都自动生效。

const ADJ_MAX = 4096;                   // 处理时图像最长边的上限（太大的图会先缩小，避免卡顿）

function adjIsIdentity(a) {
  return a.bright === 0 && a.contrast === 1 && a.sat === 1 && a.black === 0 && a.white === 1 && a.gamma === 1 &&
         !(a.post >= 2) && !a.gray && !a.duo && a.curve.length === 2 && a.curve[0][1] === 0 && a.curve[1][1] === 1;
}

// 曲线 → 256 级查找表（单调三次插值，不会出现过冲）
function curveLUT(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]), n = p.length, out = new Float32Array(256);
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]), d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
    if (q > 9) { const t = 3 / Math.sqrt(q); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let seg = 0;
  for (let v = 0; v < 256; v++) {
    const x = v / 255;
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const h = Math.max(1e-6, xs[seg + 1] - xs[seg]), t = Math.min(1, Math.max(0, (x - xs[seg]) / h)), t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h * m[seg + 1];
    out[v] = Math.min(1, Math.max(0, y));
  }
  return out;
}
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function adjustLayer(k) {
  const L = layers[k], a = L.adj;
  if (!L.img || adjIsIdentity(a)) { L.proc = null; return; }
  const im = L.img, sc = Math.min(1, ADJ_MAX / Math.max(im.width, im.height));
  const w = Math.max(1, Math.round(im.width * sc)), h = Math.max(1, Math.round(im.height * sc));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h), d = id.data;

  // 每个通道的查找表：色阶 → 曲线 → 亮度 / 对比度 → 色调分离
  const curve = curveLUT(a.curve), lut = new Uint8Array(256), span = Math.max(0.01, a.white - a.black);
  for (let v = 0; v < 256; v++) {
    let x = Math.min(1, Math.max(0, (v / 255 - a.black) / span));
    x = Math.pow(x, 1 / a.gamma);
    x = curve[Math.round(x * 255)];
    x = (x - 0.5) * a.contrast + 0.5 + a.bright;
    x = Math.min(1, Math.max(0, x));
    if (a.post >= 2) x = Math.round(x * (a.post - 1)) / (a.post - 1);
    lut[v] = Math.round(x * 255);
  }
  const d1 = hexRGB(a.d1), d2 = hexRGB(a.d2), doSat = a.gray || a.sat !== 1;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], gg = d[i + 1], b = d[i + 2];
    if (doSat) {                                   // 饱和度 / 黑白
      const l = 0.299 * r + 0.587 * gg + 0.114 * b, sat = a.gray ? 0 : a.sat;
      r = Math.min(255, Math.max(0, l + (r - l) * sat)); gg = Math.min(255, Math.max(0, l + (gg - l) * sat)); b = Math.min(255, Math.max(0, l + (b - l) * sat));
    }
    r = lut[r | 0]; gg = lut[gg | 0]; b = lut[b | 0];
    if (a.duo) {                                   // 双色调：按明度在两种颜色之间过渡
      const l = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
      r = d1[0] + (d2[0] - d1[0]) * l; gg = d1[1] + (d2[1] - d1[1]) * l; b = d1[2] + (d2[2] - d1[2]) * l;
    }
    d[i] = r; d[i + 1] = gg; d[i + 2] = b;
  }
  g.putImageData(id, 0, 0);
  L.proc = c;
}

// 拖滑块时每帧最多处理一次
const adjPending = {};
function scheduleAdjust(k) {
  if (adjPending[k]) return;
  adjPending[k] = true;
  requestAnimationFrame(() => { adjPending[k] = false; adjustLayer(k); queueRender(); });
}

// ---------- 界面 ----------
const adjInputs = [...document.querySelectorAll('[data-adj]')];
function syncAdjUI() {
  const a = layers[cur].adj;
  adjInputs.forEach(el => {
    const v = a[el.dataset.adj];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  drawCurve();
}
adjInputs.forEach(el => {
  const key = el.dataset.adj;
  el.addEventListener('input', () => {
    layers[cur].adj[key] = el.type === 'checkbox' ? el.checked : el.type === 'color' ? el.value : +el.value;
    scheduleAdjust(cur);
  });
  el.addEventListener('change', () => pushHistory('Adjust ' + cur + ': ' + key));
});
$('adjReset').addEventListener('click', () => {
  layers[cur].adj = DEF_ADJ(); syncAdjUI(); adjustLayer(cur); queueRender(); pushHistory('Reset adjustments ' + cur);
});
document.querySelectorAll('input[name=layer]').forEach(r => r.addEventListener('change', syncAdjUI));

// ---------- 曲线编辑器 ----------
const cvc = $('curveCv'), cg = cvc.getContext('2d');
let curveDrag = -1;
function drawCurve() {
  const w = cvc.width, h = cvc.height, pts = layers[cur].adj.curve;
  cg.clearRect(0, 0, w, h);
  cg.fillStyle = '#fff'; cg.fillRect(0, 0, w, h);
  cg.strokeStyle = '#e1dfd8'; cg.lineWidth = 1;
  for (let i = 1; i < 4; i++) { cg.beginPath(); cg.moveTo(i * w / 4, 0); cg.lineTo(i * w / 4, h); cg.moveTo(0, i * h / 4); cg.lineTo(w, i * h / 4); cg.stroke(); }
  cg.strokeStyle = '#bbb'; cg.beginPath(); cg.moveTo(0, h); cg.lineTo(w, 0); cg.stroke();
  const lut = curveLUT(pts);
  cg.strokeStyle = '#1b1b1b'; cg.lineWidth = 2; cg.beginPath();
  for (let v = 0; v < 256; v++) { const x = v / 255 * w, y = h - lut[v] * h; v ? cg.lineTo(x, y) : cg.moveTo(x, y); }
  cg.stroke();
  pts.forEach(([x, y], i) => {
    cg.fillStyle = i === curveDrag ? '#2b3bd6' : '#fff'; cg.strokeStyle = '#2b3bd6'; cg.lineWidth = 2;
    cg.beginPath(); cg.arc(x * w, h - y * h, 5, 0, T); cg.fill(); cg.stroke();
  });
}
const curvePos = e => {
  const r = cvc.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
};
cvc.addEventListener('pointerdown', e => {
  cvc.setPointerCapture(e.pointerId);
  const pts = layers[cur].adj.curve, [x, y] = curvePos(e), r = cvc.getBoundingClientRect();
  let best = -1, bd = 12 / r.width;
  pts.forEach((p, i) => { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; best = i; } });
  if (best < 0) {                                   // 点在空白处：添加一个点
    pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]);
    best = pts.findIndex(p => p[0] === x && p[1] === y);
  }
  curveDrag = best; drawCurve();
});
cvc.addEventListener('pointermove', e => {
  if (curveDrag < 0) return;
  const pts = layers[cur].adj.curve, [x, y] = curvePos(e), last = pts.length - 1;
  const lo = curveDrag === 0 ? 0 : pts[curveDrag - 1][0] + 0.01, hi = curveDrag === last ? 1 : pts[curveDrag + 1][0] - 0.01;
  pts[curveDrag] = [curveDrag === 0 ? 0 : curveDrag === last ? 1 : Math.min(hi, Math.max(lo, x)), y];   // 两端的 x 固定
  drawCurve(); scheduleAdjust(cur);
});
['pointerup', 'pointercancel'].forEach(t => cvc.addEventListener(t, () => {
  if (curveDrag >= 0) { curveDrag = -1; drawCurve(); pushHistory('Curve ' + cur); }
}));
cvc.addEventListener('dblclick', e => {
  const pts = layers[cur].adj.curve, [x, y] = curvePos(e), r = cvc.getBoundingClientRect();
  const i = pts.findIndex((p, j) => j > 0 && j < pts.length - 1 && Math.hypot(p[0] - x, p[1] - y) < 12 / r.width);
  if (i > 0) { pts.splice(i, 1); drawCurve(); scheduleAdjust(cur); pushHistory('Curve ' + cur); }
});
