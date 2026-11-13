// ===================== Weave Machine =====================
const $ = id => document.getElementById(id);
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const cv = $('cv'), ctx = cv.getContext('2d');
const mod = (n, m) => ((n % m) + m) % m;
const T = 2 * Math.PI;
const BUILD = 'build 11-07-g';
$('ver').textContent = BUILD;
$('ui').reset();   // 浏览器刷新 / Live Server 重载时会“记住”上次的选项，这里强制回到默认值，保证界面和程序状态一致
window.addEventListener('error', e => {   // 出错时在左上角显示红色提示，不用开控制台
  const b = $('errBox'); b.hidden = false; b.textContent = (b.dataset.missing ? b.dataset.missing + '  |  ' : '') + '⚠ ' + e.message + ' (' + (e.filename || '').split('/').pop() + ':' + e.lineno + ')';
});

// ---------- 状态 ----------
const DEF_ADJ = () => ({ bright: 0, contrast: 1, sat: 1, black: 0, white: 1, gamma: 1, post: 0,
  gray: false, duo: false, d1: '#1b2a1f', d2: '#e8e2c8', curve: [[0, 0], [1, 1]] });   // 每个图层各自的图像调整
const layers = {
  A: { img: null, proc: null, adj: DEF_ADJ(), scale: 1, x: 0, y: 0, mode: 'image', c1: '#d94a3d', c2: '#f2c14e', angle: 90 },
  B: { img: null, proc: null, adj: DEF_ADJ(), scale: 1, x: 0, y: 0, mode: 'image', c1: '#2438c8', c2: '#9fd3ff', angle: 90 },
  C: { img: null, proc: null, adj: DEF_ADJ(), scale: 1, x: 0, y: 0 },
  D: { img: null, proc: null, adj: DEF_ADJ(), scale: 1, x: 0, y: 0, mode: 'none', c1: '#f4f1ea', c2: '#cfd8dc', angle: 90 },   // 背景底图
};
let cur = 'A', tool = 'none', pending = false, MODE = 'grid';   // MODE: 'grid' 格子蒙版 | 'hand' 手工编织（见 handweave.js）
let poly = [], polyHover = null, drag = null, tileRepeat = true;
// ---- 画布尺寸：手工编织里，“延伸出去的一段”可以让画布自动变大 ----
// 面板里的 宽 / 高 是“编织主体”的大小；开启“画布跟着延伸变大”后，实际画布 = 主体 + 各个方向延伸出去的长度。
function handGrow() {
  const z = { L: 0, T: 0, R: 0, B: 0 };
  if (MODE !== 'hand' || !$('hwGrow').checked) return z;
  const Wb = +$('W').value, Hb = +$('H').value, strips = $('hwKind').value === 'strips', dir = $('hwStripDir').value;
  const sv = $('hwExtVSide').value, sh = $('hwExtHSide').value;
  const lv = +$('hwExtVLen').value / 100 * Hb, lh = +$('hwExtHLen').value / 100 * Wb;     // 延伸长度是主体尺寸的百分比
  if (!(strips && dir === 'h')) { if (sv === 'start' || sv === 'both') z.T = lv; if (sv === 'end' || sv === 'both') z.B = lv; }
  if (!(strips && dir === 'v')) { if (sh === 'start' || sh === 'both') z.L = lh; if (sh === 'end' || sh === 'both') z.R = lh; }
  return z;
}
const CW = () => { const g = handGrow(); return Math.round(+$('W').value + g.L + g.R); };   // 实际画布宽
const CH = () => { const g = handGrow(); return Math.round(+$('H').value + g.T + g.B); };   // 实际画布高
function handRect() {                                // 编织区域（主体减去边距），在实际画布里的位置
  const g = handGrow(), Wb = +$('W').value, Hb = +$('H').value, m = +$('hwMargin').value / 100 * Math.min(Wb, Hb);
  return { x0: g.L + m, y0: g.T + m, x1: Wb + g.L - m, y1: Hb + g.T - m, m };
}

let GEO = 'off';                       // 几何：'off' | 'warp' | 'shuffle'（格子模式）
let shEdits = [], shSel = null;        // 手动打乱的修改列表 / 当前选中的目标（见 shuffle.js）
let hwPull = { v: {}, h: {} };
let hwColors = { v: {}, h: {} };       // 手动换的条颜色（覆盖在“平均色 / 调色板”之上）         // 手工编织里被抽拉的条：{ v: {序号: px}, h: {序号: px} }
const updSrcFns = {};
const NO_C = ['checker', 'pat2', 'patV', 'patH', 'patD', 'patHerring', 'patDiamond', 'patBars', 'patCustom'];

// ---------- 导入 ----------
document.querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => $(b.dataset.for).click()));
['A', 'B', 'C', 'D'].forEach(k => {
  $('file' + k).addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    $('name' + k).textContent = f.name;
    const im = new Image();
    im.onload = () => {
      layers[k].img = im; layers[k].file = f;
      if (typeof adjustLayer === 'function') adjustLayer(k);
      if (k === 'C' && NO_C.includes($('algo').value)) { $('algo').value = 'threshold'; showAlgoUI(); }
      queueRender();
      pushHistory('Import ' + k);
      if (typeof sessionSaveImage === 'function') sessionSaveImage(k, f);
    };
    im.src = URL.createObjectURL(f);
  });
});

// A / B 的来源：图片 / 纯色 / 渐变
document.querySelectorAll('.src').forEach(sel => {
  const k = sel.dataset.k;
  const upd = () => {
    const L = layers[k];
    L.mode = sel.value;
    $('pick' + k).hidden = L.mode !== 'image';
    $('col' + k).hidden = !(L.mode === 'solid' || L.mode === 'linear' || L.mode === 'radial');
    $('c2' + k).hidden = !(L.mode === 'linear' || L.mode === 'radial');
    $('angRow' + k).hidden = L.mode !== 'linear';
    queueRender();
  };
  updSrcFns[k] = upd;
  sel.addEventListener('change', upd);
  ['c1', 'c2'].forEach(n => $(n + k).addEventListener('input', e => { layers[k][n] = e.target.value; queueRender(); }));
  $('ang' + k).addEventListener('input', e => { layers[k].angle = +e.target.value; queueRender(); });
  upd();
});

// ---------- 图层绘制 ----------
// k = 输出相对画布的倍率
function drawLayer(c, L, W, H, k) {
  const im = L.proc || L.img;           // proc = 经过“图像调整”处理后的版本
  const fit = Math.max(W / im.width, H / im.height);
  const w = im.width * fit * L.scale * k, h = im.height * fit * L.scale * k;
  c.drawImage(im, W * k / 2 + L.x * k - w / 2, H * k / 2 + L.y * k - h / 2, w, h);
}
function paintSource(c, key, W, H, s) {
  const L = layers[key], w = W * s, h = H * s;
  if (L.mode === 'none') return;                      // 透明：什么都不画
  if (L.mode === 'image') {
    if (L.img) { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); drawLayer(c, L, W, H, s); }
    else if (key !== 'D') { c.fillStyle = key === 'A' ? '#d4d0c4' : '#2a2a2a'; c.fillRect(0, 0, w, h); }   // 还没导入图片时的占位色
    return;
  }
  if (L.mode === 'solid') { c.fillStyle = L.c1; c.fillRect(0, 0, w, h); return; }
  let g;
  if (L.mode === 'linear') {
    const a = L.angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    const r = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    g = c.createLinearGradient(w / 2 - dx * r, h / 2 - dy * r, w / 2 + dx * r, h / 2 + dy * r);
  } else g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
  g.addColorStop(0, L.c1); g.addColorStop(1, L.c2);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}

