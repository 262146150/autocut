// dedup.rs — 去重参数随机化（对应 ECutAuto "出 N 条互不相同" 的核心）

use rand::Rng;

use crate::ffmpeg::filters::DedupParams;

/// 随机区间配置（对应逆向出的 min/max 字段族）。
pub struct DedupRanges {
    pub brightness: (f32, f32),
    pub contrast: (f32, f32),
    pub saturation: (f32, f32),
    pub crop_scale: (f32, f32),
    pub vignette: (u32, u32),
    pub noise: (u32, u32),
    pub tempo: (f32, f32),
    pub flip_prob: f64,
}

impl Default for DedupRanges {
    fn default() -> Self {
        Self {
            brightness: (-0.03, 0.03),
            contrast: (0.97, 1.03),
            saturation: (0.95, 1.05),
            crop_scale: (0.96, 1.0),
            vignette: (25, 40),
            noise: (1, 3),
            tempo: (0.97, 1.03),
            flip_prob: 0.0,
        }
    }
}

/// 为单条成片采样一组去重参数。
pub fn sample(ranges: &DedupRanges) -> DedupParams {
    let mut r = rand::thread_rng();
    DedupParams {
        hflip: r.gen_bool(ranges.flip_prob),
        vflip: false,
        crop_scale: r.gen_range(ranges.crop_scale.0..=ranges.crop_scale.1),
        brightness: r.gen_range(ranges.brightness.0..=ranges.brightness.1),
        contrast: r.gen_range(ranges.contrast.0..=ranges.contrast.1),
        saturation: r.gen_range(ranges.saturation.0..=ranges.saturation.1),
        noise: r.gen_range(ranges.noise.0..=ranges.noise.1),
        vignette: r.gen_range(ranges.vignette.0..=ranges.vignette.1),
        tempo: r.gen_range(ranges.tempo.0..=ranges.tempo.1),
    }
}
