// ---------- 状态 ----------
const $ = id => document.getElementById(id);
const cv = $('cv');
const ctx = cv.getContext('2d');
const layers = {
  A: { img: null, scale: 1, x: 0, y: 0 },
  B: { img: null, scale: 1, x: 0, y: 0 },
  C: { img: null, scale: 1, x: 0, y: 0 },
};
let cur = 'A';

// ---------- 导入 ----------
['A', 'B', 'C'].forEach(k => {
  $('file' + k).addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => {
      layers[k].img = im;
      // 导入 C 后，如果还在用棋盘格，自动切到 Halftone
      if (k === 'C' && $('algo').value === 'checker') $('algo').value = 'halftone';
      queueRender();
    };
    im.src = URL.createObjectURL(f);
  });
});

// ---------- 图层绘制（cover 填充 + 缩放 + 偏移）----------
// k = 输出相对画布的倍率（导出用 s，取样蒙版用 1/cell）
function drawLayer(c, L, W, H, k) {
  const im = L.img;
  const fit = Math.max(W / im.width, H / im.height);
  const w = im.width * fit * L.scale * k;
  const h = im.height * fit * L.scale * k;
  c.drawImage(im, W * k / 2 + L.x * k - w / 2, H * k / 2 + L.y * k - h / 2, w, h);
}

// ---------- 抖动矩阵 ----------
function bayer(n) {
  let m = [[0, 2], [3, 1]];
  while (m.length < n) {
    const s = m.length, r = [];
    for (let y = 0; y < s * 2; y++) {
      r[y] = [];
      for (let x = 0; x < s * 2; x++) {
        r[y][x] = m[y % s][x % s] * 4 + [[0, 2], [3, 1]][Math.floor(y / s)][Math.floor(x / s)];
      }
    }
    m = r;
  }
  const t = n * n;
  return m.map(r => r.map(v => (v + 0.5) / t));
}
const BAYER = { bayer4: bayer(4), bayer8: bayer(8) };