// ---------- 抖动 / 图案 ----------
function bayer(n) {
  let m = [[0, 2], [3, 1]];
  while (m.length < n) {
    const s = m.length, r = [];
    for (let y = 0; y < s * 2; y++) { r[y] = []; for (let x = 0; x < s * 2; x++)
      r[y][x] = m[y % s][x % s] * 4 + [[0, 2], [3, 1]][Math.floor(y / s)][Math.floor(x / s)]; }
    m = r;
  }
  return m.map(r => r.map(v => (v + 0.5) / (n * n)));
}
const CLUSTERED = [[12,5,6,13],[4,0,1,7],[11,3,2,8],[15,10,9,14]].map(r => r.map(v => (v + 0.5) / 16));
const BAYER = { bayer2: bayer(2), bayer4: bayer(4), bayer8: bayer(8), clustered: CLUSTERED };
const DIFFUSE = {
  floyd:    { d: 16, k: [[1,0,7],[-1,1,3],[0,1,5],[1,1,1]] },
  atkinson: { d: 8,  k: [[1,0,1],[2,0,1],[-1,1,1],[0,1,1],[1,1,1],[0,2,1]] },
  jarvis:   { d: 48, k: [[1,0,7],[2,0,5],[-2,1,3],[-1,1,5],[0,1,7],[1,1,5],[2,1,3],[-2,2,1],[-1,2,3],[0,2,5],[1,2,3],[2,2,1]] },
  stucki:   { d: 42, k: [[1,0,8],[2,0,4],[-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2],[-2,2,1],[-1,2,2],[0,2,4],[1,2,2],[2,2,1]] },
};
function diffuse(g, cols, rows, conf, shift) {
  const v = Float32Array.from(g, x => x + shift), out = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const idx = j * cols + i, old = v[idx], nw = old > 0.5 ? 1 : 0;
    out[idx] = nw;
    const err = old - nw;
    for (const [dx, dy, w] of conf.k) {
      const x = i + dx, y = j + dy;
      if (x >= 0 && x < cols && y < rows) v[y * cols + x] += err * w / conf.d;
    }
  }
  return out;
}
function rnd(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// 以中心格为 (0,0) 的图案函数
let tile = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (x + y) % 2 === 0 ? 1 : 0));
const PATTERNS = {
  checker:    (i, j) => mod(i + j, 2) === 0,
  pat2:       (i, j) => mod(Math.floor(i / 2) + Math.floor(j / 2), 2) === 0,
  patV:       (i)    => mod(i, 2) === 0,
  patH:       (i, j) => mod(j, 2) === 0,
  patD:       (i, j) => mod(i + j, 4) < 2,
  patHerring: (i, j) => mod(i + Math.abs(mod(j, 8) - 4), 4) < 2,
  patDiamond: (i, j) => mod(Math.abs(mod(i, 16) - 8) + Math.abs(mod(j, 16) - 8), 4) < 2,
  patBars:    (i, j) => mod(i + Math.floor((j + 3) / 6), 2) === 0,   // 1 宽 × 6 高的长条棋盘
  patCustom:  (i, j) => {
    const tw = tile[0].length, th = tile.length;
    if (tileRepeat) return tile[mod(j, th)][mod(i, tw)] === 1;
    const x = i + Math.floor(tw / 2), y = j + Math.floor(th / 2);   // 单个图案，居中
    return x >= 0 && x < tw && y >= 0 && y < th && tile[y][x] === 1;
  },
};

// ---------- 变形：列宽 / 行高变化 + 波浪 ----------
function makeWarp() {
  const on = GEO === 'warp';                // 只有在“几何”里选了“变形”才生效
  const a = on ? +$('wColW').value : 0, b = on ? +$('wRowH').value : 0, P = +$('wPeriod').value;
  const wx = on ? +$('wWx').value : 0, wy = on ? +$('wWy').value : 0, L = +$('wLen').value;
  const f = (u, k) => u + k * P / T * Math.sin(T * u / P);   // 导数 = 1 + k·cos，所以宽度在中心最大
  return {
    active: a > 0 || b > 0 || wx > 0 || wy > 0,
    extX: a * P / T + wx, extY: b * P / T + wy, par: { a, b, P, wx, wy, L },
    pt: (u, v) => [f(u, a) + wx * Math.sin(T * v / L), f(v, b) + wy * Math.sin(T * u / L)],
  };
}

// 变形 + 很多格子：对每个输出像素反向求出它落在“未变形网格”的哪个位置，再查表。
// 先在稀疏的点阵上用牛顿法精确求解，再双线性插值；每个像素做 2×2（导出时 3×3）超采样来抗锯齿。
function warpRaster(m, g) {
  const { W, H, s, cell, dx, dy, cols, rows, hx, hy, cells, circle } = g;
  const { a, b, P, wx, wy, L } = g.wp.par;
  const w = m.width, h = m.height;
  // 点阵间距：保证最短的波长内至少有 ~8 个点，波长很长 / 格子很小时就稀一点（更快）
  const S = Math.min(8, Math.max(1, Math.floor(Math.min(P, L) * cell * s / 8)));
  const nx = Math.ceil(w / S) + 2, ny = Math.ceil(h / S) + 2;
  const U = new Float32Array(nx * ny), V = new Float32Array(nx * ny);
  const kP = T / P, kL = T / L;
  for (let gy = 0; gy < ny; gy++) {
    const Y = (gy * S / s - H / 2 - dy) / cell;
    for (let gx = 0; gx < nx; gx++) {
      const X = (gx * S / s - W / 2 - dx) / cell;
      let u = X, v = Y;
      for (let it = 0; it < 4; it++) {
        const fx = u + a / kP * Math.sin(kP * u) + wx * Math.sin(kL * v) - X;
        const fy = v + b / kP * Math.sin(kP * v) + wy * Math.sin(kL * u) - Y;
        const j11 = 1 + a * Math.cos(kP * u), j12 = wx * kL * Math.cos(kL * v);
        const j21 = wy * kL * Math.cos(kL * u), j22 = 1 + b * Math.cos(kP * v);
        const det = j11 * j22 - j12 * j21;
        if (Math.abs(det) < 1e-3) break;
        u -= (fx * j22 - fy * j12) / det; v -= (j11 * fy - j21 * fx) / det;
      }
      U[gy * nx + gx] = u; V[gy * nx + gx] = v;
    }
  }
  const id = new ImageData(w, h), d = id.data;
  const ss = cell * s < 10 ? 1 : (s > 1 ? 3 : 2), n2 = ss * ss, offs = [];
  for (let k = 0; k < ss; k++) offs.push((k + 0.5) / ss - 0.5);
  for (let py = 0; py < h; py++) {
    const fy = (py + 0.5) / S, gy = Math.floor(fy), ty = fy - gy;
    for (let px = 0; px < w; px++) {
      const fx = (px + 0.5) / S, gx = Math.floor(fx), tx = fx - gx, i0 = gy * nx + gx, i1 = i0 + nx;
      const u00 = U[i0], u10 = U[i0 + 1], u01 = U[i1], u11 = U[i1 + 1];
      const v00 = V[i0], v10 = V[i0 + 1], v01 = V[i1], v11 = V[i1 + 1];
      const u = (u00 * (1 - tx) + u10 * tx) * (1 - ty) + (u01 * (1 - tx) + u11 * tx) * ty;
      const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      let cnt = 0;
      if (ss === 1) {
        const ci = Math.round(u), cj = Math.round(v), i = ci + hx, j = cj + hy;
        if (i >= 0 && j >= 0 && i < cols && j < rows && cells[j * cols + i]) {
          if (!circle) cnt = 1; else { const du = u - ci, dv = v - cj; if (du * du + dv * dv <= 0.25) cnt = 1; }
        }
      } else {
        // 像素内的局部变化率（用于超采样，不用再对每个子样本做插值）
        const dudx = ((u10 - u00) * (1 - ty) + (u11 - u01) * ty) / S, dudy = ((u01 - u00) * (1 - tx) + (u11 - u10) * tx) / S;
        const dvdx = ((v10 - v00) * (1 - ty) + (v11 - v01) * ty) / S, dvdy = ((v01 - v00) * (1 - tx) + (v11 - v10) * tx) / S;
        for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
          const uu = u + offs[sx] * dudx + offs[sy] * dudy, vv = v + offs[sx] * dvdx + offs[sy] * dvdy;
          const ci = Math.round(uu), cj = Math.round(vv), i = ci + hx, j = cj + hy;
          if (i < 0 || j < 0 || i >= cols || j >= rows || !cells[j * cols + i]) continue;
          if (circle) { const du = uu - ci, dv = vv - cj; if (du * du + dv * dv > 0.25) continue; }
          cnt++;
        }
      }
      d[(py * w + px) * 4 + 3] = cnt === n2 ? 255 : Math.round(255 * cnt / n2);
    }
  }
  m.getContext('2d').putImageData(id, 0, 0);
}

