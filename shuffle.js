// ===================== 格子打乱：随机 + 手动 =====================
// 作用在“已经合成好的图像”上：把它按格子切开，再让行 / 列滑动或互换，让单个格子旋转 / 翻转或互换。
// 手动修改（shEdits）叠加在随机结果之上，用格子编号记录（以画布中心那一格为 0,0），所以重新随机时不会丢。

// （随机数函数 mulberry32 在 script.js 里）

function readSh() {
  const v = id => +$(id).value;
  return { rowP: v('shRowP'), colP: v('shColP'), max: v('shMax'), swapRC: v('shSwapRC'), rot: v('shRot'), swapC: v('shSwapC'),
           seed: Math.round(v('shSeed')) || 1 };
}
// 和 buildMask 里完全一致的格子划分（以画布中心为锚点）
function gridGeom(W, H) {
  const { cell, dx, dy } = gridInfo();
  const hx = Math.ceil(W / (2 * cell) + Math.abs(dx) / cell) + 1, hy = Math.ceil(H / (2 * cell) + Math.abs(dy) / cell) + 1;
  return { cell, dx, dy, hx, hy, cols: 2 * hx + 1, rows: 2 * hy + 1 };
}

// key = 'A' 或 'B'：打乱的是这张图像本身（不是蒙版，也不是合成后的结果）
function shuffleGrid(src, s, key) {
  const P = readSh(), W = CW(), H = CH();
  const seed0 = P.seed + ($('shSame').checked || key !== 'B' ? 0 : 7919);       // A、B 各自独立时，B 用另一个种子
  const to = $('shApplyTo').value, doEdits = (to === 'both' || to === key) && shEdits.length > 0;   // 手动修改作用于谁
  const any = P.rowP > 0 || P.colP > 0 || P.swapRC > 0 || P.rot > 0 || P.swapC > 0;
  if (!any && !doEdits) return src;
  const g = gridGeom(W, H), cs = g.cell * s, w = src.width, h = src.height;
  const X0 = (W / 2 + g.dx - (g.hx + 0.5) * g.cell) * s, Y0 = (H / 2 + g.dy - (g.hy + 0.5) * g.cell) * s;
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const copy = c => { const n = mk(); n.getContext('2d').drawImage(c, 0, 0); return n; };
  const i0 = Math.max(0, Math.floor(-X0 / cs)), i1 = Math.min(g.cols - 1, Math.floor((w - X0) / cs));
  const j0 = Math.max(0, Math.floor(-Y0 / cs)), j1 = Math.min(g.rows - 1, Math.floor((h - Y0) / cs));
  let cur = src;

  // 1) 整行 / 整列：滑动（循环）和互换
  const lines = (horizontal) => {
    const n = horizontal ? g.rows : g.cols, a0 = horizontal ? j0 : i0, a1 = horizontal ? j1 : i1;
    const R = mulberry32(seed0 * 1013 + (horizontal ? 1 : 2));
    const perm = [...Array(n).keys()], shift = new Float32Array(n), prob = horizontal ? P.rowP : P.colP;
    for (let k = a0; k <= a1; k++) {
      if (R() < P.swapRC) { const m = a0 + Math.floor(R() * (a1 - a0 + 1)); [perm[k], perm[m]] = [perm[m], perm[k]]; }
      if (R() < prob) shift[k] = (R() * 2 - 1) * P.max * cs;
    }
    if (!(prob > 0 || P.swapRC > 0)) return;
    const nx = mk(), ng = nx.getContext('2d');
    ng.drawImage(cur, 0, 0);
    for (let k = a0; k <= a1; k++) {
      if (perm[k] === k && !shift[k]) continue;
      const p = (horizontal ? Y0 : X0) + k * cs, sp = (horizontal ? Y0 : X0) + perm[k] * cs;
      ng.save(); ng.beginPath();
      if (horizontal) ng.rect(0, p, w, cs); else ng.rect(p, 0, cs, h);
      ng.clip();
      for (const off of horizontal ? [-w, 0, w] : [-h, 0, h]) {       // 循环滑动：两边各补一份
        if (horizontal) ng.drawImage(cur, 0, sp, w, cs, shift[k] + off, p, w, cs);
        else ng.drawImage(cur, sp, 0, cs, h, p, shift[k] + off, cs, h);
      }
      ng.restore();
    }
    cur = nx;
  };
  lines(true); lines(false);

  // 2) 单个格子：旋转 / 翻转，以及和附近的格子互换
  const cellTransform = (ctx2, base, x, y, kind) => {
    ctx2.save();
    ctx2.translate(x + cs / 2, y + cs / 2);
    if (kind === 0) ctx2.rotate(Math.PI / 2); else if (kind === 1) ctx2.rotate(Math.PI); else if (kind === 2) ctx2.rotate(-Math.PI / 2);
    else if (kind === 3) ctx2.scale(-1, 1); else ctx2.scale(1, -1);
    ctx2.drawImage(base, x, y, cs, cs, -cs / 2, -cs / 2, cs, cs);
    ctx2.restore();
  };
  if (P.rot > 0 || P.swapC > 0) {
    const base = cur, nx = copy(base), ng = nx.getContext('2d'), R = mulberry32(seed0 * 1013 + 3);
    const used = new Uint8Array(g.cols * g.rows);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = j * g.cols + i;
      if (used[idx]) continue;
      const x = X0 + i * cs, y = Y0 + j * cs;
      if (R() < P.rot) { cellTransform(ng, base, x, y, Math.floor(R() * 5)); used[idx] = 1; }
      else if (R() < P.swapC) {
        const i2 = i + Math.floor(R() * 7) - 3, j2 = j + Math.floor(R() * 7) - 3;
        if (i2 < i0 || i2 > i1 || j2 < j0 || j2 > j1 || used[j2 * g.cols + i2]) continue;
        ng.drawImage(base, X0 + i2 * cs, Y0 + j2 * cs, cs, cs, x, y, cs, cs);
        ng.drawImage(base, x, y, cs, cs, X0 + i2 * cs, Y0 + j2 * cs, cs, cs);
        used[idx] = 1; used[j2 * g.cols + i2] = 1;
      }
    }
    cur = nx;
  }

  // 3) 手动修改：按顺序依次应用
  if (doEdits) {
    if (cur === src) cur = copy(src);
    const cg = cur.getContext('2d');
    const cx = ci => X0 + (ci + g.hx) * cs, cy = cj => Y0 + (cj + g.hy) * cs;
    const grab = (x, y, ww, hh) => { const t = document.createElement('canvas'); t.width = Math.max(1, Math.ceil(ww)); t.height = Math.max(1, Math.ceil(hh)); t.getContext('2d').drawImage(cur, x, y, ww, hh, 0, 0, t.width, t.height); return t; };
    for (const e of shEdits) {
      if (e.t === 'rot') {
        const x = cx(e.ci), y = cy(e.cj), t = grab(x, y, cs, cs);
        cg.save(); cg.beginPath(); cg.rect(x, y, cs, cs); cg.clip();
        cg.translate(x + cs / 2, y + cs / 2);
        if (e.k === 'cw') cg.rotate(Math.PI / 2); else if (e.k === 'ccw') cg.rotate(-Math.PI / 2); else if (e.k === 'fh') cg.scale(-1, 1); else cg.scale(1, -1);
        cg.drawImage(t, -cs / 2, -cs / 2, cs, cs); cg.restore();
      } else if (e.t === 'swapC') {
        const ax = cx(e.ci), ay = cy(e.cj), bx = cx(e.ci2), by = cy(e.cj2), ta = grab(ax, ay, cs, cs), tb = grab(bx, by, cs, cs);
        cg.drawImage(tb, ax, ay, cs, cs); cg.drawImage(ta, bx, by, cs, cs);
      } else if (e.t === 'slideR' || e.t === 'slideC') {
        const horiz = e.t === 'slideR', p = horiz ? cy(e.j) : cx(e.i), amount = e.d * s;
        const t = horiz ? grab(0, p, w, cs) : grab(p, 0, cs, h);
        cg.save(); cg.beginPath();
        if (horiz) cg.rect(0, p, w, cs); else cg.rect(p, 0, cs, h);
        cg.clip();
        for (const off of horiz ? [-w, 0, w] : [-h, 0, h]) {
          if (horiz) cg.drawImage(t, amount + off, p, w, cs); else cg.drawImage(t, p, amount + off, cs, h);
        }
        cg.restore();
      } else if (e.t === 'swapR' || e.t === 'swapCol') {
        const horiz = e.t === 'swapR', a = horiz ? cy(e.j) : cx(e.i), b = horiz ? cy(e.j2) : cx(e.i2);
        const ta = horiz ? grab(0, a, w, cs) : grab(a, 0, cs, h), tb = horiz ? grab(0, b, w, cs) : grab(b, 0, cs, h);
        if (horiz) { cg.drawImage(tb, 0, a, w, cs); cg.drawImage(ta, 0, b, w, cs); }
        else { cg.drawImage(tb, a, 0, cs, h); cg.drawImage(ta, b, 0, cs, h); }
      }
    }
  }
  return cur;
}

