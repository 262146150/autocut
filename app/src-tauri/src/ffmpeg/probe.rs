// ffmpeg/probe.rs — ffprobe 探测（对应 ecutauto_lib::ffmpeg::probe）

use std::process::Command;

use super::executor::ffprobe_bin;

fn probe(args: &[&str]) -> Option<String> {
    let out = Command::new(ffprobe_bin()).args(args).output().ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

/// 是否含音频流。
pub fn has_audio(path: &str) -> bool {
    probe(&[
        "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
        "-of", "csv=p=0", path,
    ])
    .map(|s| !s.is_empty())
    .unwrap_or(false)
}

/// 时长（秒）。
pub fn duration_secs(path: &str) -> f64 {
    probe(&[
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path,
    ])
    .and_then(|s| s.parse().ok())
    .unwrap_or(0.0)
}

/// 分辨率 (w, h)。
pub fn resolution(path: &str) -> Option<(u32, u32)> {
    let s = probe(&[
        "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x", path,
    ])?;
    let (w, h) = s.split_once('x')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}