// 预设图案：C 图层的位置 = 图案偏移，C 的缩放 = 格子缩放
function gridInfo(algo = $('algo').value) {
  const p = NO_C.includes(algo);
  const cell = +$('cell').value * (p ? layers.C.scale : 1);
  return { cell, dx: p ? layers.C.x : 0, dy: p ? layers.C.y : 0 };
}

// ---------- 生成蒙版 ----------
// 返回透明画布：不透明 = 显示 A，透明 = 显示 B。格子以画布中心为锚点。
function buildMask(W, H, s) {
  const algo = $('algo').value, shape = $('shape').value;
  const { cell, dx, dy } = gridInfo(algo);
  const thr = +$('thr').value, inv = $('inv').checked, shift = thr - 0.5;
  const wp = makeWarp();
  const hx = Math.ceil(W / (2 * cell) + wp.extX + Math.abs(dx) / cell) + 1, hy = Math.ceil(H / (2 * cell) + wp.extY + Math.abs(dy) / cell) + 1;
  const cols = 2 * hx + 1, rows = 2 * hy + 1;
  const ox = W / 2 - (hx + 0.5) * cell, oy = H / 2 - (hy + 0.5) * cell;

  // 1) C → 每格一个亮度值
  let g = null;
  if (!NO_C.includes(algo)) {
    const sm = document.createElement('canvas');
    sm.width = cols; sm.height = rows;
    const c = sm.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#fff'; c.fillRect(0, 0, cols, rows);
    if (layers.C.img) {
      c.filter = `blur(${$('cblur').value / cell}px)`;
      c.translate(-ox / cell, -oy / cell);
      drawLayer(c, layers.C, W, H, 1 / cell);
    }
    const d = c.getImageData(0, 0, cols, rows).data;
    g = new Float32Array(cols * rows);
    for (let i = 0; i < g.length; i++) g[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  }
  const ed = DIFFUSE[algo] ? diffuse(g, cols, rows, DIFFUSE[algo], shift) : null;
  const bm = BAYER[algo], pat = PATTERNS[algo];

  // 2) 把所有“开”的格子合成一个路径（相邻格子之间没有缝）
  const fast = !wp.active;                                  // 无变形：快速路径（最近邻放大）
  const raster = wp.active && cols * rows > 3000;           // 有变形且格子很多：逐像素反向映射
  const useCells = fast || raster;
  const cells = useCells ? new Uint8Array(cols * rows) : null;
  const path = new Path2D(), n = wp.active ? 4 : 1;
  const P = (u, v) => { const [x, y] = wp.pt(u, v); return [W / 2 + dx + cell * x, H / 2 + dy + cell * y]; };
  const addPoly = pts => { pts.forEach(([x, y], k) => k ? path.lineTo(x, y) : path.moveTo(x, y)); path.closePath(); };
  const rect = (u0, v0, u1, v1) => {
    const p = [];
    for (let t = 0; t < n; t++) p.push(P(u0 + (u1 - u0) * t / n, v0));
    for (let t = 0; t < n; t++) p.push(P(u1, v0 + (v1 - v0) * t / n));
    for (let t = 0; t < n; t++) p.push(P(u1 - (u1 - u0) * t / n, v1));
    for (let t = 0; t < n; t++) p.push(P(u0, v1 - (v1 - v0) * t / n));
    addPoly(p);
  };
  const circ = (u, v, r) => {
    const p = [];
    for (let t = 0; t < 20; t++) p.push(P(u + r * Math.cos(T * t / 20), v + r * Math.sin(T * t / 20)));
    addPoly(p);
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const ci = i - hx, cj = j - hy, idx = j * cols + i;
      const sh = (g ? g[idx] : 0) + shift;
      let on = false;
      if (pat) on = pat(ci, cj);
      else if (algo === 'threshold') on = sh > 0.5;
      else if (ed) on = ed[idx] === 1;
      else if (bm) on = sh > bm[mod(cj, bm.length)][mod(ci, bm.length)];
      else if (algo === 'random') on = sh > rnd(ci, cj);
      if (inv) on = !on;
      if (!on) continue;
      if (useCells) { cells[idx] = 1; continue; }

      if (shape === 'circle') circ(ci, cj, 0.5);
      else rect(ci - 0.5, cj - 0.5, ci + 0.5, cj + 0.5);
    }
  }
  const m = document.createElement('canvas');
  m.width = Math.round(W * s); m.height = Math.round(H * s);
  const c = m.getContext('2d');
  if (fast) {
    // 每格一个像素的小图 → 最近邻放大到整张画布（边缘是锐利的方格）
    const sm = document.createElement('canvas');
    sm.width = cols; sm.height = rows;
    const sc = sm.getContext('2d'), id = sc.createImageData(cols, rows);
    for (let i = 0; i < cells.length; i++) if (cells[i]) id.data[i * 4 + 3] = 255;
    sc.putImageData(id, 0, 0);
    const X = (ox + dx) * s, Y = (oy + dy) * s, cs = cell * s;
    c.imageSmoothingEnabled = false;
    c.drawImage(sm, X, Y, cols * cs, rows * cs);
    if (shape === 'circle') {                       // 圆点：再乘上一层“圆点图案”
      const D = Math.max(8, Math.round(cs * 2)), sp = document.createElement('canvas');
      sp.width = sp.height = D;
      const g = sp.getContext('2d');
      g.fillStyle = '#000'; g.beginPath(); g.arc(D / 2, D / 2, D / 2, 0, T); g.fill();
      const t = document.createElement('canvas');
      t.width = m.width; t.height = m.height;
      const tg = t.getContext('2d'), pat = tg.createPattern(sp, 'repeat');
      pat.setTransform(new DOMMatrix().translate(X, Y).scale(cs / D));
      tg.fillStyle = pat; tg.fillRect(0, 0, t.width, t.height);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(t, 0, 0);
    }
    return m;
  }
  if (raster) {
    warpRaster(m, { W, H, s, cell, dx, dy, wp, cols, rows, hx, hy, cells, circle: shape === 'circle' });
    return m;
  }
  c.setTransform(s, 0, 0, s, 0, 0);
  c.fillStyle = '#000';
  c.fill(path);
  return m;
}

