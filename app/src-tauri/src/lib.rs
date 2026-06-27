// lib.rs — Tauri 应用入口（对应 ecutauto_lib 顶层）

mod commands;
mod dedup;
mod ffmpeg;
mod providers;

use commands::CancelFlag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(CancelFlag::default())
        .invoke_handler(tauri::generate_handler![
            commands::video_mixing_process,
            commands::video_mixing_cancel,
            commands::subtitle_recognize,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用出错");
}
