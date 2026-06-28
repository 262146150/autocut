import { useState } from "react";
import type { ModuleDef } from "../data/modules";
import { inspectMaterials, segmentMaterials, type MaterialFolderInfo, type SegmentClip } from "../api";

function basename(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function fmtSec(value: number) {
  return `${Math.max(0, value).toFixed(1)}s`;
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" tabIndex={0} aria-label={text}>
      ?
      <span className="help-tip-pop">{text}</span>
    </span>
  );
}

export default function SmartSegment({ mod }: { mod: ModuleDef }) {
  const [folder, setFolder] = useState("");
  const [folderInfo, setFolderInfo] = useState<MaterialFolderInfo | null>(null);
  const [segments, setSegments] = useState<SegmentClip[]>([]);
  const [selected, setSelected] = useState<SegmentClip | null>(null);
  const [threshold, setThreshold] = useState(35);
  const [segmentMode, setSegmentMode] = useState<"material" | "reuse">("material");
  const [minDuration, setMinDuration] = useState(1.2);
  const [targetDuration, setTargetDuration] = useState(12);
  const [maxDuration, setMaxDuration] = useState(25);
  const [detectFps, setDetectFps] = useState(12);
  const [cutPadding, setCutPadding] = useState(0.35);
  const [speechProtection, setSpeechProtection] = useState(true);
  const [force, setForce] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [manifest, setManifest] = useState("");
  const [exportDir, setExportDir] = useState("");
  const [engine, setEngine] = useState("");

  const switchSegmentMode = (mode: "material" | "reuse") => {
    setSegmentMode(mode);
    if (mode === "reuse") {
      setMinDuration(4);
      setTargetDuration(15);
      setMaxDuration(30);
    } else {
      setMinDuration(1.2);
      setTargetDuration(12);
      setMaxDuration(25);
    }
  };

  const onImport = async () => {
    const next = prompt("输入素材文件夹或单个视频文件的本机路径", folder);
    if (next === null) return;
    const input = next.trim();
    if (!input) {
      setStatus("请填写素材文件夹或视频文件路径");
      return;
    }
    setFolder(input);
    setFolderInfo(null);
    setSegments([]);
    setSelected(null);
    setManifest("");
    setExportDir("");
    setEngine("");
    setStatus("正在读取素材…");
    try {
      const info = await inspectMaterials(input);
      setFolderInfo(info);
      setStatus(`已导入 ${info.count} 个视频素材`);
    } catch (err) {
      setStatus("导入失败：" + (err as Error).message);
    }
  };

  const onSegment = async () => {
    if (!folder || running) return;
    setRunning(true);
    setSegments([]);
    setSelected(null);
    setManifest("");
    setExportDir("");
    setEngine("");
    setProgress(0);
    setStatus("智能分割准备中…");
    try {
      await segmentMaterials({
        inputs: folder,
        threshold: threshold / 100,
        minDurationSec: minDuration,
        targetSegmentSec: targetDuration,
        maxSegmentSec: maxDuration,
        detectFps,
        cutPaddingSec: cutPadding,
        speechProtection,
        segmentMode,
        speechPadSec: 0.2,
        speechMaxShiftSec: 1.5,
        force,
      }, (event) => {
        if (event.type === "start") {
          setStatus(`开始分析 ${event.total} 个视频`);
          setProgress(3);
        } else if (event.type === "segment_file") {
          const total = Math.max(1, event.total);
          setStatus(`检测镜头：${event.index}/${event.total} ${event.name}`);
          setProgress(Math.min(92, Math.round((event.index / total) * 82)));
        } else if (event.type === "segment_done") {
          setStatus(`已切出片段：${event.name}`);
        } else if (event.type === "segment_log") {
          setStatus(event.msg);
        } else if (event.type === "done") {
          setEngine(event.engine);
          setManifest(event.manifest);
          setExportDir(event.exportDir ?? "");
          setSegments(event.segments);
          setSelected(event.segments[0] ?? null);
          setProgress(100);
          setStatus(`${event.reused ? "复用片段库" : "分割完成"}，共 ${event.segments.length} 个片段`);
        } else if (event.type === "error") {
          setStatus("分割失败：" + event.msg);
        }
      });
    } catch (err) {
      setStatus("分割失败：" + (err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modwrap">
      <div className="modbar">
        <div className="mod-title">
          <b>{mod.name}</b>
          <span>素材预处理 · 镜头片段库</span>
        </div>
      </div>
      <div className="segment-page">
        <section className="segment-col segment-left">
          <div className="box segment-box">
            <div className="box-h">
              <button className="import-btn" type="button" onClick={onImport}>导入素材</button>
              <button className="icon-btn text-btn" type="button" onClick={() => {
                setFolder("");
                setFolderInfo(null);
                setSegments([]);
                setSelected(null);
                setManifest("");
                setExportDir("");
                setEngine("");
                setProgress(0);
                setStatus("");
              }}>清空</button>
            </div>
            {!folderInfo ? (
              <div className="empty">
                <div className="t">暂无素材</div>
                <div className="s">导入原始视频文件夹或单个视频后开始分割</div>
              </div>
            ) : (
              <div className="segment-materials">
                <div className="folder-row">
                  <strong title={folder}>{folderInfo.name || basename(folder)}</strong>
                  <span className="folder-count">{folderInfo.count}</span>
                </div>
                <div className="clip-list">
                  {folderInfo.clips.map((clip) => (
                    <div className="clip-row" key={clip.path} title={clip.path}>
                      <span>▻</span>
                      <b>{clip.name}</b>
                    </div>
                  ))}
                </div>
                <div className="folder-path">{folder}</div>
              </div>
            )}
          </div>
        </section>

        <section className="segment-col segment-main">
          <div className="segment-preview">
            {selected ? (
              <video key={selected.path} src={selected.url} controls />
            ) : (
              <div className="preview-empty">选择片段后预览</div>
            )}
          </div>
          <div className="box segment-result">
            <div className="box-h">
              <span>片段库</span>
              <span className="muted">{segments.length ? `${segments.length} 个片段` : "尚未生成"}</span>
            </div>
            {segments.length ? (
              <div className="segment-table">
                {segments.map((segment) => (
                  <button
                    className={`segment-row ${selected?.path === segment.path ? "active" : ""}`}
                    key={segment.path}
                    type="button"
                    onClick={() => setSelected(segment)}
                    title={segment.path}
                  >
                    <span>{segment.name}</span>
                    <em>{segment.sourceName}</em>
                    <strong>{fmtSec(segment.startSec)} - {fmtSec(segment.endSec)}</strong>
                    <i>{fmtSec(segment.durationSec)}</i>
                  </button>
                ))}
              </div>
            ) : (
              <div className="body">
                <div>暂无片段</div>
                <div className="s muted">点击右侧开始分割后会生成可复用片段库</div>
              </div>
            )}
          </div>
        </section>

        <aside className="segment-col segment-settings">
          <div className="box segment-box">
            <div className="box-h">分割设置</div>
            <div className="segment-settings-body">
              <div className="segment-field segment-field-wide">
                <span>分割模式 <HelpTip text="原始素材会尽量按镜头边界素材化；成片复用会合并频繁转场，只在目标时长附近保守切分。" /></span>
                <div className="mini-seg compact">
                  <button className={segmentMode === "material" ? "active" : ""} type="button" onClick={() => switchSegmentMode("material")}>原始素材</button>
                  <button className={segmentMode === "reuse" ? "active" : ""} type="button" onClick={() => switchSegmentMode("reuse")}>成片复用</button>
                </div>
                <b>{segmentMode === "reuse" ? "保守" : "素材化"}</b>
              </div>
              <label className="segment-field">
                <span>镜头阈值 <HelpTip text="控制画面变化多大才算一个镜头切点。数值越低切得越细，数值越高切得越少。" /></span>
                <input type="range" min={10} max={80} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                <b>{(threshold / 100).toFixed(2)}</b>
              </label>
              <label className="segment-field">
                <span>最小时长 <HelpTip text="过滤过短片段。低于该时长的相邻片段会尽量合并，避免生成碎片化素材。" /></span>
                <input className="inp" type="number" min={segmentMode === "reuse" ? 4 : 0.4} step={0.1} value={minDuration} onChange={(e) => setMinDuration(Number(e.target.value) || (segmentMode === "reuse" ? 4 : 1.2))} />
                <b>秒</b>
              </label>
              <label className="segment-field">
                <span>目标时长 <HelpTip text="没有明显镜头切点，或口播/直播持续说话时，系统会尽量按这个时长拆分。" /></span>
                <input className="inp" type="number" min={segmentMode === "reuse" ? 8 : 1} step={1} value={targetDuration} onChange={(e) => setTargetDuration(Number(e.target.value) || (segmentMode === "reuse" ? 15 : 12))} />
                <b>秒</b>
              </label>
              <label className="segment-field">
                <span>最大时长 <HelpTip text="单个片段允许的最长时长。超过后会强制寻找合适位置切开，防止长视频无法素材化。" /></span>
                <input className="inp" type="number" min={segmentMode === "reuse" ? 12 : 2} step={1} value={maxDuration} onChange={(e) => setMaxDuration(Number(e.target.value) || (segmentMode === "reuse" ? 30 : 25))} />
                <b>秒</b>
              </label>
              <div className="segment-field segment-field-wide">
                <span>检测速度 <HelpTip text="快速模式按 12fps 检测，速度更快；精准模式按原帧率检测，耗时更长。" /></span>
                <div className="mini-seg compact">
                  <button className={detectFps === 12 ? "active" : ""} type="button" onClick={() => setDetectFps(12)}>快速</button>
                  <button className={detectFps === 0 ? "active" : ""} type="button" onClick={() => setDetectFps(0)}>精准</button>
                </div>
                <b>{detectFps === 0 ? "原帧" : `${detectFps}fps`}</b>
              </div>
              <label className="segment-field">
                <span>切点缓冲 <HelpTip text="在切点前后额外保留一点画面。数值越大越不容易断句，但片段之间会有更多重叠。" /></span>
                <input className="inp" type="number" min={0} max={2} step={0.05} value={cutPadding} onChange={(e) => setCutPadding(Number(e.target.value) || 0)} />
                <b>秒</b>
              </label>
              <div className="segment-setting-row">
                <span>语音保护 <HelpTip text="使用 sherpa-onnx VAD 检测人声，把切点尽量避开说话中间。长口播仍会按最大时长拆分。" /></span>
                <div className="mini-seg compact">
                  <button className={speechProtection ? "active" : ""} type="button" onClick={() => setSpeechProtection(true)}>启用</button>
                  <button className={!speechProtection ? "active" : ""} type="button" onClick={() => setSpeechProtection(false)}>关闭</button>
                </div>
              </div>
              <label className="segment-check">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>强制重新分割 <HelpTip text="忽略已有片段库缓存，重新检测和切片。调整参数后建议开启。" /></span>
              </label>
              <div className="segment-note">
                {segmentMode === "reuse"
                  ? "成片复用模式会合并频繁转场，只输出更长的复用片段，避免 AI 混剪时画面过碎。"
                  : "原始素材模式会用 TransNetV2 检测镜头，并用 sherpa-onnx VAD 避开人声切点。"}
              </div>
            </div>
          </div>
          <button className={`cta ${folder && !running ? "ready" : "disabled"}`} type="button" onClick={onSegment}>
            {!folder ? "请先导入素材" : running ? "分割中…" : "开始智能分割"}
          </button>
          {running || progress > 0 ? <div className="bar"><i style={{ width: `${progress}%` }} /></div> : null}
          <div className="status">{status}</div>
          {engine ? <div className="segment-meta">引擎：{engine}</div> : null}
          {exportDir ? <div className="export-dir" title={exportDir}>输出目录：{exportDir}</div> : null}
          {manifest ? <div className="export-dir" title={manifest}>片段库：{manifest}</div> : null}
        </aside>
      </div>
    </div>
  );
}