// ---------- 手动：在画布上点选 / 拖动 ----------
let shDrag = null;
const shTarget = () => document.querySelector('input[name=shtarget]:checked').value;
function shCellAt(p) {
  const g = gridGeom(CW(), CH());
  return [Math.round((p[0] - cv.width / 2 - g.dx) / g.cell), Math.round((p[1] - cv.height / 2 - g.dy) / g.cell)];
}
function shDown(p) {
  const [ci, cj] = shCellAt(p), type = shTarget();
  shSel = { type, ci, cj };
  shDrag = { start: p, ci, cj, type, axis: null, edit: null, over: null };
  queueRender();
}
function shMove(p) {
  if (!shDrag) return;
  const dx = p[0] - shDrag.start[0], dy = p[1] - shDrag.start[1], d = shDrag;
  if (d.type === 'cell') { d.over = shCellAt(p); }
  else {
    if (!d.axis && Math.hypot(dx, dy) > 6 * dpx()) d.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    const slide = d.type === 'row' ? d.axis === 'x' : d.axis === 'y';           // 沿着行 / 列的方向拖 = 滑动
    if (d.axis && slide) {
      if (!d.edit) { d.edit = d.type === 'row' ? { t: 'slideR', j: d.cj, d: 0 } : { t: 'slideC', i: d.ci, d: 0 }; shEdits.push(d.edit); }
      d.edit.d = d.type === 'row' ? dx : dy;
    } else if (d.axis) d.over = shCellAt(p);                                      // 垂直方向拖 = 和另一行 / 列互换
  }
  queueRender();
}
function shUp(p) {
  const d = shDrag; shDrag = null;
  if (!d) return;
  const [ci2, cj2] = shCellAt(p);
  if (d.edit) pushHistory(d.type === 'row' ? 'Slide row' : 'Slide column');
  else if (d.type === 'cell' && (ci2 !== d.ci || cj2 !== d.cj)) { shEdits.push({ t: 'swapC', ci: d.ci, cj: d.cj, ci2, cj2 }); shSel = { type: 'cell', ci: ci2, cj: cj2 }; pushHistory('Swap cells'); }
  else if (d.type === 'row' && d.axis === 'y' && cj2 !== d.cj) { shEdits.push({ t: 'swapR', j: d.cj, j2: cj2 }); pushHistory('Swap rows'); }
  else if (d.type === 'col' && d.axis === 'x' && ci2 !== d.ci) { shEdits.push({ t: 'swapCol', i: d.ci, i2: ci2 }); pushHistory('Swap columns'); }
  queueRender();
}
function shRotate(k, label) {
  if (!shSel || shSel.type !== 'cell') return;
  shEdits.push({ t: 'rot', ci: shSel.ci, cj: shSel.cj, k }); queueRender(); pushHistory(label);
}
$('shRotL').addEventListener('click', () => shRotate('ccw', 'Rotate cell left'));
$('shRotR').addEventListener('click', () => shRotate('cw', 'Rotate cell right'));
$('shFlipH').addEventListener('click', () => shRotate('fh', 'Flip cell horizontally'));
$('shFlipV').addEventListener('click', () => shRotate('fv', 'Flip cell vertically'));
$('shClear').addEventListener('click', () => { shEdits = []; shSel = null; queueRender(); pushHistory('Clear manual shuffle'); });
$('shRoll').addEventListener('click', () => { $('shSeed').value = 1 + Math.floor(Math.random() * 99999); queueRender(); pushHistory('Reroll shuffle'); });

