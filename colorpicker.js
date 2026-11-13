// ===================== 取色面板：HEX / RGB / CMYK / 复制 / 屏幕吸管 =====================
// 把页面里所有原生的颜色框换成“色块 + 色号”，点开后可以输入 HEX、RGB、CMYK，一键复制，或用吸管吸取屏幕上的颜色。
// 原生的 <input type=color> 仍然保留（藏起来）负责存值，所以别的代码不用改。
// 注意：CMYK 是用公式从 RGB 换算的，没有色彩配置文件，和 Photoshop / 印刷用的 CMYK 数值不一定一致，只能当参考。

const cfHexOk = s => /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(s).trim());
const cfNorm = s => { let x = String(s).trim().replace('#', ''); if (x.length === 3) x = x.split('').map(c => c + c).join(''); return '#' + x.toLowerCase(); };
const cfRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const cfHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function cfToCmyk(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255, k = 1 - Math.max(R, G, B);
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - R - k) / (1 - k), (1 - G - k) / (1 - k), (1 - B - k) / (1 - k), k].map(v => Math.round(v * 100));
}
const cfFromCmyk = (c, m, y, k) => [255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - m / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100)];

const cfFields = [];          // [{ nat, sw, hx }]
let cfPop = null, cfCur = null;

function cfCopy(text, btn) {
  const done = () => { if (btn) { const old = btn.textContent; btn.textContent = '✓'; setTimeout(() => { btn.textContent = old; }, 900); } };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => cfCopyFallback(text, done));
  else cfCopyFallback(text, done);
}
function cfCopyFallback(text, done) {
  const t = document.createElement('textarea');
  t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); done(); } catch (e) {}
  t.remove();
}

function cfBuildPop() {
  const p = document.createElement('div');
  p.id = 'cfPop'; p.hidden = true;
  p.innerHTML = `
    <div class="cfprev"></div>
    <div class="cfrow"><b>#</b><input type="text" class="hex" maxlength="7" spellcheck="false" placeholder="f26b21"><button type="button" class="cphex">Copy</button></div>
    <div class="cfrow"><b>R</b><input type="number" class="r" min="0" max="255"><b>G</b><input type="number" class="g" min="0" max="255"><b>B</b><input type="number" class="b" min="0" max="255"></div>
    <div class="cfrow"><button type="button" class="cprgb">Copy rgb()</button></div>
    <div class="cfrow"><b>C</b><input type="number" class="c" min="0" max="100"><b>M</b><input type="number" class="m" min="0" max="100"><b>Y</b><input type="number" class="y" min="0" max="100"><b>K</b><input type="number" class="k" min="0" max="100"></div>
    <div class="cfrow"><button type="button" class="cpcmyk">Copy CMYK</button><span style="color:#777">%</span></div>
    <div class="cfbtns"><button type="button" class="sys">System picker</button><button type="button" class="eye">Eyedropper</button><button type="button" class="close">Close</button></div>`;
  document.body.appendChild(p);
  const q = sel => p.querySelector(sel);
  const hex = q('.hex'), r = q('.r'), g = q('.g'), b = q('.b'), c = q('.c'), m = q('.m'), y = q('.y'), k = q('.k');
  const commit = () => { if (cfCur) cfCur.nat.dispatchEvent(new Event('change', { bubbles: true })); };
  // from = 哪一组输入框正在被编辑（不要回头改它，免得四舍五入让数字跳来跳去）
  const apply = (h, from) => {
    if (!cfCur) return;
    const [R, G, B] = cfRgb(h), cm = cfToCmyk(R, G, B);
    cfCur.nat.value = h;
    if (from !== 'hex') hex.value = h.slice(1);
    if (from !== 'rgb') { r.value = R; g.value = G; b.value = B; }
    if (from !== 'cmyk') { c.value = cm[0]; m.value = cm[1]; y.value = cm[2]; k.value = cm[3]; }
    q('.cfprev').style.background = h;
    cfCur.nat.dispatchEvent(new Event('input', { bubbles: true }));
    cfSync();
  };
  const num = el => Math.max(+el.min, Math.min(+el.max, +el.value || 0));
  hex.addEventListener('input', () => { if (cfHexOk(hex.value)) apply(cfNorm(hex.value), 'hex'); });
  hex.addEventListener('change', () => { if (cfHexOk(hex.value)) { apply(cfNorm(hex.value)); commit(); } });
  [r, g, b].forEach(el => { el.addEventListener('input', () => apply(cfHex(num(r), num(g), num(b)), 'rgb')); el.addEventListener('change', commit); });
  [c, m, y, k].forEach(el => { el.addEventListener('input', () => apply(cfHex(...cfFromCmyk(num(c), num(m), num(y), num(k))), 'cmyk')); el.addEventListener('change', commit); });
  q('.cphex').addEventListener('click', e => cfCopy('#' + hex.value.replace('#', ''), e.target));
  q('.cprgb').addEventListener('click', e => cfCopy(`rgb(${r.value}, ${g.value}, ${b.value})`, e.target));
  q('.cpcmyk').addEventListener('click', e => cfCopy(`${c.value}, ${m.value}, ${y.value}, ${k.value}`, e.target));
  q('.close').addEventListener('click', cfClose);
  q('.sys').addEventListener('click', () => { if (!cfCur) return; const n = cfCur.nat; n._allow = true; try { n.showPicker(); } catch (e) {} n._allow = false; });
  const eye = q('.eye');
  if (!('EyeDropper' in window)) eye.hidden = true;               // Chrome / Edge 才有；其他浏览器没有就隐藏
  eye.addEventListener('click', async () => {
    try { const res = await new EyeDropper().open(); apply(res.sRGBHex.toLowerCase()); commit(); } catch (e) {}
  });
  p._apply = apply;
  return p;
}

