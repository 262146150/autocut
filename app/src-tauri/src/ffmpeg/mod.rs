// ffmpeg/mod.rs — FFmpeg 子系统（对应 ecutauto_lib::ffmpeg）

pub mod executor;
pub mod filters;
pub mod probe;

use std::fs;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use executor::run_ffmpeg;
use filters::{build_clip_filter_complex, DedupParams};

/// 预处理单个素材为统一规格的 .ts（去重 + 画布 + 收尾）。
pub fn process_segment(
    input: &str,
    seg_out: &str,
    p: &DedupParams,
    w: u32,
    h: u32,
    fps: u32,
    cancel: &Arc<AtomicBool>,
    on_progress: impl FnMut(f32),
) -> Result<(), String> {
    let has_audio = probe::has_audio(input);
    let total = probe::duration_secs(input);
    let (filter, vmap, amap) = build_clip_filter_complex(p, w, h, fps, has_audio);

    let mut args: Vec<String> = vec![
        "-y".into(), "-i".into(), input.into(),
        "-filter_complex".into(), filter, "-map".into(), vmap,
    ];
    if let Some(a) = amap {
        args.push("-map".into());
        args.push(a);
    }
    args.extend(
        [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
            "-f", "mpegts", seg_out,
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    run_ffmpeg(&args, total, cancel, on_progress)
}

/// demuxer 拼接（doc01 §4-B）。
pub fn concat_segments(
    segs: &[String],
    out: &str,
    work_dir: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let list = work_dir.join("concat_list.txt");
    let body = segs
        .iter()
        .map(|s| format!("file '{s}'"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&list, body).map_err(|e| e.to_string())?;

    let args: Vec<String> = [
        "-y", "-f", "concat", "-safe", "0", "-i", &list.to_string_lossy(),
        "-c", "copy", "-movflags", "+faststart", out,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    run_ffmpeg(&args, 0.0, cancel, |_| {})
}