// 固定随机数（同一格子每次结果一样，拖动时不会闪）
function rnd(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---------- 生成蒙版 ----------
// 返回一张透明画布：不透明的地方 = 显示 A，透明的地方 = 显示 B
function buildMask(W, H, s) {
  const cell = +$('cell').value;
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const algo = $('algo').value, shape = $('shape').value;
  const thr = +$('thr').value, inv = $('inv').checked;

  // 1) C 缩小到“一格 = 一像素”，读出每格亮度
  let g = null;
  if (algo !== 'checker') {
    const sm = document.createElement('canvas');
    sm.width = cols; sm.height = rows;
    const c = sm.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#fff';
    c.fillRect(0, 0, cols, rows);
    if (layers.C.img) {
      c.filter = `blur(${$('cblur').value / cell}px)`;
      drawLayer(c, layers.C, W, H, 1 / cell);
    }
    const d = c.getImageData(0, 0, cols, rows).data;
    g = new Float32Array(cols * rows);
    for (let i = 0; i < g.length; i++) {
      g[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    }
  }

  // 2) 在全分辨率画布上直接画格子 / 圆点（边缘锐利）
  const m = document.createElement('canvas');
  m.width = Math.round(W * s); m.height = Math.round(H * s);
  const c = m.getContext('2d');
  c.fillStyle = '#000';
  const cs = cell * s;
  const bm = BAYER[algo];

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = g ? g[j * cols + i] : 0;
      const shifted = v + (thr - 0.5);
      let on = false, cov = 1;
      if (algo === 'checker') on = (i + j) % 2 === 0;
      else if (algo === 'threshold') on = shifted > 0.5;
      else if (bm) on = shifted > bm[j % bm.length][i % bm.length];
      else if (algo === 'random') on = shifted > rnd(i, j);
      else if (algo === 'halftone') {
        cov = Math.min(1, Math.max(0, shifted));
        if (inv) cov = 1 - cov;
        on = cov > 0.01;
      }
      if (algo !== 'halftone' && inv) on = !on;
      if (!on) continue;

      const x = i * cs, y = j * cs;
      if (algo === 'halftone') {
        if (shape === 'circle') {
          c.beginPath();
          c.arc(x + cs / 2, y + cs / 2, Math.sqrt(cov) * 0.71 * cs, 0, Math.PI * 2);
          c.fill();
        } else {
          const side = Math.sqrt(cov) * cs;
          c.fillRect(x + (cs - side) / 2, y + (cs - side) / 2, side, side);
        }
      } else if (shape === 'circle') {
        c.beginPath();
        c.arc(x + cs / 2, y + cs / 2, cs / 2, 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillRect(x, y, cs + 0.5, cs + 0.5);
      }
    }
  }
  return m;
}

// ---------- 合成 ----------
function compose(s) {
  const W = +$('W').value, H = +$('H').value;
  const w = Math.round(W * s), h = Math.round(H * s);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const o = out.getContext('2d');
  const mask = buildMask(W, H, s);

  if ($('showMask').checked) {
    o.fillStyle = '#fff';
    o.fillRect(0, 0, w, h);
    o.drawImage(mask, 0, 0);
    return out;
  }

  // 底层：B（没导入时用深灰占位）
  if (layers.B.img) {
    o.fillStyle = '#fff'; o.fillRect(0, 0, w, h);
    drawLayer(o, layers.B, W, H, s);
  } else { o.fillStyle = '#2a2a2a'; o.fillRect(0, 0, w, h); }

  // 上层：A，用蒙版裁切后叠上去
  const t = document.createElement('canvas');
  t.width = w; t.height = h;
  const tc = t.getContext('2d');
  if (layers.A.img) {
    tc.fillStyle = '#fff'; tc.fillRect(0, 0, w, h);
    drawLayer(tc, layers.A, W, H, s);
  } else { tc.fillStyle = '#d4d0c4'; tc.fillRect(0, 0, w, h); }
  tc.globalCompositeOperation = 'destination-in';
  const soft = +$('soft').value * s;
  if (soft > 0) tc.filter = `blur(${soft}px)`;
  tc.drawImage(mask, 0, 0);
  o.drawImage(t, 0, 0);
  return out;
}

// ---------- 预览 ----------
let pending = false;
function queueRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}
function render() {
  const W = +$('W').value, H = +$('H').value;
  if (!(W > 0 && H > 0)) return;
  cv.width = W; cv.height = H;
  ctx.drawImage(compose(1), 0, 0);
}

// ---------- 控件 ----------
document.querySelectorAll('aside input, aside select').forEach(el => {
  if (el.type === 'file' || el.name === 'layer') return;
  el.addEventListener('input', queueRender);
});
document.querySelectorAll('input[name=layer]').forEach(r => {
  r.addEventListener('change', () => {
    cur = r.value;
    $('scale').value = layers[cur].scale;
  });
});
$('scale').addEventListener('input', e => {
  layers[cur].scale = +e.target.value;
  queueRender();
});
$('resetPos').addEventListener('click', () => {
  Object.assign(layers[cur], { x: 0, y: 0, scale: 1 });
  $('scale').value = 1;
  queueRender();
});

// ---------- 拖动当前图层 ----------
let drag = null;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY };
});
cv.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = cv.getBoundingClientRect();
  layers[cur].x += (e.clientX - drag.x) * cv.width / r.width;
  layers[cur].y += (e.clientY - drag.y) * cv.height / r.height;
  drag = { x: e.clientX, y: e.clientY };
  queueRender();
});
['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, () => { drag = null; }));

// ---------- 导出 ----------
$('save').addEventListener('click', () => {
  const s = +$('exp').value;
  const W = +$('W').value * s, H = +$('H').value * s;
  if (Math.max(W, H) > 16000) {
    alert(`导出尺寸 ${W}×${H} 超出浏览器上限，请降低倍率或画布大小。`);
    return;
  }
  compose(s).toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `weave-${W}x${H}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
});

render();