function cfOpen(f) {
  if (!cfPop) cfPop = cfBuildPop();
  cfCur = f;
  cfPop._apply(cfNorm(f.nat.value));
  cfPop.hidden = false;
  const r = f.sw.getBoundingClientRect(), w = cfPop.offsetWidth, h = cfPop.offsetHeight;
  cfPop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
  cfPop.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.bottom + 6)) + 'px';
}
function cfClose() { if (cfPop) cfPop.hidden = true; cfCur = null; }

function cfSync() {                                                // 让色块和色号跟上颜色框里的值（撤销、重置、预设之后也会走这里）
  for (const f of cfFields) { const v = f.nat.value; if (f.sw.style.background !== v) { f.sw.style.background = v; } f.hx.textContent = v; }
}
function syncColorFields() { cfSync(); }

function cfInit() {
  document.querySelectorAll('input[type=color]').forEach(nat => {
    const wrap = document.createElement('span');
    wrap.className = 'cf'; wrap.style.position = 'relative';
    nat.parentNode.insertBefore(wrap, nat);
    wrap.appendChild(nat);
    nat.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0;margin:0';
    nat.tabIndex = -1;
    const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'cf-sw'; sw.title = 'Color';
    const hx = document.createElement('span'); hx.className = 'cf-hex';
    wrap.append(sw, hx);
    const f = { nat, sw, hx };
    cfFields.push(f);
    sw.addEventListener('click', e => { e.preventDefault(); cfCur && cfCur.nat === nat && !cfPop.hidden ? cfClose() : cfOpen(f); });
    nat.addEventListener('click', e => { if (!nat._allow) { e.preventDefault(); cfOpen(f); } });   // 点到标签文字时，也打开我们的面板而不是系统的
    nat.addEventListener('input', cfSync);
  });
  document.addEventListener('mousedown', e => { if (cfPop && !cfPop.hidden && !cfPop.contains(e.target) && !e.target.closest('.cf')) cfClose(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cfPop && !cfPop.hidden) cfClose(); });
  cfSync();
}
