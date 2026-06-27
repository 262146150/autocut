// ffmpeg/filters.rs — 滤镜构造器（Rust 版，与 poc/filters.mjs 等价，源自逆向文档 01）

use serde::{Deserialize, Serialize};

/// 去重参数（对应 ECutAuto 的 PictureAdjustParams / RotateFlipParams，全部随机区间采样）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DedupParams {
    pub hflip: bool,
    pub vflip: bool,
    pub crop_scale: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub noise: u32,
    pub vignette: u32,
    pub tempo: f32,
}

/// 去重线性链（doc01 §2），作用在 split 之前。
pub fn dedup_video_chain(p: &DedupParams) -> String {
    let mut parts: Vec<String> = Vec::new();
    if p.hflip {
        parts.push("hflip".into());
    }
    if p.vflip {
        parts.push("vflip".into());
    }
    if p.crop_scale < 1.0 {
        parts.push(format!("crop=iw*{:.4}:ih*{:.4}", p.crop_scale, p.crop_scale));
    }
    parts.push(format!(
        "eq=brightness={:.4}:contrast={:.3}:saturation={:.3}",
        p.brightness, p.contrast, p.saturation
    ));
    parts.push(format!("noise=alls={}:allf=t", p.noise));
    parts.push(format!("vignette=PI/{}", p.vignette));
    parts.join(",")
}

/// 画布适配 / 背景虚化填充（doc01 §1，原样参数）。从 in_label 读，写到 out_label。
pub fn blur_fill_graph(in_label: &str, out_label: &str, w: u32, h: u32, fps: u32) -> String {
    let (pw, ph) = if w >= h { (320, 180) } else { (180, 320) };
    [
        format!("[{in_label}]split[original][copy]"),
        format!(
            "[copy]scale={pw}:{ph}:force_original_aspect_ratio=increase:flags=fast_bilinear,\
             gblur=sigma=40,scale={w}:{h}:flags=fast_bilinear[blurred]"
        ),
        format!(
            "[original]scale={w}:{h}:force_original_aspect_ratio=decrease:\
             force_divisible_by=2:flags=lanczos[scaled]"
        ),
        format!(
            "[blurred][scaled]overlay=floor((main_w-overlay_w)/2/2)*2:floor((main_h-overlay_h)/2/2)*2,\
             setsar=1,fps={fps},format=yuv420p,\
             setparams=colorspace=bt709:color_trc=bt709:color_primaries=bt709[{out_label}]"
        ),
    ]
    .join(";")
}

/// 音频链：变速 + 统一格式（doc01 §10）。
pub fn audio_graph(in_label: &str, out_label: &str, p: &DedupParams) -> String {
    let mut parts =
        vec!["aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo".to_string()];
    if (p.tempo - 1.0).abs() > f32::EPSILON {
        parts.push(format!("atempo={:.3}", p.tempo));
    }
    parts.push("asetpts=PTS-STARTPTS".to_string());
    format!("[{in_label}]{}[{out_label}]", parts.join(","))
}

/// 组装单素材完整 filter_complex。返回 (filter, vmap, amap)。
pub fn build_clip_filter_complex(
    p: &DedupParams,
    w: u32,
    h: u32,
    fps: u32,
    has_audio: bool,
) -> (String, String, Option<String>) {
    let mut chains = vec![format!("[0:v]{}[pre]", dedup_video_chain(p))];
    chains.push(blur_fill_graph("pre", "outv", w, h, fps));
    let amap = if has_audio {
        chains.push(audio_graph("0:a", "outa", p));
        Some("[outa]".to_string())
    } else {
        None
    };
    (chains.join(";"), "[outv]".to_string(), amap)
}