// ---------- 蒙版区域：可编辑的形状对象 ----------
// shapes = [{ id, type: 'rect'|'ellipse'|'poly'|'brush', op: 'add'|'sub', ...几何 }]，按顺序叠加
let shapes = [], shapesVer = 0, selId = null, nextId = 1;
const r2 = v => Math.round(v * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));
function tracePath(c, sh) {
  c.beginPath();
  if (sh.type === 'rect') c.rect(sh.x, sh.y, sh.w, sh.h);
  else if (sh.type === 'ellipse') c.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, Math.max(0, sh.w / 2), Math.max(0, sh.h / 2), 0, 0, T);
  else if (sh.type === 'poly') sh.pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  else {
    sh.rects.forEach(r => c.rect(r[0], r[1], r[2], r[3]));
    sh.circs.forEach(q => { c.moveTo(q[0] + q[2], q[1]); c.arc(q[0], q[1], q[2], 0, T); });
  }
}
let regCache = { key: '', cv: null };
function regionCanvas(W, H, s) {                 // 把所有形状画成一张蒙版区域画布（可缓存）
  const key = `${shapesVer}|${W}|${H}|${s}`;
  if (regCache.key === key) return regCache.cv;
  const c = document.createElement('canvas');
  c.width = Math.round(W * s); c.height = Math.round(H * s);
  const g = c.getContext('2d');
  g.setTransform(s, 0, 0, s, 0, 0);
  g.fillStyle = '#000';
  if (shapes.length && shapes[0].op === 'sub') g.fillRect(0, 0, W, H);   // 第一个就是“擦除”：从整个画布里挖掉
  for (const sh of shapes) {
    g.globalCompositeOperation = sh.op === 'sub' ? 'destination-out' : 'source-over';
    tracePath(g, sh); g.fill();
  }
  regCache = { key, cv: c };
  return c;
}

// ---------- 合成 ----------
function compose(s) {
  return MODE === 'hand' ? composeHand(s) : composeGrid(s);
}
function composeGrid(s) {
  const W = CW(), H = CH();
  const w = Math.round(W * s), h = Math.round(H * s);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const o = out.getContext('2d');

  let mf = buildMask(W, H, s);
  // 区域限制：没有任何形状时不起作用（避免“勾了却整个蒙版消失”）
  if ($('limit').checked && shapes.length) {
    const rc = regionCanvas(W, H, s);
    const lim = document.createElement('canvas');
    lim.width = w; lim.height = h;
    const m = lim.getContext('2d');
    m.drawImage(mf, 0, 0);
    m.globalCompositeOperation = 'destination-in';
    m.drawImage(rc, 0, 0);
    if ($('outside').value === 'A') {            // 区域之外也显示 A
      const ri = document.createElement('canvas');
      ri.width = w; ri.height = h;
      const r = ri.getContext('2d');
      r.fillRect(0, 0, w, h);
      r.globalCompositeOperation = 'destination-out';
      r.drawImage(rc, 0, 0);
      m.globalCompositeOperation = 'source-over';
      m.drawImage(ri, 0, 0);
    }
    mf = lim;
  }

  if ($('showMask').checked) {
    o.fillStyle = '#fff'; o.fillRect(0, 0, w, h);
    o.drawImage(mf, 0, 0);
    return out;
  }
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  let srcA = mk(), srcB = mk();
  paintSource(srcA.getContext('2d'), 'A', W, H, s);
  paintSource(srcB.getContext('2d'), 'B', W, H, s);
  if (GEO === 'shuffle') { srcA = shuffleGrid(srcA, s, 'A'); srcB = shuffleGrid(srcB, s, 'B'); }   // 只打乱图像，蒙版不动

  // 蒙版先做一次柔化，再用同一张蒙版去“切 B、留 A”：A 的格子取代 B 的格子，边缘按比例混合
  const soft = +$('soft').value * s;
  let mm = mf;
  if (soft > 0) { mm = mk(); const mg = mm.getContext('2d'); mg.filter = `blur(${soft}px)`; mg.drawImage(mf, 0, 0); }
  const comp = mk(), cc = comp.getContext('2d');
  cc.drawImage(srcB, 0, 0);
  cc.globalCompositeOperation = 'destination-out'; cc.drawImage(mm, 0, 0);      // B 只留在蒙版之外
  const t = mk(), tc = t.getContext('2d');
  tc.drawImage(srcA, 0, 0);
  tc.globalCompositeOperation = 'destination-in'; tc.drawImage(mm, 0, 0);       // A 只留在蒙版之内
  cc.globalCompositeOperation = 'lighter'; cc.drawImage(t, 0, 0);                // 两者相加（预乘 alpha 下就是线性混合）
  cc.globalCompositeOperation = 'source-over';
  if ($('limit').checked && shapes.length && $('outside').value === 'D') {   // 区域之外：既不是 A 也不是 B，露出背景
    cc.globalCompositeOperation = 'destination-in';
    cc.drawImage(regionCanvas(W, H, s), 0, 0);
  }
  paintSource(o, 'D', W, H, s);                      // 背景底图垫在最下面
  o.drawImage(comp, 0, 0);
  return out;
}

