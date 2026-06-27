// commands.rs — Tauri 命令层（对应 ecutauto_lib::services::api::commands）
// 复刻原命令名：video_mixing_process / _cancel / _progress(event) + subtitle_recognize

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::dedup::{sample, DedupRanges};
use crate::ffmpeg::{concat_segments, process_segment};

/// 取消标志，注册为 Tauri 全局状态。
#[derive(Default)]
pub struct CancelFlag(pub Arc<AtomicBool>);

/// 混剪请求（MixProcessRequest 的精简版，字段名对齐逆向蓝图）。
#[derive(Debug, Deserialize)]
pub struct MixProcessRequest {
    pub material_paths: Vec<String>,
    pub output_dir: String,
    #[serde(default = "default_w")]
    pub canvas_w: u32,
    #[serde(default = "default_h")]
    pub canvas_h: u32,
    #[serde(default = "default_count")]
    pub output_count: u32,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default)]
    pub allow_material_reuse: bool,
}
fn default_w() -> u32 { 1080 }
fn default_h() -> u32 { 1920 }
fn default_count() -> u32 { 3 }
fn default_fps() -> u32 { 30 }

/// 进度事件载荷（对应 *_progress 事件）。
#[derive(Debug, Clone, Serialize)]
pub struct MixProgress {
    pub output_index: u32,
    pub output_total: u32,
    pub stage_percent: f32,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MixResult {
    pub outputs: Vec<String>,
}

/// 启动批量混剪。立即返回，后台线程跑，通过事件推送进度。
#[tauri::command]
pub fn video_mixing_process(
    app: AppHandle,
    req: MixProcessRequest,
    cancel: State<CancelFlag>,
) -> Result<MixResult, String> {
    cancel.0.store(false, Ordering::Relaxed);
    let flag = cancel.0.clone();

    if req.material_paths.is_empty() {
        return Err("素材为空".into());
    }
    let out_dir = PathBuf::from(&req.output_dir);
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let work = out_dir.join(".work");

    let mut outputs = Vec::new();
    for idx in 0..req.output_count {
        if flag.load(Ordering::Relaxed) {
            return Err("已取消".into());
        }
        let seg_dir = work.join(format!("out{idx}"));
        fs::create_dir_all(&seg_dir).map_err(|e| e.to_string())?;

        let mut segs = Vec::new();
        let ranges = DedupRanges::default();
        for (i, mat) in req.material_paths.iter().enumerate() {
            let params = sample(&ranges); // ★ 每段独立随机
            let seg = seg_dir.join(format!("seg{i}.ts"));
            let seg_s = seg.to_string_lossy().to_string();
            let app2 = app.clone();
            process_segment(
                mat, &seg_s, &params, req.canvas_w, req.canvas_h, req.fps, &flag,
                move |pct| {
                    let _ = app2.emit(
                        "video_mixing_progress",
                        MixProgress {
                            output_index: idx,
                            output_total: req.output_count,
                            stage_percent: pct,
                            stage: format!("段 {i}"),
                        },
                    );
                },
            )?;
            segs.push(seg_s);
        }

        let final_path = out_dir.join(format!("mix_{:02}.mp4", idx + 1));
        let final_s = final_path.to_string_lossy().to_string();
        concat_segments(&segs, &final_s, &seg_dir, &flag)?;
        outputs.push(final_s);

        let _ = app.emit(
            "video_mixing_progress",
            MixProgress {
                output_index: idx + 1,
                output_total: req.output_count,
                stage_percent: 1.0,
                stage: "完成".into(),
            },
        );
    }
    let _ = fs::remove_dir_all(&work);
    Ok(MixResult { outputs })
}

/// 取消进行中的混剪。
#[tauri::command]
pub fn video_mixing_cancel(cancel: State<CancelFlag>) {
    cancel.0.store(true, Ordering::Relaxed);
}

/// 字幕识别（ASR）。基础版返回未启用提示；开启 `asr` feature 后走 providers::local_asr。
#[tauri::command]
pub fn subtitle_recognize(_audio_path: String) -> Result<Vec<crate::providers::local_asr::SubtitleFrame>, String> {
    crate::providers::local_asr::recognize(&_audio_path)
}
