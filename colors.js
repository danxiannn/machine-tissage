// ===================== 颜色条：每根条一个纯色 =====================
// 颜色的来源：1) 这根条下面那块图像的平均色  2) 从图像提取的调色板  3) 手动换色（hwColors，覆盖在前两者之上）
// 依赖：$, T, layers, paintSource, mulberry32, hwGeom, hwColors, inPoly, queueRender, pushHistory

const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// 把来源图缩小成约 256 px 的小图，所有取色都在这张小图上做（又快又稳）
function sampleSource(key, W, H) {
  const s = 256 / Math.max(W, H), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * s)); c.height = Math.max(1, Math.round(H * s));
  paintSource(c.getContext('2d'), key, W, H, s);
  return { data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, s };
}

// 一根条对应的那一带图像的平均色：横跨方向 = 这根条的范围，沿条方向 = 编织区域
function bandAverage(src, st, vertical, rect) {
  const xs = st.pts.map(p => p[0]), ys = st.pts.map(p => p[1]);
  const a0 = vertical ? Math.min(...xs) + st.off[0] : Math.min(...ys) + st.off[1];
  const a1 = vertical ? Math.max(...xs) + st.off[0] : Math.max(...ys) + st.off[1];
  const [b0, b1] = vertical ? [rect.y0, rect.y1] : [rect.x0, rect.x1];
  const clampI = (v, max) => Math.max(0, Math.min(max, v));
  const [x0, x1, y0, y1] = vertical
    ? [a0 * src.s, a1 * src.s, b0 * src.s, b1 * src.s] : [b0 * src.s, b1 * src.s, a0 * src.s, a1 * src.s];
  const ix0 = clampI(Math.floor(x0), src.w - 1), ix1 = clampI(Math.max(Math.ceil(x1), ix0 + 1), src.w);
  const iy0 = clampI(Math.floor(y0), src.h - 1), iy1 = clampI(Math.max(Math.ceil(y1), iy0 + 1), src.h);
  let r = 0, g = 0, b = 0, a = 0;
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) {
    const i = (y * src.w + x) * 4, al = src.data[i + 3];
    r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al; a += al;
  }
  return a ? toHex(r / a, g / a, b / a) : '#cccccc';
}

// 从图像里提取 K 种主色（k-means）
function extractPalette(src, K) {
  const pts = [], step = Math.max(1, Math.floor(src.w * src.h / 4096));
  for (let p = 0; p < src.w * src.h; p += step) {
    const i = p * 4;
    if (src.data[i + 3] > 10) pts.push([src.data[i], src.data[i + 1], src.data[i + 2]]);
  }
  if (!pts.length) return ['#cccccc'];
  pts.sort((a, b) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) - (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]));
  K = Math.max(1, Math.min(K, pts.length));
  let centers = Array.from({ length: K }, (_, i) => pts[Math.floor((i + 0.5) / K * pts.length)].slice());
  for (let it = 0; it < 8; it++) {
    const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (const p of pts) {
      let best = 0, bd = Infinity;
      centers.forEach((c, i) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } });
      const s = sum[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    centers = centers.map((c, i) => sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c);
  }
  return centers.map(c => toHex(...c));
}
const getPalette = (key, K) => extractPalette(sampleSource(key, CW(), CH()), K);

// 给每根条定颜色：手动设置的 > 平均色 / 调色板
function assignFills(warp, weft, P, W, H, isA) {
  const sA = sampleSource('A', W, H), sB = sampleSource('B', W, H);
  const mine = parseHexList(P.palText);                              // 粘贴的颜色列表
  const useMine = P.fill === 'custom' && mine.length > 0;
  const palA = P.fill === 'palette' ? extractPalette(sA, P.palK) : useMine ? mine : null;
  const palB = P.fill === 'palette' ? extractPalette(sB, P.palK) : useMine ? mine : null;
  const mode = (P.fill === 'custom' && !useMine) ? 'avg' : (P.fill === 'custom' ? 'palette' : P.fill);   // 列表是空的就先用平均色
  const RC = mulberry32(P.seed + 99), colors = { v: [], h: [] };
  const doList = (list, axis, vertical) => list.forEach(st => {
    const useA = isA(st), r = RC();                                   // 不管有没有手动设置都取一个随机数，这样换一根条的颜色不会影响别的条
    let hex = hwColors[axis][st.idx];
    if (!hex) hex = mode === 'avg' ? bandAverage(useA ? sA : sB, st, vertical, P.rect) : (useA ? palA : palB)[Math.floor(r * (useA ? palA : palB).length)];
    st.fill = hex; colors[axis][st.idx] = hex;
  });
  doList(warp, 'v', true); doList(weft, 'h', false);
  return colors;
}