// ---------- 预览 ----------
function queueRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}
function updateStatus() {
  const n = shapes.length, sub = shapes.filter(x => x.op === 'sub').length, on = $('limit').checked;
  const zh = typeof lang !== 'undefined' && lang === 'zh';
  let t;
  if (!n) t = zh ? '还没有形状：蒙版显示在整个画布上。' : 'No shapes yet: the mask covers the whole canvas.';
  else {
    t = zh ? `形状：${n} 个（${n - sub} 添加，${sub} 擦除）。` : `Shapes: ${n} (${n - sub} add, ${sub} subtract). `;
    t += on ? (zh ? ` 蒙版只显示在区域内，区域外显示 ${$('outside').value}。` : ` The mask only shows inside the region; outside shows ${$('outside').value}.`)
            : (zh ? ' ⚠ 「只在涂抹的区域内使用蒙版」没有勾选，形状暂时不起作用。' : ' ⚠ "Limit mask to the region" is off, so the shapes have no effect.');
  }
  $('regStatus').textContent = t;
}
function render() {
  updateStatus();
  if (typeof syncNums === 'function') syncNums();
  if (typeof syncColorFields === 'function') syncColorFields();
  const W = CW(), H = CH();
  const info = $('hwSizeInfo'); if (info) info.textContent = (typeof lang !== 'undefined' && lang === 'zh' ? '实际画布：' : 'Final canvas: ') + W + ' × ' + H + ' px';
  if (!(W > 0 && H > 0)) return;
  cv.width = W; cv.height = H;
  ctx.drawImage(compose(1), 0, 0);
  const k = cv.width / (cv.getBoundingClientRect().width || cv.width);   // 1 屏幕像素 = k 画布像素
  if (typeof updateSwatches === 'function') updateSwatches();
  if (MODE === 'hand' && typeof drawSelOutline === 'function') drawSelOutline(k);   // 选中的条（只在预览里显示）
  if (tool === 'none' || tool === 'recolor') return;
  // 以下只在预览中显示，不会导出
  if (tool === 'shuffle') { drawShuffleOverlay(k); return; }
  if (tool === 'pull') { drawPullOverlay(k); return; }
  const ov = document.createElement('canvas');
  ov.width = W; ov.height = H;
  const c = ov.getContext('2d');
  c.fillStyle = 'rgba(255,0,90,0.35)'; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(regionCanvas(W, H, 1), 0, 0);
  ctx.drawImage(ov, 0, 0);

  ctx.save();
  ctx.lineWidth = Math.max(1, 1.5 * k);
  for (const sh of shapes) {                   // 所有形状的轮廓（蓝色虚线 = 擦除形状）
    if (sh.type === 'brush') continue;
    tracePath(ctx, sh);
    ctx.strokeStyle = sh.op === 'sub' ? 'rgba(0,110,255,.95)' : 'rgba(0,0,0,.6)';
    ctx.setLineDash(sh.op === 'sub' ? [6 * k, 4 * k] : []);
    ctx.stroke();
  }
  const sel = shapes.find(x => x.id === selId);
  if (sel && tool === 'select') {              // 选中的形状：外框 + 控制点
    const b = bbox(sel);
    ctx.strokeStyle = '#2b3bd6'; ctx.lineWidth = Math.max(1.5, 2 * k); ctx.setLineDash([6 * k, 4 * k]);
    ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    ctx.setLineDash([]); ctx.fillStyle = '#fff';
    if (sel.type !== 'brush') handlePts(b).forEach(h => {
      ctx.fillRect(h.x - 4 * k, h.y - 4 * k, 8 * k, 8 * k);
      ctx.strokeRect(h.x - 4 * k, h.y - 4 * k, 8 * k, 8 * k);
    });
    if (sel.type === 'poly') sel.pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 5 * k, 0, T); ctx.fill(); ctx.stroke(); });
  }
  const outline = () => {
    ctx.setLineDash([]); ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 3]); ctx.strokeStyle = '#fff'; ctx.stroke();
  };
  ctx.lineWidth = Math.max(2, 2 * k);
  ctx.beginPath();
  if (drag && drag.mode === 'rect') {
    ctx.rect(drag.p0[0], drag.p0[1], drag.p1[0] - drag.p0[0], drag.p1[1] - drag.p0[1]); outline();
  } else if (drag && drag.mode === 'ellipse') {
    ctx.ellipse((drag.p0[0] + drag.p1[0]) / 2, (drag.p0[1] + drag.p1[1]) / 2,
      Math.abs(drag.p1[0] - drag.p0[0]) / 2, Math.abs(drag.p1[1] - drag.p0[1]) / 2, 0, 0, T); outline();
  } else if (tool === 'poly' && poly.length) {
    poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (polyHover) ctx.lineTo(polyHover[0], polyHover[1]);
    outline();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.setLineDash([]);
    poly.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, ctx.lineWidth * 2.5, 0, T); ctx.fill(); ctx.stroke(); });
  }
  ctx.restore();
}

// ---------- 控件 ----------
document.querySelectorAll('aside input, aside select').forEach(el => {
  if (el.type === 'file' || el.name === 'layer' || el.name === 'tool') return;
  el.addEventListener('input', queueRender);
});
document.querySelectorAll('input[name=layer]').forEach(r => r.addEventListener('change', () => {
  cur = r.value; $('scale').value = layers[cur].scale;
}));
function setTool(t) {
  tool = t; poly = []; polyHover = null; drag = null;
  if (typeof syncToolButtons === 'function') syncToolButtons();
  cv.style.cursor = t === 'none' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
  queueRender();
}
function exitTool() { setTool('none'); }
// 选中形状时，切换“添加 / 擦除”会直接改变这个形状
document.querySelectorAll('input[name=act]').forEach(r => r.addEventListener('change', () => {
  const sel = shapes.find(x => x.id === selId);
  if (tool === 'select' && sel && sel.op !== r.value) {
    sel.op = r.value; shapesVer++; queueRender(); pushHistory('Add / subtract');
  }
}));
$('scale').addEventListener('input', e => { layers[cur].scale = +e.target.value; queueRender(); });
$('resetPos').addEventListener('click', () => {
  Object.assign(layers[cur], { x: 0, y: 0, scale: 1 });
  $('scale').value = 1; queueRender(); pushHistory('Reset layer ' + cur);
});
$('regClear').addEventListener('click', () => {
  shapes = []; selId = null; shapesVer++; queueRender(); pushHistory('Clear region');
});
$('regFill').addEventListener('click', () => {
  addShape({ type: 'rect', x: 0, y: 0, w: CW(), h: CH(), op: 'add' });
  queueRender(); pushHistory('Fill region');
});
$('regDel').addEventListener('click', () => deleteSelected());
const WARP_PRESETS = {
  none:    [0, 0, 14, 0, 0, 16],
  squeeze: [0.6, 0.6, 14, 0, 0, 16],
  wave:    [0, 0, 14, 0.3, 0.9, 16],
  ripple:  [0.25, 0.25, 10, 0.5, 0.5, 12],
};
$('warpPreset').addEventListener('change', e => {
  const p = WARP_PRESETS[e.target.value];
  if (!p) return;
  ['wColW', 'wRowH', 'wPeriod', 'wWx', 'wWy', 'wLen'].forEach((id, i) => $(id).value = p[i]);
  queueRender();
});
['wColW', 'wRowH', 'wPeriod', 'wWx', 'wWy', 'wLen'].forEach(id =>
  $(id).addEventListener('input', () => { $('warpPreset').value = ''; }));

// ---------- 画布上操作：移动图层 / 画形状 / 选择并编辑形状 ----------
const toCanvas = e => {
  const r = cv.getBoundingClientRect();
  return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height];
};
const dpx = () => cv.width / (cv.getBoundingClientRect().width || cv.width);
const snapOn = () => MODE === 'grid' && $('snap').checked;
const actVal = () => document.querySelector('input[name=act]:checked').value;
const snapEdge = (v, base, cell) => base + (Math.round((v - base) / cell - 0.5) + 0.5) * cell;   // 吸附到格子边缘
function snapPt(p) {
  if (!snapOn()) return p;
  const { cell, dx, dy } = gridInfo();
  return [snapEdge(p[0], cv.width / 2 + dx, cell), snapEdge(p[1], cv.height / 2 + dy, cell)];
}

