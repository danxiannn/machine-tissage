// ===================== 手工编织模式 =====================
// 依赖 script.js / shuffle.js 里的全局：mulberry32, regionCanvas, shapes, hwPull ...，以及：$, T, layers, paintSource, PATTERNS, rnd, queueRender, pushHistory, exitTool, tool, MODE
// 做法：竖条（取自 A）和横条（取自 B）都是“一根一根”的多边形，各有宽度、弯曲、歪斜、长短；
//       按织法决定每个交叉点谁压在上面；再加投影、明暗差异和纸张颗粒。

function readHW() {
  const v = id => +$(id).value;
  const P = { nW: Math.round(v('hwNW')), nH: Math.round(v('hwNH')), draft: $('hwDraft').value,
    var: v('hwVar'), gap: v('hwGap'), wob: v('hwWob'), tilt: v('hwTilt'), margin: v('hwMargin'),
    rag: v('hwRag'), tone: v('hwTone'), shadow: v('hwShadow'), soft: v('hwSoft'), grain: v('hwGrain'),
    paper: $('hwPaper').value, seed: Math.round(v('hwSeed')) || 1,
    cAlgo: $('hwCAlgo').value, cThr: v('hwCThr'), cInv: $('hwCInv').checked,
    hsP: v('hsP'), hsAmt: v('hsAmt'), hsSwap: v('hsSwap'), hsSeed: Math.round(v('hsSeed')) || 1, follow: $('hwFollow').checked,
    slit: document.querySelector('input[name=slit]:checked').value, slitW: v('hwSlitW'), slitDir: $('hwSlitDir').value,
    outside: $('outside').value,
    fill: $('hwFill').value, palK: Math.round(v('hwPalK')), palText: $('hwPalText').value,
    gTilt: v('hwGTilt'), gWave: v('hwGWave'), gWaveLen: Math.max(50, v('hwGWaveLen')), ragV: $('hwRagV').value, ragH: $('hwRagH').value, gapIrr: v('hwGapIrr'),
    extV: { side: $('hwExtVSide').value, len: v('hwExtVLen') / 100 * (+$('H').value), rand: v('hwExtVRand') },   // 延伸长度 = 主体高度的 %
    extH: { side: $('hwExtHSide').value, len: v('hwExtHLen') / 100 * (+$('W').value), rand: v('hwExtHRand') },   // 延伸长度 = 主体宽度的 %
    rect: handRect(),
    kind: $('hwKind').value, style: $('hwStyle').value, stripDir: $('hwStripDir').value, stripSrc: $('hwStripSrc').value };
  if (P.style === 'flat') { P.tone = 0; P.shadow = 0; P.grain = 0; }   // 平面：无明暗差异、无投影、无颗粒
  return P;
}