// 从一段文字里取出所有 #xxxxxx / xxxxxx / #xxx
function parseHexList(text) {
  const out = [];
  String(text || '').replace(/#?\b([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (_, x) => { out.push('#' + (x.length === 3 ? x.split('').map(ch => ch + ch).join('') : x).toLowerCase()); });
  return out;
}
$('hwPalText').addEventListener('input', () => queueRender());
$('hwPalText').addEventListener('change', () => pushHistory('Color list'));

// ---------- 选中、换色 ----------
const hwSel = { v: new Set(), h: new Set() };
let swSig = '';
const selCount = () => hwSel.v.size + hwSel.h.size;
function toggleSel(axis, idx, additive) {
  if (!additive) { const had = hwSel[axis].has(idx) && selCount() === 1; hwSel.v.clear(); hwSel.h.clear(); if (had) { queueRender(); return; } }
  if (hwSel[axis].has(idx)) hwSel[axis].delete(idx); else hwSel[axis].add(idx);
  queueRender();
}
function hwPick(p, e) {                                            // 在画布上点选一根条
  const g = hwGeom;
  if (!g) return;
  const iv = g.warp.findIndex(st => inPoly(st.pts, p)), ih = g.weft.findIndex(st => inPoly(st.pts, p));
  if (iv < 0 && ih < 0) { if (!e.shiftKey) { hwSel.v.clear(); hwSel.h.clear(); queueRender(); } return; }
  let axis;
  if (iv >= 0 && ih >= 0) {                                       // 在交叉点上：默认选压在上面的那根，Alt 选下面的
    const warpOnTop = g.top ? g.top[ih * g.nW + iv] === 1 : true;
    axis = (warpOnTop !== e.altKey) ? 'v' : 'h';
  } else axis = iv >= 0 ? 'v' : 'h';
  toggleSel(axis, axis === 'v' ? iv : ih, e.shiftKey);
}
function setColors(hex) {                                          // 给选中的条设置颜色
  if (!selCount()) return false;
  for (const axis of ['v', 'h']) hwSel[axis].forEach(i => { hwColors[axis][i] = hex; });
  if ($('hwFill').value === 'image') { $('hwFill').value = 'avg'; syncHW(); }   // 想换颜色就一定是纯色条了
  queueRender();
  return true;
}
const randHex = () => { const h = Math.random() * 360, s = 0.55 + Math.random() * 0.4, l = 0.4 + Math.random() * 0.2;
  const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255); };

$('hwRecolor').addEventListener('input', e => setColors(e.target.value));
$('hwRecolor').addEventListener('change', () => { if (selCount()) pushHistory('Recolor strips'); });
$('hwRandColor').addEventListener('click', () => {
  if (!selCount()) return;
  for (const axis of ['v', 'h']) hwSel[axis].forEach(i => { hwColors[axis][i] = randHex(); });
  if ($('hwFill').value === 'image') { $('hwFill').value = 'avg'; syncHW(); }
  queueRender(); pushHistory('Random color');
});
$('hwPalColor').addEventListener('click', () => {
  if (!selCount()) return;
  const K = Math.round(+$('hwPalK').value), pa = getPalette('A', K), pb = getPalette('B', K);
  const vertAlt = $('hwKind').value === 'strips' && $('hwStripSrc').value === 'alt';
  for (const axis of ['v', 'h']) hwSel[axis].forEach(i => {
    const pal = (axis === 'v' || (vertAlt && i % 2 === 0)) ? pa : pb;
    hwColors[axis][i] = pal[Math.floor(Math.random() * pal.length)];
  });
  if ($('hwFill').value === 'image') { $('hwFill').value = 'avg'; syncHW(); }
  queueRender(); pushHistory('Palette color');
});
$('hwClearSel').addEventListener('click', () => {
  for (const axis of ['v', 'h']) hwSel[axis].forEach(i => { delete hwColors[axis][i]; });
  queueRender(); pushHistory('Reset selected colors');
});
$('hwColorsReset').addEventListener('click', () => { hwColors = { v: {}, h: {} }; queueRender(); pushHistory('Clear manual colors'); });
$('hwSelV').addEventListener('click', () => { hwSel.h.clear(); (hwGeom ? hwGeom.warp : []).forEach(st => hwSel.v.add(st.idx)); queueRender(); });
$('hwSelH').addEventListener('click', () => { hwSel.v.clear(); (hwGeom ? hwGeom.weft : []).forEach(st => hwSel.h.add(st.idx)); queueRender(); });
$('hwSelNone').addEventListener('click', () => { hwSel.v.clear(); hwSel.h.clear(); queueRender(); });

// 色块：一根条一个，点击选中（Shift 多选）
function updateSwatches() {
  if (MODE !== 'hand' || !hwGeom || !hwGeom.colors) return;
  const sig = JSON.stringify([hwGeom.colors, [...hwSel.v], [...hwSel.h]]);
  if (sig === swSig) return;
  swSig = sig;
  for (const axis of ['v', 'h']) {
    const box = $(axis === 'v' ? 'hwSwV' : 'hwSwH');
    box.innerHTML = '';
    hwGeom.colors[axis].forEach((c, i) => {
      if (!c) return;
      const b = document.createElement('button');
      b.type = 'button'; b.style.background = c; b.title = (axis === 'v' ? 'V' : 'H') + (i + 1) + '  ' + c;
      if (hwSel[axis].has(i)) b.className = 'sel';
      b.addEventListener('click', e => toggleSel(axis, i, e.shiftKey));
      box.appendChild(b);
    });
  }
}

// 选中的条的轮廓（只在预览里显示，不会导出）
function drawSelOutline(k) {
  if (!hwGeom || !selCount()) return;
  ctx.save(); ctx.lineWidth = Math.max(2, 2 * k); ctx.strokeStyle = '#2b3bd6'; ctx.setLineDash([6 * k, 4 * k]);
  for (const axis of ['v', 'h']) hwSel[axis].forEach(i => {
    const st = (axis === 'v' ? hwGeom.warp : hwGeom.weft)[i];
    if (!st) return;
    ctx.beginPath(); st.pts.forEach(([x, y], q) => q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
  });
  ctx.restore();
}

// ---------- 整齐预设：把所有随机性关掉 ----------
$('hwTidy').addEventListener('click', () => {
  const set = (id, v) => { $(id).value = v; };
  set('hwVar', 0); set('hwWob', 0); set('hwTilt', 0); set('hwRag', 0); set('hsP', 0); set('hsSwap', 0); set('hwGap', 1);
  set('hwExtVRand', 0); set('hwExtHRand', 0); set('hwTone', 0);
  queueRender(); pushHistory('Tidy preset');
});
