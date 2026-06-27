// dedup.mjs — 去重参数随机化（ECutAuto "批量出 N 条互不相同" 的核心：参数随机采样，不是 AI）
// 每条成片对每个滤镜从 (min,max) 区间随机取值。

/** 可配置的随机区间（对应逆向出的 PictureAdjustParams 等 min/max 字段）。 */
export const DEFAULT_RANGES = {
  brightness: [-0.03, 0.03],   // eq brightness
  contrast: [0.97, 1.03],      // eq contrast
  saturation: [0.95, 1.05],    // eq saturation
  cropScale: [0.96, 1.0],      // 微裁剪
  vignette: [25, 40],          // vignette=PI/N （N 越大越弱）
  noise: [1, 3],               // noise alls
  tempo: [0.97, 1.03],         // 变速（同时影响时长）
  flipProb: 0,                 // 默认不镜像；需要时再在 UI 中显式开启
};

function rand(min, max) {
  return min + Math.random() * (max - min);
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

/** 为「第 index 条成片」生成一组确定但各不相同的去重参数。 */
export function sampleDedupParams(ranges = DEFAULT_RANGES) {
  return {
    brightness: rand(...ranges.brightness),
    contrast: rand(...ranges.contrast),
    saturation: rand(...ranges.saturation),
    cropScale: rand(...ranges.cropScale),
    vignette: randInt(...ranges.vignette),
    noise: randInt(...ranges.noise),
    tempo: rand(...ranges.tempo),
    hflip: Math.random() < ranges.flipProb,
    vflip: false,
  };
}
