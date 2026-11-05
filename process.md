## machine流程：
image A
↓
imageC（pixel图/网点来源）→ 灰度化 → 抖动/网点算法 → 1-bit 蒙版 M
↑
image B

输出 = M × 图A  +  (1−M) × 图B     （正型 / 负型 = M 或反相的 M）

create canvas
导入imageA、imageB
导入imageC生成pixel图
调整图片-导出

图层面板：A/B/蒙版C 
    其中蒙版有"预览模式"（单独看黑白蒙版 ↔ 看合成结果）。
    正负型其实只是一个 Invert 开关，不用做成两套东西。  
    内置一个"棋盘格"作为 C 的默认值，没有第三张图也能用。

## 功能模块：

# 阶段一：
1-导入图片A/B/C
2-canvas尺寸（px/...）
3-蒙版生成：算法选择（Threshold / Bayer / Random）、Size、Threshold、Invert
4-每个图层的缩放和位置（拖动 + 滑块）//调整图片大小+比例
5-导出/下载图片（PNG/JPG/WEBP/*PDF）

# 阶段二
网点形状（圆/方）、网点角度、A/B 各自的 Contrast/Brightness、Grain、Posterize

先别做：SVG/PDF 导出（位图合成后转矢量意义不大，除非另做描摹）、色阶曲线、glitch、mm 单位、Blur。这些可以让用户在 Photoshop 里预处理，或者之后再加。


A/B：
 -- 参考图像处理工具 --
→图像预处理
posterize
调整色阶、曲线、对比度？
黑点、白点
Grain
Blur
模糊？
glitch？


C：
 -- 参考bitmap generator --
-Dither抖动方式：bitmap/ramdom/Bayer2X2/Floyd-Steinberg... - 选择
**Pixel图案（圆、方、else？）
-Cell Size（单个格子大小/网格密度
-threshold（pixel数量/控制黑白占比（决定 A 和 B 各露出多少）/临界点）
-Stretch factor（拉伸系数/横向/纵向拉伸格子）
-另外建议加一个 Blur/预模糊 C（作用在 C 上）：先把 C 模糊再抖动，蒙版会更平滑，是控制效果的重要旋钮。

*Halftone（半色调网点）：圆点/方点/线，大小随亮度变化，需要 Angle（角度），你漏了这个，而它对网点质感很关键。？


4. 技术建议
一个小技巧：蒙版先在低分辨率下计算（Size 滑块 = 降采样倍数），再用 nearest-neighbor 放大到画布大小，这样得到清晰的像素格，计算量也小，滑块能实时响应。
Bayer/Random/网点用 WebGL shader 可以做到全实时，但 Floyd-Steinberg 这类误差扩散是顺序算法，不适合 shader。所以 MVP 建议用 纯 HTML + Canvas 2D（几百行 JS 就够），之后想要更丝滑再迁移 WebGL。
合成就是逐像素 lerp(B, A, M)，非常轻。
蒙版不一定非要硬 1-bit。加一个 Softness/Feather 滑块，让黑白边缘做一点过渡，会得到介于"编织"和"叠化"之间的效果