// 生成一组条：vertical = true 为竖条（沿 y 方向），否则为横条（沿 x 方向）
// 歪斜 / 弯曲分两层：
//   整体（gTilt、gWave）：所有条一起转、一起弯，彼此保持平行；
//   手剪感（wob、tilt、gapIrr）：晃动的是“条与条之间的边缘线”，相邻的两根条共用这条线，所以永远不会互相穿过，
//   只是宽度会有一点楔形变化（像手剪的纸条）；再加上“缝隙不均”，让缝时宽时窄。
function makeStrips(n, vertical, seed, P, W, H, pulls) {
  const R = mulberry32(seed), RS = mulberry32(P.hsSeed * 977 + (vertical ? 1 : 2)), RE = mulberry32(seed + 555), RB = mulberry32(seed + 777);
  const R0 = P.rect, m = R0.m;                      // 编织区域（在实际画布里的位置）
  const u0 = vertical ? R0.x0 : R0.y0, u1 = vertical ? R0.x1 : R0.y1;      // 横跨方向的范围
  const v0 = vertical ? R0.y0 : R0.x0, v1 = vertical ? R0.y1 : R0.x1;      // 沿条方向的编织范围
  const ws = Array.from({ length: n }, () => 1 + (R() - 0.5) * 2 * P.var);
  const sum = ws.reduce((a, b) => a + b, 0), avail = Math.max(1, (u1 - u0) - P.gap * (n - 1));
  const K = 32, vm = (v0 + v1) / 2;
  const gTilt = Math.tan(P.gTilt * Math.PI / 180) * (vertical ? -1 : 1);     // 整块布旋转：竖条和横条朝同一个转动方向歪
  // 各根条的名义宽度和位置
  const wid = [], left0 = [];
  let u = u0;
  for (let i = 0; i < n; i++) { const w = avail * ws[i] / sum; wid.push(w); left0.push(u); u += w + P.gap; }
  // 每条“边缘线”（n + 1 条，包括最外面两条）各自的晃动参数
  const edges = [];
  for (let j = 0; j <= n; j++) {
    const wl = j > 0 ? wid[j - 1] : Infinity, wr = j < n ? wid[j] : Infinity, mw = Math.min(wl, wr, 1e9);
    edges.push({ lam: 250 + RB() * 300, ph: RB() * T, tilt: Math.tan((RB() - 0.5) * 2 * P.tilt * Math.PI / 180), wob: P.wob * (0.4 + RB() * 0.6),
                 lamG: 200 + RB() * 300, phG: RB() * T, ampG: 0.3 + RB() * 0.7, mw,
                 cm: 0.3 * mw, gMax: Math.min(P.gapIrr, 0.2 * mw) });
  }
  const off = (j, v) => {                                          // 第 j 条边缘线在 v 处的横向偏移（用 tanh 平滑地限制幅度，不会出现生硬的折角）
    const e = edges[j], raw = e.wob * Math.sin(T * v / e.lam + e.ph) + e.tilt * (v - vm);
    return e.cm * Math.tanh(raw / Math.max(1e-6, e.cm));
  };
  const gapIrr = (j, v) => (j <= 0 || j >= n) ? 0 : edges[j].gMax * edges[j].ampG * (0.5 + 0.5 * Math.sin(T * v / edges[j].lamG + edges[j].phG));
  const S = [];
  for (let i = 0; i < n; i++) {
    const w = wid[i], pull = pulls[i] || 0, pitch = avail / n;      // 被抽拉出去 / 缩回的距离
    // 条头参差：可以选哪一端（默认两端）
    const rr1 = R(), rr2 = R();
    const E = vertical ? P.extV : P.extH, rs = vertical ? P.ragV : P.ragH, side = rs === 'ext' ? E.side : rs;
    const t1 = (side === 'start' || side === 'both') ? m * P.rag * Math.pow(rr1, 1.5) : 0;
    const t2 = (side === 'end' || side === 'both') ? m * P.rag * Math.pow(rr2, 1.5) : 0;
    // 延伸出去的一段：横竖各自设置哪一端、多长、长度随不随机（0 = 全部一样长）
    const e1 = RE(), e2 = RE();
    const x1 = (E.side === 'start' || E.side === 'both') ? E.len * (1 - E.rand * e1) : 0;
    const x2 = (E.side === 'end' || E.side === 'both') ? E.len * (1 - E.rand * e2) : 0;
    const vs = v0 - t1 - x1, ve = v1 + t2 + x2;
    R(); R(); R(); R();                                             // （保持随机数的顺序不变，让条头、明暗和以前的种子一致）
    const left = [], right = [];
    for (let k = 0; k <= K; k++) {
      const v = vs + (ve - vs) * k / K;
      const common = gTilt * (v - vm) + P.gWave * Math.sin(T * v / P.gWaveLen);                // 整体：所有条一样
      left.push([left0[i] + off(i, v) + gapIrr(i, v) / 2 + common, v + pull]);
      right.push([left0[i] + w + off(i + 1, v) - gapIrr(i + 1, v) / 2 + common, v + pull]);
    }
    // 内容打乱：沿着条滑动一段，或者换成旁边某根条的图像
    const r1 = RS(), r2 = RS(), r3 = RS(), r4 = RS();
    let along = P.follow ? pull : 0, across = 0;
    if (r1 < P.hsP) along += (r2 * 2 - 1) * P.hsAmt;
    if (r3 < P.hsSwap) across = (Math.floor(r4 * 7) - 3) * pitch;
    S.push({ left, right, tone: (R() - 0.5) * 2 * P.tone, idx: i, vertical, off: vertical ? [across, along] : [along, across] });
  }
  return S.map(st => ({ pts: st.left.concat(st.right.slice().reverse()).map(([a, b]) => vertical ? [a, b] : [b, a]),
                        tone: st.tone, idx: st.idx, vertical: st.vertical, off: st.off }));
}


function polyPath(c, pts) {
  c.beginPath();
  pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath();
}