function bbox(sh) {
  if (sh.type === 'rect' || sh.type === 'ellipse') return [sh.x, sh.y, sh.x + sh.w, sh.y + sh.h];
  const xs = [], ys = [];
  if (sh.type === 'poly') sh.pts.forEach(([x, y]) => { xs.push(x); ys.push(y); });
  else {
    sh.rects.forEach(r => { xs.push(r[0], r[0] + r[2]); ys.push(r[1], r[1] + r[3]); });
    sh.circs.forEach(q => { xs.push(q[0] - q[2], q[0] + q[2]); ys.push(q[1] - q[2], q[1] + q[2]); });
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function translateShape(sh, dx, dy) {
  if (sh.type === 'rect' || sh.type === 'ellipse') { sh.x += dx; sh.y += dy; }
  else if (sh.type === 'poly') sh.pts.forEach(p => { p[0] += dx; p[1] += dy; });
  else { sh.rects.forEach(r => { r[0] += dx; r[1] += dy; }); sh.circs.forEach(q => { q[0] += dx; q[1] += dy; }); }
}
function hitShape(sh, x, y) {
  if (sh.type === 'rect') return x >= sh.x && x <= sh.x + sh.w && y >= sh.y && y <= sh.y + sh.h;
  if (sh.type === 'ellipse') {
    const rx = sh.w / 2, ry = sh.h / 2;
    if (!rx || !ry) return false;
    const u = (x - sh.x - rx) / rx, v = (y - sh.y - ry) / ry;
    return u * u + v * v <= 1;
  }
  if (sh.type === 'poly') {                    // 射线法
    let inside = false;
    for (let i = 0, j = sh.pts.length - 1; i < sh.pts.length; j = i++) {
      const [xi, yi] = sh.pts[i], [xj, yj] = sh.pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  return sh.rects.some(r => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) ||
         sh.circs.some(q => Math.hypot(x - q[0], y - q[1]) <= q[2]);
}
const hitTop = (x, y) => { for (let i = shapes.length - 1; i >= 0; i--) if (hitShape(shapes[i], x, y)) return shapes[i]; return null; };
const HANDLES = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]];
const handlePts = b => HANDLES.map(([n, fx, fy]) => ({ n, fx, fy, x: b[0] + (b[2] - b[0]) * fx, y: b[1] + (b[3] - b[1]) * fy }));

function addShape(sh) {
  sh.id = nextId++;
  sh.op = sh.op || actVal();
  shapes.push(sh); selId = sh.id; shapesVer++;
  $('limit').checked = true;                              // 画出新形状时，自动启用“只在区域内使用蒙版”
}
function removeShape(id) {
  shapes = shapes.filter(x => x.id !== id);
  if (selId === id) selId = null;
  shapesVer++;
}
function deleteSelected() {
  if (selId === null) return;
  removeShape(selId); queueRender(); pushHistory('Delete shape');
}
function resizeShape(sh, orig, hd, p, keep) {
  const ob = bbox(orig), nb = ob.slice();
  if (hd.fx === 0) nb[0] = p[0];
  if (hd.fx === 1) nb[2] = p[0];
  if (hd.fy === 0) nb[1] = p[1];
  if (hd.fy === 1) nb[3] = p[1];
  if (keep && hd.fx !== .5 && hd.fy !== .5) {   // Shift + 角点：等比例
    const ow = ob[2] - ob[0] || 1, oh = ob[3] - ob[1] || 1;
    const ax = hd.fx === 0 ? ob[2] : ob[0], ay = hd.fy === 0 ? ob[3] : ob[1];
    const k = Math.max(Math.abs(p[0] - ax) / ow, Math.abs(p[1] - ay) / oh);
    nb[hd.fx === 0 ? 0 : 2] = ax + (hd.fx === 0 ? -1 : 1) * ow * k;
    nb[hd.fy === 0 ? 1 : 3] = ay + (hd.fy === 0 ? -1 : 1) * oh * k;
  }
  if (sh.type === 'poly') {
    const ow = ob[2] - ob[0] || 1, oh = ob[3] - ob[1] || 1;
    sh.pts = orig.pts.map(([x, y]) => [nb[0] + (x - ob[0]) / ow * (nb[2] - nb[0]), nb[1] + (y - ob[1]) / oh * (nb[3] - nb[1])]);
  } else {
    sh.x = Math.min(nb[0], nb[2]); sh.y = Math.min(nb[1], nb[3]);
    sh.w = Math.abs(nb[2] - nb[0]); sh.h = Math.abs(nb[3] - nb[1]);
  }
}

function stamp(p) {            // 画笔：圆形，或与格子对齐的方形像素笔（一笔 = 一个形状）
  const sh = drag.sh, size = +$('brush').value;
  if (!snapOn()) { sh.circs.push([r2(p[0]), r2(p[1]), size / 2]); shapesVer++; return; }
  const { cell, dx, dy } = gridInfo(), n = Math.max(1, Math.round(size / cell));
  const bx = cv.width / 2 + dx, by = cv.height / 2 + dy;
  const cx = n % 2 ? bx + Math.round((p[0] - bx) / cell) * cell : snapEdge(p[0], bx, cell);
  const cy = n % 2 ? by + Math.round((p[1] - by) / cell) * cell : snapEdge(p[1], by, cell);
  const key = cx + '|' + cy + '|' + n;
  if (drag.keys.has(key)) return;
  drag.keys.add(key);
  sh.rects.push([r2(cx - n * cell / 2), r2(cy - n * cell / 2), r2(n * cell), r2(n * cell)]);
  shapesVer++;
}
function strokeTo(p) {
  const l = drag.last, d = Math.hypot(p[0] - l[0], p[1] - l[1]);
  const step = snapOn() ? gridInfo().cell / 2 : Math.max(2, +$('brush').value / 4);
  const k = Math.max(1, Math.ceil(d / step));
  for (let i = 1; i <= k; i++) stamp([l[0] + (p[0] - l[0]) * i / k, l[1] + (p[1] - l[1]) * i / k]);
  drag.last = p;
}
function commitPoly() {
  if (poly.length >= 3) { addShape({ type: 'poly', pts: poly.map(q => [r2(q[0]), r2(q[1])]) }); pushHistory('Polygon'); }
  poly = []; polyHover = null; queueRender();
}
function startSelect(p) {
  const tol = 9 * dpx(), sel = shapes.find(x => x.id === selId);
  if (sel) {
    if (sel.type === 'poly') {
      const vi = sel.pts.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < tol);
      if (vi >= 0) { drag = { mode: 'vertex', sh: sel, vi }; return; }
    }
    if (sel.type !== 'brush') {
      const hd = handlePts(bbox(sel)).find(h => Math.abs(h.x - p[0]) < tol && Math.abs(h.y - p[1]) < tol);
      if (hd) { drag = { mode: 'resize', sh: sel, hd, orig: clone(sel) }; return; }
    }
  }
  const hit = hitTop(p[0], p[1]);
  selId = hit ? hit.id : null;
  if (hit) {
    drag = { mode: 'move', sh: hit, start: p, ob: bbox(hit), orig: clone(hit) };
    const r = document.querySelector(`input[name=act][value=${hit.op}]`);   // 让“添加 / 擦除”显示所选形状的状态
    if (r) r.checked = true;
  }
}

cv.addEventListener('pointerdown', e => {
  const p = toCanvas(e);
  if (tool === 'shuffle') { cv.setPointerCapture(e.pointerId); shDown(p); return; }
  if (tool === 'pull') { cv.setPointerCapture(e.pointerId); hwDown(p); return; }
  if (tool === 'recolor') { hwPick(p, e); return; }
  if (tool === 'poly') {
    const close = 12 * dpx();
    if (poly.length >= 3 && Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]) < close) commitPoly();
    else { poly.push(snapPt(p)); polyHover = snapPt(p); queueRender(); }
    return;
  }
  cv.setPointerCapture(e.pointerId);
  if (tool === 'none') { drag = { mode: 'layer', x: e.clientX, y: e.clientY }; return; }
  if (tool === 'select') { startSelect(p); queueRender(); return; }
  drag = { mode: tool, last: p, p0: snapPt(p), p1: snapPt(p) };
  if (tool === 'brush') {
    drag.sh = { type: 'brush', rects: [], circs: [] }; drag.keys = new Set();
    addShape(drag.sh); stamp(p);
  }
  queueRender();
});
cv.addEventListener('pointermove', e => {
  const p = toCanvas(e);
  if (tool === 'shuffle') { shMove(p); return; }
  if (tool === 'pull') { hwMove(p); return; }
  if (tool === 'recolor') return;
  if (tool === 'poly') { if (poly.length) { polyHover = snapPt(p); queueRender(); } return; }
  if (!drag) return;
  if (drag.mode === 'layer') {
    const r = cv.getBoundingClientRect();
    layers[cur].x += (e.clientX - drag.x) * cv.width / r.width;
    layers[cur].y += (e.clientY - drag.y) * cv.height / r.height;
    drag.x = e.clientX; drag.y = e.clientY;
  } else if (drag.mode === 'brush') strokeTo(p);
  else if (drag.mode === 'rect' || drag.mode === 'ellipse') drag.p1 = snapPt(p);
  else if (drag.mode === 'move') {
    let dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    if (snapOn()) {                              // 让外框左上角吸附到格子边缘
      const g = gridInfo();
      dx = snapEdge(drag.ob[0] + dx, cv.width / 2 + g.dx, g.cell) - drag.ob[0];
      dy = snapEdge(drag.ob[1] + dy, cv.height / 2 + g.dy, g.cell) - drag.ob[1];
    }
    Object.assign(drag.sh, clone(drag.orig));
    translateShape(drag.sh, dx, dy); shapesVer++;
  } else if (drag.mode === 'resize') { resizeShape(drag.sh, drag.orig, drag.hd, snapPt(p), e.shiftKey); shapesVer++; }
  else if (drag.mode === 'vertex') { drag.sh.pts[drag.vi] = snapPt(p).slice(); shapesVer++; }
  queueRender();
});
cv.addEventListener('pointerup', e => {
  if (tool === 'shuffle') { shUp(toCanvas(e)); return; }
  if (tool === 'pull') { hwUp(); return; }
  if (tool === 'recolor') return;
  const d = drag;
  drag = null;
  if (d) {
    const sub = actVal() === 'sub' ? ' (subtract)' : '';
    if (d.mode === 'rect' || d.mode === 'ellipse') {
      const [a, b] = [d.p0, d.p1], w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      if (w > 2 && h > 2) {
        addShape({ type: d.mode, x: r2(Math.min(a[0], b[0])), y: r2(Math.min(a[1], b[1])), w: r2(w), h: r2(h) });
        pushHistory((d.mode === 'rect' ? 'Rectangle' : 'Ellipse') + sub);
      }
    } else if (d.mode === 'brush') {
      if (!d.sh.rects.length && !d.sh.circs.length) removeShape(d.sh.id); else pushHistory('Brush' + sub);
    } else if (d.mode === 'layer') pushHistory('Move ' + cur);
    else pushHistory({ move: 'Move shape', resize: 'Resize shape', vertex: 'Edit vertex' }[d.mode]);
  }
  queueRender();
});
cv.addEventListener('pointercancel', () => { drag = null; queueRender(); });
cv.addEventListener('dblclick', () => { if (tool === 'poly') { if (poly.length > 3) poly.pop(); commitPoly(); } });
window.addEventListener('keydown', e => {
  const typing = e.target.tagName === 'INPUT' && ['number', 'text'].includes(e.target.type);
  if (e.key === 'Enter' && poly.length) commitPoly();
  if (e.key === 'Escape') {
    if (poly.length) { poly = []; polyHover = null; queueRender(); }
    else if (tool !== 'none') exitTool();
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select' && !typing) { e.preventDefault(); deleteSelected(); }
  if ((e.ctrlKey || e.metaKey) && !typing) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); gotoHist(e.shiftKey ? hpos + 1 : hpos - 1); }
    if (k === 'y') { e.preventDefault(); gotoHist(hpos + 1); }
  }
});

