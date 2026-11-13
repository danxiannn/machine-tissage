// ===================== 界面逻辑：分组折叠、几何开关、工具可用性 =====================

// 分组的展开 / 折叠状态会被记住
document.querySelectorAll('details.grp, details.sub, #histBox').forEach(d => {
  const key = 'wm-open-' + d.id;
  try { const v = localStorage.getItem(key); if (v !== null) d.open = v === '1'; } catch (e) {}
  d.addEventListener('toggle', () => { try { localStorage.setItem(key, d.open ? '1' : '0'); } catch (e) {} });
});

// 几何：关 / 变形 / 打乱（同一时间只能选一个）
function setGeo(g) {
  GEO = g;
  const r = document.querySelector(`input[name=geo][value=${g}]`);
  if (r) r.checked = true;
  $('geoWarp').hidden = g !== 'warp';
  $('geoShuffle').hidden = g !== 'shuffle';
  syncToolUI();
  queueRender();
}
document.querySelectorAll('input[name=geo]').forEach(r => r.addEventListener('change', () => {
  setGeo(r.value); pushHistory('Geometry: ' + r.value);
}));

// ---------- 画布左边的工具栏 ----------
// 每个工具一个按钮；有些工具只在特定模式下可用：「打乱」= 格子模式 + 几何选了打乱；「抽拉」「选色」= 手工编织
const toolBtns = [...document.querySelectorAll('.tbtn')];
function toolAvailable(btn) {
  const need = btn.dataset.need;
  return !need || (need === 'grid-shuffle' && MODE === 'grid' && GEO === 'shuffle') || (need === 'hand' && MODE === 'hand');
}
function syncToolUI() {
  toolBtns.forEach(b => { b.hidden = !toolAvailable(b); });
  const cur = toolBtns.find(b => b.dataset.tool === tool);
  if (tool !== 'none' && (!cur || cur.hidden)) exitTool();
  syncToolButtons();
}
function syncToolButtons() {                                       // 高亮当前工具，并显示 / 隐藏上方的工具选项条
  toolBtns.forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  const bar = $('toolOpts');
  bar.hidden = tool === 'none';
  bar.querySelectorAll('.opt').forEach(o => { o.hidden = !o.dataset.tools.split(' ').includes(tool); });
  $('brushWrap').hidden = tool !== 'brush';
  $('snapWrap').hidden = MODE !== 'grid';
  $('regDel').hidden = tool !== 'select';
}
toolBtns.forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tool;
  if (t === 'none' || tool === t) exitTool(); else setTool(t);     // 再点一次同一个工具 = 退出
}));
$('toolDone').addEventListener('click', exitTool);

// ---------- 每个滑条后面加一个数值框：拖滑条数字跟着变，直接输入数字滑条也跟着动 ----------
const numBoxes = [];
const fmtNum = v => String(Math.round(+v * 1000) / 1000);
document.querySelectorAll('aside input[type=range], #toolOpts input[type=range]').forEach(r => {
  const row = document.createElement('div');
  row.className = 'rangerow';
  r.parentNode.insertBefore(row, r);
  row.appendChild(r);
  const n = document.createElement('input');
  n.type = 'number'; n.className = 'num'; n.min = r.min; n.max = r.max; n.step = r.step || 'any'; n.value = fmtNum(r.value);
  row.appendChild(n);
  numBoxes.push([r, n]);
  n.addEventListener('input', () => {
    if (n.value === '' || isNaN(+n.value)) return;
    r.value = n.value;                                            // 滑条会自己限制在它的范围内
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  n.addEventListener('change', () => {
    r.value = n.value === '' ? r.value : n.value;
    n.value = fmtNum(r.value);
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  r.addEventListener('input', () => { if (document.activeElement !== n) n.value = fmtNum(r.value); });
});
function syncNums() {                                              // 撤销 / 预设等“用程序改了滑条”的情况，数值框也要跟上
  for (const [r, n] of numBoxes) if (document.activeElement !== n && n.value !== fmtNum(r.value)) n.value = fmtNum(r.value);
}
