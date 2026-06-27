// providers/local_asr.rs — 本地语音识别（对应 ecutauto_lib::services::providers::local_asr）
// 复刻：sherpa-onnx + model.1.onnx(ASR) + libonnxruntime。重活外包给 sherpa-rs。

use serde::Serialize;

/// 字幕帧（对应逆向出的 SubtitleFrame，4 字段）。
#[derive(Debug, Clone, Serialize)]
pub struct SubtitleFrame {
    pub start: f32,
    pub end: f32,
    pub text: String,
    pub confidence: f32,
}

#[cfg(not(feature = "asr"))]
pub fn recognize(_audio_path: &str) -> Result<Vec<SubtitleFrame>, String> {
    Err("ASR 未启用：以 `--features asr` 构建，并放置 models/model.1.onnx + libonnxruntime".into())
}

#[cfg(feature = "asr")]
pub fn recognize(audio_path: &str) -> Result<Vec<SubtitleFrame>, String> {
    // 复刻 ECutAuto 的本地 ASR 路径（sherpa-onnx 离线识别 + VAD 分句）。
    // 模型与 ECutAuto 同源：FunASR/Paraformer 系，从 ModelScope 获取。
    use sherpa_rs::transcribe::offline::{OfflineRecognizer, OfflineRecognizerConfig};

    let config = OfflineRecognizerConfig {
        model: "models/model.1.onnx".into(),
        tokens: "models/tokens.txt".into(),
        ..Default::default()
    };
    let recognizer = OfflineRecognizer::new(config).map_err(|e| e.to_string())?;

    // 1) 用 ffmpeg 抽 16k 单声道 PCM（实际项目里调 ffmpeg::executor）
    // 2) 可选：Silero/TEN-VAD 切分人声片段
    // 3) 逐段识别，拼成带时间戳的字幕帧
    let samples = decode_pcm_16k_mono(audio_path)?;
    let text = recognizer.transcribe(16000, &samples).map_err(|e| e.to_string())?;

    Ok(vec![SubtitleFrame {
        start: 0.0,
        end: samples.len() as f32 / 16000.0,
        text,
        confidence: 1.0,
    }])
}

#[cfg(feature = "asr")]
fn decode_pcm_16k_mono(_path: &str) -> Result<Vec<f32>, String> {
    // TODO: ffmpeg -i <path> -ac 1 -ar 16000 -f f32le -  →  Vec<f32>
    Ok(Vec::new())
}