// ---------- 自定义图案编辑器 ----------
const tc = $('tileCv');
function syncTile() {                 // 图案编辑器：格子模式选了“自定义”，或手工模式的织法选了“自定义”时显示
  const on = (MODE === 'grid' && $('algo').value === 'patCustom') || (MODE === 'hand' && $('hwKind').value === 'weave' && $('hwDraft').value === 'patCustom');
  $('g-tile').hidden = !on;
  if (on) drawTile();
}
function showAlgoUI() { syncTile(); }
function drawTile() {
  const tw = tile[0].length, th = tile.length, px = Math.floor(200 / Math.max(tw, th));
  tc.width = tw * px; tc.height = th * px;
  const c = tc.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, tc.width, tc.height);
  c.fillStyle = '#000';
  tile.forEach((row, y) => row.forEach((v, x) => { if (v) c.fillRect(x * px, y * px, px, px); }));
  c.strokeStyle = '#bbb'; c.lineWidth = 1;
  for (let x = 0; x <= tw; x++) { c.beginPath(); c.moveTo(x * px + .5, 0); c.lineTo(x * px + .5, tc.height); c.stroke(); }
  for (let y = 0; y <= th; y++) { c.beginPath(); c.moveTo(0, y * px + .5); c.lineTo(tc.width, y * px + .5); c.stroke(); }
}
function resizeTile() {
  const tw = Math.min(24, Math.max(2, +$('tileW').value || 8)), th = Math.min(24, Math.max(2, +$('tileH').value || 8));
  tile = Array.from({ length: th }, (_, y) => Array.from({ length: tw }, (_, x) => (tile[y] && tile[y][x]) || 0));
  drawTile(); queueRender();
}
let tileVal = null;
const tileCell = e => {
  const r = tc.getBoundingClientRect(), tw = tile[0].length, th = tile.length;
  return [Math.min(tw - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * tw))),
          Math.min(th - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * th)))];
};
tc.addEventListener('pointerdown', e => {
  tc.setPointerCapture(e.pointerId);
  const [x, y] = tileCell(e);
  tileVal = tile[y][x] ? 0 : 1; tile[y][x] = tileVal;
  drawTile(); queueRender();
});
tc.addEventListener('pointermove', e => {
  if (tileVal === null) return;
  const [x, y] = tileCell(e);
  if (tile[y][x] !== tileVal) { tile[y][x] = tileVal; drawTile(); queueRender(); }
});
['pointerup', 'pointercancel'].forEach(t => tc.addEventListener(t, () => { if (tileVal !== null) pushHistory('Edit tile'); tileVal = null; }));
$('tileW').addEventListener('change', resizeTile);
$('tileH').addEventListener('change', resizeTile);
$('tileClear').addEventListener('click', () => { tile = tile.map(r => r.map(() => 0)); drawTile(); queueRender(); pushHistory('Clear tile'); });
$('tileInv').addEventListener('click', () => { tile = tile.map(r => r.map(v => 1 - v)); drawTile(); queueRender(); pushHistory('Invert tile'); });
$('tileRepeat').addEventListener('change', e => { tileRepeat = e.target.checked; queueRender(); });
$('algo').addEventListener('change', () => {
  showAlgoUI();
  // 选了预设图案后，自动选中 C 图层，这样直接在画布上拖动就能移动图案
  if (NO_C.includes($('algo').value)) document.querySelector('input[name=layer][value=C]').click();
});

