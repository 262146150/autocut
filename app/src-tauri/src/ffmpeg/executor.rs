// ffmpeg/executor.rs — 驱动 ffmpeg 子进程，解析进度，支持取消（对应 ecutauto_lib::ffmpeg::executor）

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// 解析 ffmpeg 路径：优先用打包的同款二进制，否则系统 PATH。
pub fn ffmpeg_bin() -> String {
    bundled("ffmpeg").unwrap_or_else(|| "ffmpeg".into())
}
pub fn ffprobe_bin() -> String {
    bundled("ffprobe").unwrap_or_else(|| "ffprobe".into())
}

fn bundled(name: &str) -> Option<String> {
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" };
    // 复刻打包结构：Resources/FFmpeg/macOS/<arch>/<name>
    let p: PathBuf = [
        "Resources", "FFmpeg", "macOS", arch, name,
    ]
    .iter()
    .collect();
    if p.exists() {
        Some(p.to_string_lossy().into())
    } else {
        None
    }
}

fn parse_time_secs(line: &str) -> Option<f64> {
    // 形如 "time=00:00:03.20"
    let i = line.find("time=")? + 5;
    let t = &line[i..i + 11.min(line.len() - i)];
    let mut it = t.split(':');
    let h: f64 = it.next()?.parse().ok()?;
    let m: f64 = it.next()?.parse().ok()?;
    let s: f64 = it.next()?.trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// 运行一次 ffmpeg。total_secs 用于换算进度百分比；cancel 置位则杀进程。
pub fn run_ffmpeg<F: FnMut(f32)>(
    args: &[String],
    total_secs: f64,
    cancel: &Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<(), String> {
    let mut child = Command::new(ffmpeg_bin())
        .args(args)
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn ffmpeg 失败: {e}"))?;

    let stderr = child.stderr.take().ok_or("无法读取 ffmpeg stderr")?;
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Err("已取消".into());
        }
        if total_secs > 0.0 {
            if let Some(t) = parse_time_secs(&line) {
                on_progress(((t / total_secs) as f32).clamp(0.0, 1.0));
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        on_progress(1.0);
        Ok(())
    } else {
        Err(format!("ffmpeg 退出码 {:?}", status.code()))
    }
}
