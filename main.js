// ===================== 初始化（所有模块加载完之后执行）=====================
applyLang();
// 画布旁的工具选项不在表单里，浏览器刷新时可能会“记住”上次的选择，这里统一回到默认值
document.querySelector('input[name=act][value=add]').checked = true;
document.querySelector('input[name=layer][value=A]').checked = true;      // 图层选择在表单外面，刷新时浏览器可能记住上次的选择
document.querySelector('input[name=shtarget][value=cell]').checked = true;
$('snap').checked = true; $('brush').value = 80;
cfInit();
setMode('grid');
setGeo('off');
syncTile();
syncAdjUI();
syncToolUI();
render();
pushHistory('Start');
sessionCheck();

var __mainLoaded = true;   // 给 index.html 里的“缺少文件”检查用