// ---------- 导出 ----------
const MSG = {
  en: 'Export size {w}×{h} exceeds the browser limit. Lower the scale or the canvas size.',
  zh: '导出尺寸 {w}×{h} 超出浏览器上限，请降低倍率或画布大小。',
};
$('save').addEventListener('click', () => {
  const s = +$('exp').value, W = CW() * s, H = CH() * s;
  if (Math.max(W, H) > 16000) { alert(MSG[lang].replace('{w}', W).replace('{h}', H)); return; }
  compose(s).toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `weave-${W}x${H}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
});

// ---------- 语言 / Language ----------
// 英文写在 HTML 里，中文写在 data-zh 属性里
let lang = 'en';
try { lang = localStorage.getItem('lang') || 'en'; } catch (e) {}
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-zh]').forEach(el => {
    if (!el.dataset.en) el.dataset.en = el.textContent;
    el.textContent = lang === 'zh' ? el.dataset.zh : el.dataset.en;
  });
  document.querySelectorAll('[data-zh-label]').forEach(el => {
    if (!el.dataset.enLabel) el.dataset.enLabel = el.label;
    el.label = lang === 'zh' ? el.dataset.zhLabel : el.dataset.enLabel;
  });
  $('lang').textContent = lang === 'zh' ? 'EN' : '中文';
}
$('lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'zh' : 'en';
  try { localStorage.setItem('lang', lang); } catch (e) {}
  applyLang();
  queueRender();   // 状态栏等动态文字也要换语言
});

// ---------- 历史记录：撤销 / 重做 ----------
const hist = [];
let hpos = -1, restoring = false;

let shapesStr = '[]', shapesStrVer = 0;           // 形状列表序列化后缓存，没改动时共用同一个字符串
function shapesJSON() {
  if (shapesStrVer !== shapesVer) { shapesStr = JSON.stringify(shapes); shapesStrVer = shapesVer; }
  return shapesStr;
}
function snapshot() {
  const inputs = {};
  document.querySelectorAll('aside input, aside select, aside textarea').forEach(el => {
    if (!el.id || el.type === 'file') return;
    inputs[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  ['mode', 'geo', 'slit', 'shtarget'].forEach(n => {            // 没有 id 的单选按钮组
    const r = document.querySelector(`input[name=${n}]:checked`);
    if (r) inputs['__' + n] = r.value;
  });
  const L = {};
  for (const k in layers) {
    const { x, y, scale, mode, c1, c2, angle, img, adj } = layers[k];
    L[k] = { x, y, scale, mode, c1, c2, angle, img, adj: JSON.stringify(adj) };
  }
  return { inputs, L, names: ['A', 'B', 'C', 'D'].map(k => $('name' + k).textContent),
           tile: tile.map(r => r.slice()), shapes: shapesJSON(),
           extra: JSON.stringify([shEdits, hwPull, hwColors]) };
}
const sigOf = s => JSON.stringify([s.inputs, Object.values(s.L).map(l => [l.x, l.y, l.scale, l.mode, l.c1, l.c2, l.angle, l.adj]), s.names, s.tile, s.extra]);

function pushHistory(label) {
  if (restoring) return;
  const s = snapshot();
  s.label = label || 'Change';
  s.sig = sigOf(s);
  const t = hist[hpos];
  if (t && t.sig === s.sig && t.shapes === s.shapes && ['A', 'B', 'C', 'D'].every(k => t.L[k].img === s.L[k].img)) return;
  hist.length = hpos + 1;                      // 撤销之后又有新操作：丢掉“重做”分支
  hist.push(s);
  while (hist.length > 100) hist.shift();
  hpos = hist.length - 1;
  renderHist();
  if (typeof sessionSave === 'function') sessionSave();
}
function restore(s) {
  restoring = true;
  for (const [id, v] of Object.entries(s.inputs)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
  }
  for (const k in s.L) {
    const { adj, ...rest } = s.L[k];
    Object.assign(layers[k], rest);
    layers[k].adj = JSON.parse(adj);
  }
  ['slit', 'shtarget'].forEach(n => {
    const r = document.querySelector(`input[name=${n}][value="${s.inputs['__' + n]}"]`);
    if (r) r.checked = true;
  });
  [shEdits, hwPull, hwColors] = JSON.parse(s.extra); shSel = null;
  hwColors = hwColors || { v: {}, h: {} };
  setMode(s.inputs.__mode || 'grid');
  setGeo(s.inputs.__geo || 'off');
  ['A', 'B', 'C', 'D'].forEach(k => adjustLayer(k));
  syncAdjUI();
  ['A', 'B', 'D'].forEach(k => { document.querySelector(`.src[data-k="${k}"]`).value = layers[k].mode; updSrcFns[k](); });
  ['A', 'B', 'C', 'D'].forEach((k, i) => { $('name' + k).textContent = s.names[i]; });
  tile = s.tile.map(r => r.slice());
  tileRepeat = $('tileRepeat').checked;
  $('scale').value = layers[cur].scale;
  shapes = JSON.parse(s.shapes); shapesVer++;
  nextId = Math.max(nextId, ...shapes.map(x => x.id + 1));
  if (!shapes.some(x => x.id === selId)) selId = null;
  poly = []; polyHover = null;
  showAlgoUI();
  restoring = false;
  queueRender();
}
function gotoHist(i) {
  if (i < 0 || i >= hist.length) return;
  hpos = i; restore(hist[i]); renderHist();
}
function renderHist() {
  $('undo').disabled = hpos <= 0;
  $('redo').disabled = hpos >= hist.length - 1;
  const ol = $('histList');
  ol.innerHTML = '';
  hist.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = s.label;
    li.className = i === hpos ? 'cur' : i > hpos ? 'future' : '';
    li.addEventListener('click', () => gotoHist(i));
    ol.appendChild(li);
  });
  const c = ol.querySelector('.cur');
  if (c) ol.scrollTop = Math.max(0, c.offsetTop - ol.clientHeight + c.offsetHeight + 4);   // 只滚动列表本身，不要用 scrollIntoView（它会带着整个页面一起滚）
}
$('undo').addEventListener('click', () => gotoHist(hpos - 1));
$('redo').addEventListener('click', () => gotoHist(hpos + 1));

// 控件改动（放在最后注册，保证在其他处理函数之后记录）
document.querySelectorAll('aside input, aside select').forEach(el => {
  if (!el.id || el.type === 'file') return;
  el.addEventListener('change', () => {
    const sp = el.closest('label') && el.closest('label').querySelector('span');
    pushHistory((sp && sp.textContent.trim()) || el.id);
  });
});
document.querySelectorAll('.src').forEach(sel =>
  sel.addEventListener('change', () => pushHistory('Source ' + sel.dataset.k)));

// （初始化在 main.js 里：等所有模块都加载完再执行）