// 图像 C → 每个交叉点一个 0/1（1 = 竖条在上）。C 缩放到“条数 × 条数”的小网格，再用选定的方式转成黑白。
function sampleC(P, W, H) {
  const n = P.nW, r = P.nH, R0 = P.rect, ww = Math.max(1, R0.x1 - R0.x0), hh = Math.max(1, R0.y1 - R0.y0);
  const sm = document.createElement('canvas');
  sm.width = n; sm.height = r;
  const c = sm.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#fff'; c.fillRect(0, 0, n, r);
  c.imageSmoothingQuality = 'high';
  c.setTransform(n / ww, 0, 0, r / hh, -R0.x0 * n / ww, -R0.y0 * r / hh);   // 编织区域 → 小网格
  drawLayer(c, layers.C, W, H, 1);
  const d = c.getImageData(0, 0, n, r).data, g = new Float32Array(n * r);
  for (let i = 0; i < g.length; i++) g[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  const shift = P.cThr - 0.5, alg = P.cAlgo, hx = Math.floor(n / 2), hy = Math.floor(r / 2);
  let res;
  if (DIFFUSE[alg]) res = diffuse(g, n, r, DIFFUSE[alg], shift);
  else {
    res = new Uint8Array(n * r);
    const bm = BAYER[alg];
    for (let j = 0; j < r; j++) for (let i = 0; i < n; i++) {
      const sh = g[j * n + i] + shift;
      res[j * n + i] = (alg === 'random' ? sh > rnd(i - hx, j - hy) : bm ? sh > bm[mod(j, bm.length)][mod(i, bm.length)] : sh > 0.5) ? 1 : 0;
    }
  }
  if (P.cInv) res = res.map(v => 1 - v);
  return res;
}

function composeHand(s) {
  const W = CW(), H = CH();
  const k = Math.min(s, Math.sqrt(25e6 / (W * H)));          // 内存保护：太大的导出自动降到约 2500 万像素
  const w = Math.round(W * k), h = Math.round(H * k);
  const P = readHW(), onlyStrips = P.kind === 'strips', vert = P.stripDir === 'v';
  const newCanvas = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const base = c => { c.setTransform(k, 0, 0, k, 0, 0); return c; };

  let warp, weft;                                                  // warp = 竖条，weft = 横条
  if (onlyStrips) {                                                // 只切条：只有一个方向
    const list = makeStrips(vert ? P.nW : P.nH, vert, P.seed, P, W, H, vert ? hwPull.v : hwPull.h);
    warp = vert ? list : []; weft = vert ? [] : list;
  } else {
    warp = makeStrips(P.nW, true, P.seed, P, W, H, hwPull.v);        // 竖条，来自 A
    weft = makeStrips(P.nH, false, P.seed + 101, P, W, H, hwPull.h); // 横条，来自 B
  }
  hwGeom = { warp, weft };                                           // 给“抽拉”工具用
  // 每根条取自哪张图（只切条时可以 A、B 交替）
  const isA = st => onlyStrips ? (P.stripSrc === 'A' || (P.stripSrc === 'alt' && st.idx % 2 === 0)) : st.vertical;
  // 纯色模式：给每根条算出（或取手动设置的）颜色
  hwGeom.colors = P.fill === 'image' ? null : assignFills(warp, weft, P, W, H, isA);


  // ---- 编织：每个交叉点谁在上面 ----
  let mWarpAll = null, mWarp = null, mCross = null, topArr = null;
  if (!onlyStrips) {
    const useC = P.draft === 'imageC' && layers.C.img;           // 没导入 C 时先用平纹代替
    const cTop = useC ? sampleC(P, W, H) : null;
    const pat = (P.draft === 'random' || useC) ? null : (PATTERNS[P.draft] || PATTERNS.checker);
    const R = mulberry32(P.seed + 7);
    // 预设图案跟着 C 图层走：C 的位置 = 图案偏移，C 的缩放 = 图案缩放（和格子模式一致）
    const pitchX = Math.max(1, (P.rect.x1 - P.rect.x0) / P.nW), pitchY = Math.max(1, (P.rect.y1 - P.rect.y0) / P.nH);
    const sI = Math.round(layers.C.x / pitchX), sJ = Math.round(layers.C.y / pitchY), sc = Math.max(0.2, layers.C.scale);
    mWarpAll = newCanvas(); mCross = newCanvas(); topArr = new Uint8Array(P.nW * P.nH);
    const ca = base(mWarpAll.getContext('2d')), cc = base(mCross.getContext('2d'));
    ca.fillStyle = '#000'; warp.forEach(st => { polyPath(ca, st.pts); ca.fill(); });
    cc.fillStyle = '#000';
    const hx = Math.floor(P.nW / 2), hy = Math.floor(P.nH / 2);
    for (let i = 0; i < P.nW; i++) for (let j = 0; j < P.nH; j++) {
      const warpTop = cTop ? cTop[j * P.nW + i] === 1 : pat ? pat(Math.floor((i - hx - sI) / sc), Math.floor((j - hy - sJ) / sc)) : R() > 0.5;
      topArr[j * P.nW + i] = warpTop ? 1 : 0;
      if (warpTop) continue;
      cc.save(); polyPath(cc, weft[j].pts); cc.clip(); polyPath(cc, warp[i].pts); cc.fill(); cc.restore();
    }
    mWarp = newCanvas();                                          // 竖条可见部分 = 竖条 − 横条压住的交叉区域
    const mv = mWarp.getContext('2d');
    mv.drawImage(mWarpAll, 0, 0); mv.globalCompositeOperation = 'destination-out'; mv.drawImage(mCross, 0, 0);
  }

  hwGeom.top = topArr; hwGeom.nW = P.nW;                              // 点选条时判断“压在上面的是哪一根”

  // ---- 只看蒙版：黑 = A，灰 = B ----
  if ($('hwShowMask').checked) {
    const mo = newCanvas(), mc = mo.getContext('2d');
    mc.fillStyle = '#fff'; mc.fillRect(0, 0, w, h);
    base(mc);
    if (onlyStrips) {
      [...warp, ...weft].forEach(st => { polyPath(mc, st.pts); mc.fillStyle = isA(st) ? '#000' : '#cfcfcf'; mc.fill(); });
    } else {
      mc.fillStyle = '#cfcfcf'; weft.forEach(st => { polyPath(mc, st.pts); mc.fill(); });
      mc.setTransform(1, 0, 0, 1, 0, 0); mc.drawImage(mWarp, 0, 0);
    }
    return mo;
  }

  // ---- 把来源图按“每根条的形状”裁出来 ----
  const srcA = newCanvas(), srcB = newCanvas();
  paintSource(srcA.getContext('2d'), 'A', W, H, k);
  paintSource(srcB.getContext('2d'), 'B', W, H, k);
  const stripLayer = (strips, src) => {
    const L = newCanvas(), c = L.getContext('2d');
    for (const st of strips) {
      c.save();
      base(c); polyPath(c, st.pts);
      if (st.fill) { c.fillStyle = st.fill; c.fill(); }                  // 纯色条
      c.clip();
      c.setTransform(1, 0, 0, 1, 0, 0);
      const ox = st.off[0] * k, oy = st.off[1] * k;
      if (st.fill) { /* 纯色：已经填好了 */ }
      else if (!ox && !oy) c.drawImage(src, 0, 0);
      else for (const wy of oy ? [-h, 0, h] : [0]) for (const wx of ox ? [-w, 0, w] : [0]) c.drawImage(src, ox + wx, oy + wy);   // 图像滑动（循环）
      if (st.tone) { c.fillStyle = st.tone > 0 ? `rgba(255,255,255,${st.tone})` : `rgba(0,0,0,${-st.tone})`; c.fillRect(0, 0, w, h); }
      c.restore();
      base(c); polyPath(c, st.pts);
      c.lineWidth = P.style === 'flat' ? 1 : 1.2; c.strokeStyle = 'rgba(0,0,0,0.25)'; c.stroke();     // 很细的切边线
    }
    return L;
  };

  // ---- 底纸 / 背景底图 ----
  const bgc = newCanvas(), bg = bgc.getContext('2d');
  bg.fillStyle = P.paper; bg.fillRect(0, 0, w, h);
  paintSource(bg, 'D', W, H, k);                                 // 有背景底图就盖在底纸上（条与条的缝隙会透出它）
  const out = newCanvas(), o = out.getContext('2d');
  o.drawImage(bgc, 0, 0);

  // 投影：只落在“被压住的那一层”或底纸上，同一根条不会给自己投影（拟真风格才有）
  const shadowOnly = (img, a, exclude) => {
    const t = newCanvas(), g = t.getContext('2d');
    g.shadowColor = `rgba(25,18,8,${a})`; g.shadowBlur = P.soft * k;
    g.shadowOffsetX = P.soft * 0.35 * k; g.shadowOffsetY = P.soft * 0.5 * k;
    g.drawImage(img, 0, 0);
    g.shadowColor = 'transparent';
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(img, 0, 0);                                      // 去掉条本身，只剩投影
    if (exclude) g.drawImage(exclude, 0, 0);                     // 再去掉不该有投影的地方
    return t;
  };
  const real = P.style === 'real' && P.shadow > 0;

  if (onlyStrips) {
    const L = newCanvas(), lg = L.getContext('2d');
    lg.drawImage(stripLayer([...warp, ...weft].filter(isA), srcA), 0, 0);
    lg.drawImage(stripLayer([...warp, ...weft].filter(st => !isA(st)), srcB), 0, 0);
    if (real) o.drawImage(shadowOnly(L, P.shadow * 0.8, null), 0, 0);
    o.drawImage(L, 0, 0);
  } else {
    const Lv = stripLayer(warp, srcA), Lw = stripLayer(weft, srcB);
    const lv = Lv.getContext('2d');
    lv.globalCompositeOperation = 'destination-in'; lv.drawImage(mWarp, 0, 0);          // 只留下竖条压在上面的部分
    const lwTop = newCanvas(), lt = lwTop.getContext('2d');
    lt.drawImage(Lw, 0, 0); lt.globalCompositeOperation = 'destination-in'; lt.drawImage(mCross, 0, 0);   // 横条压在上面的交叉块
    if (real) o.drawImage(shadowOnly(Lw, P.shadow * 0.8, null), 0, 0);                  // 横条落在底纸上的投影
    o.drawImage(Lw, 0, 0);
    if (real) o.drawImage(shadowOnly(Lv, P.shadow, mWarpAll), 0, 0);                    // 竖条的投影：落在横条和底纸上，不落在竖条自己身上
    o.drawImage(Lv, 0, 0);
    if (real) o.drawImage(shadowOnly(lwTop, P.shadow, Lw), 0, 0);                       // 横条压住竖条的投影：只落在竖条和底纸上
    o.drawImage(lwTop, 0, 0);
  }

  // 纸张颗粒（拟真风格才有）
  if (P.grain > 0) {
    const nc = document.createElement('canvas'); nc.width = nc.height = 256;
    const nx = nc.getContext('2d'), id = nx.createImageData(256, 256), G = mulberry32(P.seed + 13);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 255 - Math.floor(G() * P.grain * 120);
      id.data.set([v, v, v, 255], i * 4);
    }
    nx.putImageData(id, 0, 0);
    o.save(); o.globalCompositeOperation = 'multiply'; o.scale(k, k);
    o.fillStyle = o.createPattern(nc, 'repeat'); o.fillRect(0, 0, W, H); o.restore();
  }

  // ---- 蒙版区域：只有区域里是编织，区域之外是一张完整的图（可以保留细切缝）----
  if (!($('limit').checked && shapes.length)) return out;
  const rc = regionCanvas(W, H, k);
  const full = newCanvas(), fg = full.getContext('2d');
  fg.drawImage(bgc, 0, 0);                                       // 先铺底纸 / 背景
  if (P.outside !== 'D') {                                       // 区域之外显示 A 或 B 整张图；选“背景”就只露出背景
    const outer = newCanvas(), og = outer.getContext('2d');
    paintSource(og, P.outside, W, H, k);
    if (P.slit === 'keep' && P.slitW > 0) {                      // 沿着条与条之间的缝把整张图“切开”，露出下面的背景 / 底纸
      const sl = newCanvas(), sg = base(sl.getContext('2d'));
      sg.lineJoin = 'round'; sg.lineCap = 'butt'; sg.strokeStyle = '#000'; sg.lineWidth = P.slitW;
      const sets = onlyStrips ? [warp, weft] : P.slitDir === 'h' ? [weft] : P.slitDir === 'v' ? [warp] : [weft, warp];
      for (const strips of sets) strips.forEach((st, i) => {
        const n = st.pts.length / 2, edges = [st.pts.slice(0, n)];   // 每根条的一侧边缘 = 条与条之间的缝
        if (i === strips.length - 1) edges.push(st.pts.slice(n));
        edges.forEach(l => { sg.beginPath(); l.forEach(([x, y], q) => q ? sg.lineTo(x, y) : sg.moveTo(x, y)); sg.stroke(); });
      });
      og.globalCompositeOperation = 'destination-out'; og.setTransform(1, 0, 0, 1, 0, 0); og.drawImage(sl, 0, 0);
    }
    fg.drawImage(outer, 0, 0);
  }
  const wc = out.getContext('2d');
  wc.globalCompositeOperation = 'destination-in'; wc.drawImage(rc, 0, 0);
  fg.drawImage(out, 0, 0);
  return full;
}