// 选中目标和拖动预览（仅在预览里显示）
function drawShuffleOverlay(k) {
  const W = cv.width, H = cv.height, g = gridGeom(W, H), c = ctx;
  const cellBox = (ci, cj) => [W / 2 + g.dx + (ci - 0.5) * g.cell, H / 2 + g.dy + (cj - 0.5) * g.cell, g.cell, g.cell];
  const box = (type, ci, cj) => type === 'row' ? [0, H / 2 + g.dy + (cj - 0.5) * g.cell, W, g.cell]
    : type === 'col' ? [W / 2 + g.dx + (ci - 0.5) * g.cell, 0, g.cell, H] : cellBox(ci, cj);
  c.save();
  c.lineWidth = Math.max(2, 2 * k);
  const show = (b, color, dash) => { c.strokeStyle = color; c.setLineDash(dash ? [6 * k, 4 * k] : []); c.strokeRect(b[0], b[1], b[2], b[3]); };
  if (shSel) { const b = box(shSel.type, shSel.ci, shSel.cj); c.fillStyle = 'rgba(43,59,214,.14)'; c.fillRect(b[0], b[1], b[2], b[3]); show(b, '#2b3bd6', false); }
  if (shDrag && shDrag.over) { const o = shDrag.over; show(box(shDrag.type, o[0], o[1]), '#e0245e', true); }
  c.restore();
}
