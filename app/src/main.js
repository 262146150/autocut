// 前端逻辑：调用后端命令 + 监听进度事件（对应 Tauri invoke / listen）
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

const $ = (id) => document.getElementById(id);
let materials = [];
let outputDir = "";

function log(msg) {
  $("log").textContent += msg + "\n";
  $("log").scrollTop = $("log").scrollHeight;
}

$("pick").onclick = async () => {
  const sel = await open({
    multiple: true,
    filters: [{ name: "视频", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }],
  });
  if (sel) {
    materials = Array.isArray(sel) ? sel : [sel];
    $("files").textContent = `${materials.length} 个素材`;
  }
};

$("pickOut").onclick = async () => {
  const dir = await open({ directory: true });
  if (dir) {
    outputDir = dir;
    $("outDir").textContent = dir;
  }
};

// 监听后台进度事件（对应 ECutAuto 的 video_mixing_progress）
listen("video_mixing_progress", (e) => {
  const p = e.payload;
  $("prog").style.width = `${Math.round(p.stage_percent * 100)}%`;
  if (p.stage === "完成") log(`✓ 成片 ${p.output_index}/${p.output_total} 完成`);
});

$("run").onclick = async () => {
  if (!materials.length) return log("请先选择素材");
  if (!outputDir) return log("请先选择输出目录");
  log("开始混剪…");
  try {
    const res = await invoke("video_mixing_process", {
      req: {
        material_paths: materials,
        output_dir: outputDir,
        canvas_w: +$("w").value,
        canvas_h: +$("h").value,
        output_count: +$("count").value,
        fps: +$("fps").value,
        allow_material_reuse: true,
      },
    });
    log(`完成，共 ${res.outputs.length} 条：`);
    res.outputs.forEach((o) => log("  " + o));
  } catch (err) {
    log("失败：" + err);
  }
};

$("cancel").onclick = () => invoke("video_mixing_cancel");