// ---------- 抽拉：在画布上竖着拖竖条、横着拖横条 ----------
let hwGeom = null, hwDrag = null;
function inPoly(pts, p) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function stripAt(strips, p, vertical) {
  let i = strips.findIndex(st => inPoly(st.pts, p));
  if (i >= 0) return i;
  let best = 0, bd = Infinity;                       // 没点在条里面：取横跨方向上最近的一根
  strips.forEach((st, k) => {
    const c = st.pts.reduce((a, q) => a + q[vertical ? 0 : 1], 0) / st.pts.length, d = Math.abs(c - p[vertical ? 0 : 1]);
    if (d < bd) { bd = d; best = k; }
  });
  return best;
}
function hwDown(p) { if (hwGeom) hwDrag = { start: p, axis: null, idx: null, base: 0 }; }
function hwMove(p) {
  const d = hwDrag;
  if (!d) return;
  const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
  if (!d.axis) {
    if (Math.hypot(dx, dy) < 5 * dpx()) return;
    d.axis = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';             // 竖着拖 = 拉竖条
    if (!(d.axis === 'v' ? hwGeom.warp : hwGeom.weft).length) { d.axis = null; return; }   // 只切条时，另一个方向没有条
    d.idx = stripAt(d.axis === 'v' ? hwGeom.warp : hwGeom.weft, d.start, d.axis === 'v');
    d.base = hwPull[d.axis][d.idx] || 0;
  }
  hwPull[d.axis][d.idx] = d.base + (d.axis === 'v' ? dy : dx);
  queueRender();
}
function hwUp() {
  const d = hwDrag; hwDrag = null;
  if (d && d.idx !== null) pushHistory('Pull strip');
}
function drawPullOverlay(k) {
  if (!hwDrag || hwDrag.idx === null || !hwGeom) return;
  const st = (hwDrag.axis === 'v' ? hwGeom.warp : hwGeom.weft)[hwDrag.idx];
  if (!st) return;
  ctx.save(); ctx.lineWidth = Math.max(2, 2 * k); ctx.strokeStyle = '#e0245e'; ctx.setLineDash([6 * k, 4 * k]);
  ctx.beginPath(); st.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
  ctx.restore();
}
$('hwPullReset').addEventListener('click', () => { hwPull = { v: {}, h: {} }; queueRender(); pushHistory('Reset pulls'); });
$('hsRoll').addEventListener('click', () => { $('hsSeed').value = 1 + Math.floor(Math.random() * 99999); queueRender(); pushHistory('Reroll content shuffle'); });

// ---------- 模式切换 ----------
function syncHW() {
  const weave = $('hwKind').value === 'weave';
  $('hwWeaveBox').hidden = !weave;
  $('hwStripBox').hidden = weave;
  $('hwCBox').hidden = !(weave && $('hwDraft').value === 'imageC');
  $('hwRealBox').hidden = $('hwStyle').value !== 'real';       // 投影、颗粒、明暗差异只有“拟真”风格才用得上
  $('hwColorBox').hidden = $('hwFill').value === 'image';      // 纯色条的颜色设置
  $('hwPalRow').hidden = $('hwFill').value !== 'palette';
  $('hwPalWrap').hidden = $('hwFill').value !== 'custom';
}
['hwDraft', 'hwKind', 'hwStyle', 'hwFill'].forEach(id => $(id).addEventListener('change', () => { syncHW(); syncTile(); }));
function setMode(m) {
  MODE = m;
  const r = document.querySelector(`input[name=mode][value=${m}]`);
  if (r) r.checked = true;
  document.querySelectorAll('[data-modes]').forEach(el => { el.hidden = el.dataset.modes !== m; });
  syncHW(); syncTile();
  if (typeof syncToolUI === 'function') syncToolUI();
  queueRender();
}
document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
  setMode(r.value); pushHistory(r.value === 'hand' ? 'Mode: hand weave' : 'Mode: grid mask');
}));
$('hwShuffle').addEventListener('click', () => {
  $('hwSeed').value = 1 + Math.floor(Math.random() * 99999);
  queueRender(); pushHistory('Reshuffle');
});
