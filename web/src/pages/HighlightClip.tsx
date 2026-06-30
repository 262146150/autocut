import { useState } from "react";
import type { ModuleDef } from "../data/modules";
import {
  generateHighlightClips,
  inspectMaterials,
  type HighlightClipItem,
  type HighlightCollectionItem,
  type MaterialClip,
  type MaterialFolderInfo,
  type MaterialLibraryRoot,
} from "../api";
import { ExportTaskDrawer, type ExportTaskItem } from "../components/ExportTaskDrawer";
import { MaterialSourcePicker } from "../components/MaterialSourcePicker";

function basename(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function fmtSec(value: number) {
  const sec = Math.max(0, Number(value) || 0);
  const min = Math.floor(sec / 60);
  const rest = Math.floor(sec % 60);
  return `${String(min).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function scoreText(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}分`;
}

export default function HighlightClip({ mod }: { mod: ModuleDef }) {
  const [sourcePath, setSourcePath] = useState("");
  const [srtPath, setSrtPath] = useState("");
  const [folderInfo, setFolderInfo] = useState<MaterialFolderInfo | null>(null);
  const [selectedSource, setSelectedSource] = useState<MaterialClip | null>(null);
  const [clips, setClips] = useState<HighlightClipItem[]>([]);
  const [collections, setCollections] = useState<HighlightCollectionItem[]>([]);
  const [selectedClip, setSelectedClip] = useState<HighlightClipItem | null>(null);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [minDuration, setMinDuration] = useState(60);
  const [maxDuration, setMaxDuration] = useState(360);
  const [minScore, setMinScore] = useState(65);
  const [maxClips, setMaxClips] = useState(8);
  const [maxCollections, setMaxCollections] = useState(2);
  const [enableAsr, setEnableAsr] = useState(true);
  const [addToLibrary, setAddToLibrary] = useState(true);
  const [exportQuality, setExportQuality] = useState<"standard" | "high" | "best">("high");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [exportDir, setExportDir] = useState("");
  const [manifest, setManifest] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskItems, setTaskItems] = useState<ExportTaskItem[]>([]);

  const importSource = async (input: string) => {
    const next = input.trim();
    if (!next) {
      setStatus("请填写视频文件或文件夹路径");
      return;
    }
    setSourcePath(next);
    setFolderInfo(null);
    setSelectedSource(null);
    setClips([]);
    setCollections([]);
    setSelectedClip(null);
    setExportDir("");
    setManifest("");
    setTaskItems([]);
    setProgress(0);
    setStatus("正在读取视频…");
    try {
      const info = await inspectMaterials(next);
      setFolderInfo(info);
      setSelectedSource(info.clips[0] ?? null);
      setStatus(`已导入 ${info.count} 个视频`);
    } catch (err) {
      setStatus("导入失败：" + (err as Error).message);
    }
  };

  const onImport = async () => {
    const next = prompt("输入长视频文件或文件夹的本机路径", sourcePath);
    if (next === null) return;
    await importSource(next);
  };

  const chooseMaterialRoot = async (root: MaterialLibraryRoot) => {
    setMaterialPickerOpen(false);
    await importSource(root.path);
  };

  const clearWorkspace = () => {
    setSourcePath("");
    setSrtPath("");
    setFolderInfo(null);
    setSelectedSource(null);
    setClips([]);
    setCollections([]);
    setSelectedClip(null);
    setStatus("");
    setProgress(0);
    setExportDir("");
    setManifest("");
    setTaskItems([]);
  };

  const chooseCollectionClip = (item: NonNullable<HighlightCollectionItem["items"]>[number]) => {
    const existing = clips.find((clip) => clip.id === item.id || clip.path === item.path);
    if (existing) {
      setSelectedClip(existing);
      return;
    }
    setSelectedClip({
      id: item.id,
      name: item.title,
      title: item.title,
      reason: "推荐分组片段",
      score: item.score ?? 0,
      sourcePath: item.path,
      sourceName: "推荐分组",
      startSec: 0,
      endSec: 0,
      durationSec: 0,
      timeRange: item.timeRange,
      path: item.path,
      url: `/api/media?path=${encodeURIComponent(item.path)}`,
    });
  };

  const openConfirm = () => {
    if (!sourcePath || running) return;
    setTaskOpen(true);
    setProgress(0);
    setTaskItems([]);
    setStatus("确认设置后开始高光切片");
  };

  const startGenerate = async () => {
    if (!sourcePath || running) return;
    setRunning(true);
    setClips([]);
    setCollections([]);
    setSelectedClip(null);
    setExportDir("");
    setManifest("");
    setTaskItems([]);
    setProgress(2);
    setStatus("准备高光切片…");
    try {
      await generateHighlightClips({
        inputs: sourcePath,
        srtPath,
        minDurationSec: minDuration,
        maxDurationSec: maxDuration,
        minScore: minScore / 100,
        maxClips,
        maxCollections,
        enableAsr,
        addToLibrary,
        exportQuality,
      }, (event) => {
        if (event.type === "start") {
          setStatus("开始处理视频");
          setProgress(4);
        } else if (event.type === "file") {
          const pct = Math.round((event.index / Math.max(1, event.total)) * 22);
          setStatus(`读取视频：${event.index}/${event.total} ${event.name}`);
          setProgress(Math.max(6, pct));
        } else if (event.type === "analysis" || event.type === "timeline") {
          setStatus(event.msg);
          setProgress((current) => Math.max(current, Math.min(52, current + 8)));
        } else if (event.type === "score") {
          setStatus(event.msg);
          setProgress((current) => Math.max(current, 60));
        } else if (event.type === "clip") {
          setStatus(`生成高光片段：${event.name}`);
          setProgress((current) => Math.max(current, 66));
        } else if (event.type === "clip_done") {
          setTaskItems((items) => [...items, {
            id: `clip-${event.index}`,
            name: event.title || event.name,
            status: "done",
            path: event.path,
            url: `/api/media?path=${encodeURIComponent(event.path)}`,
            meta: `${event.sourceName} · ${fmtSec(event.startSec)}-${fmtSec(event.endSec)} · ${scoreText(event.score)}`,
          }]);
          setProgress((current) => Math.min(88, current + 3));
        } else if (event.type === "collection") {
          setStatus(`整理分组：${event.title}`);
          setProgress((current) => Math.max(current, 90));
        } else if (event.type === "collection_done") {
          setTaskItems((items) => [...items, {
            id: `collection-${event.index}`,
            name: event.title,
            status: "done",
            path: event.path,
            meta: `${event.count} 个片段分组`,
          }]);
        } else if (event.type === "done") {
          setExportDir(event.exportDir);
          setManifest(event.manifest);
          setClips(event.clips);
          setCollections(event.collections);
          setSelectedClip(event.clips[0] ?? null);
          setProgress(100);
          setStatus(`高光切片完成：${event.clips.length} 个片段，${event.collections.length} 个分组${event.materialLibraryPath ? "，已加入素材仓库" : ""}`);
          setTaskItems([
            ...event.clips.map((clip) => ({
              id: clip.id,
              name: clip.title,
              status: "done" as const,
              path: clip.path,
              url: clip.url,
              meta: `${clip.sourceName} · ${fmtSec(clip.startSec)}-${fmtSec(clip.endSec)} · ${scoreText(clip.score)}`,
            })),
            ...event.collections.map((collection) => ({
              id: collection.id,
              name: collection.title,
              status: "done" as const,
              path: collection.path,
              meta: `${collection.clipIds.length} 个片段分组`,
            })),
          ]);
        } else if (event.type === "error") {
          setStatus("高光切片失败：" + event.msg);
          setTaskItems((items) => items.length ? items : [{ id: "error", name: event.msg, status: "error" }]);
        }
      });
    } catch (err) {
      setStatus("高光切片失败：" + (err as Error).message);
      setTaskItems([{ id: "error", name: (err as Error).message, status: "error" }]);
    } finally {
      setRunning(false);
    }
  };

  const previewUrl = selectedClip?.url || selectedSource?.url || "";
  const summary = [
    { label: "视频数量", value: `${folderInfo?.count ?? 0} 个` },
    { label: "片段时长", value: `${minDuration}-${maxDuration} 秒` },
    { label: "最低评分", value: `${minScore} 分` },
    { label: "最多切片", value: `${maxClips} 个` },
    { label: "分组数量", value: `${maxCollections} 个` },
    { label: "字幕来源", value: enableAsr ? "已有字幕或自动识别" : "仅使用已有字幕" },
    { label: "素材仓库", value: addToLibrary ? "生成后加入" : "不加入" },
  ];

  return (
    <div className="modwrap highlight-page-wrap">
      <div className="modbar">
        <div className="mod-title">
          <b>{mod.name}</b>
          <span>长视频内容理解 · 自动提取可发布片段</span>
        </div>
      </div>
      <div className="segment-page highlight-page">
        <section className="segment-col segment-left">
          <div className="box segment-box">
            <div className="box-h">
              <button className="import-btn" type="button" onClick={onImport}>导入视频</button>
              <button className="icon-btn text-btn" type="button" onClick={() => setMaterialPickerOpen(true)}>素材仓库</button>
              <button className="icon-btn text-btn" type="button" onClick={clearWorkspace} disabled={running || (!sourcePath && !folderInfo && !clips.length)}>清空</button>
            </div>
            {!folderInfo ? (
              <div className="empty">
                <div className="t">暂无视频</div>
                <div className="s">导入单个长视频或文件夹后开始高光切片</div>
              </div>
            ) : (
              <div className="segment-materials">
                <div className="folder-row">
                  <strong title={sourcePath}>{folderInfo.name || basename(sourcePath)}</strong>
                  <span className="folder-count">{folderInfo.count}</span>
                </div>
                <div className="clip-list">
                  {folderInfo.clips.map((clip) => (
                    <button
                      className={`clip-row ${selectedSource?.path === clip.path && !selectedClip ? "active" : ""}`}
                      key={clip.path}
                      type="button"
                      title={clip.path}
                      onClick={() => { setSelectedSource(clip); setSelectedClip(null); }}
                    >
                      <span>▻</span>
                      <b>{clip.name}</b>
                    </button>
                  ))}
                </div>
                <div className="folder-path">{sourcePath}</div>
              </div>
            )}
          </div>
        </section>

        <section className="segment-col segment-main">
          <div className="segment-preview highlight-preview">
            {previewUrl ? (
              <video key={previewUrl} src={previewUrl} controls />
            ) : (
              <div className="preview-empty">导入视频后预览</div>
            )}
          </div>
          <div className="box segment-result highlight-result">
            <div className="box-h">
              <span>高光片段</span>
              <span className="muted">{clips.length ? `${clips.length} 个片段 · ${collections.length} 个分组` : "尚未生成"}</span>
            </div>
            {clips.length ? (
              <div className="highlight-list">
                {clips.map((clip) => (
                  <button
                    className={`highlight-row ${selectedClip?.id === clip.id ? "active" : ""}`}
                    key={clip.id}
                    type="button"
                    onClick={() => setSelectedClip(clip)}
                    title={clip.path}
                  >
                    <div>
                      <b>{clip.title}</b>
                      <span>{clip.reason}</span>
                    </div>
                    <em>{scoreText(clip.score)}</em>
                    <strong>{fmtSec(clip.startSec)} - {fmtSec(clip.endSec)}</strong>
                  </button>
                ))}
                {collections.length ? (
                  <div className="highlight-collections">
                    <div className="highlight-section-title">推荐分组</div>
                    {collections.map((item) => (
                      <div className="highlight-collection-card" key={item.id} title={item.path}>
                        <div className="highlight-collection-head">
                          <b>{item.title}</b>
                          <span>{item.clipIds.length} 个片段 · {item.summary || "自动整理高光分组"}</span>
                        </div>
                        {item.items?.length ? (
                          <div className="highlight-collection-clips">
                            {item.items.map((clip, index) => (
                              <button
                                className={`highlight-collection-clip ${selectedClip?.path === clip.path ? "active" : ""}`}
                                key={`${item.id}-${clip.id}-${index}`}
                                type="button"
                                onClick={() => chooseCollectionClip(clip)}
                                title={clip.path}
                              >
                                <span>{index + 1}</span>
                                <b>{clip.title}</b>
                                <em>{clip.timeRange || (clip.score ? scoreText(clip.score) : "片段")}</em>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="body">
                <div>暂无高光片段</div>
                <div className="s muted">右侧确认设置后开始生成</div>
              </div>
            )}
          </div>
        </section>

        <aside className="segment-col segment-settings">
          <div className="box segment-box">
            <div className="box-h">高光设置</div>
            <div className="segment-settings-body">
              <label className="segment-field">
                <span>字幕文件</span>
                <input className="inp" value={srtPath} onChange={(e) => setSrtPath(e.target.value)} placeholder="可选：同名 SRT 可留空" />
              </label>
              <label className="segment-field">
                <span>最短时长</span>
                <input className="inp" type="number" min={10} step={5} value={minDuration} onChange={(e) => setMinDuration(Number(e.target.value) || 60)} />
                <b>秒</b>
              </label>
              <label className="segment-field">
                <span>最长时长</span>
                <input className="inp" type="number" min={30} step={10} value={maxDuration} onChange={(e) => setMaxDuration(Number(e.target.value) || 360)} />
                <b>秒</b>
              </label>
              <label className="segment-field">
                <span>最低评分</span>
                <input type="range" min={0} max={95} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
                <b>{minScore}</b>
              </label>
              <label className="segment-field">
                <span>最多切片</span>
                <input className="inp" type="number" min={1} max={30} value={maxClips} onChange={(e) => setMaxClips(Number(e.target.value) || 8)} />
                <b>个</b>
              </label>
              <label className="segment-field">
                <span>分组数量</span>
                <input className="inp" type="number" min={0} max={8} value={maxCollections} onChange={(e) => setMaxCollections(Number(e.target.value) || 0)} />
                <b>个</b>
              </label>
              <div className="segment-setting-row">
                <span>自动识别字幕</span>
                <div className="mini-seg compact">
                  <button className={enableAsr ? "active" : ""} type="button" onClick={() => setEnableAsr(true)}>启用</button>
                  <button className={!enableAsr ? "active" : ""} type="button" onClick={() => setEnableAsr(false)}>关闭</button>
                </div>
              </div>
              <div className="segment-setting-row">
                <span>加入素材仓库</span>
                <div className="mini-seg compact">
                  <button className={addToLibrary ? "active" : ""} type="button" onClick={() => setAddToLibrary(true)}>启用</button>
                  <button className={!addToLibrary ? "active" : ""} type="button" onClick={() => setAddToLibrary(false)}>关闭</button>
                </div>
              </div>
              <div className="segment-field segment-field-wide">
                <span>导出画质</span>
                <div className="mini-seg compact">
                  <button className={exportQuality === "standard" ? "active" : ""} type="button" onClick={() => setExportQuality("standard")}>标准</button>
                  <button className={exportQuality === "high" ? "active" : ""} type="button" onClick={() => setExportQuality("high")}>高清</button>
                  <button className={exportQuality === "best" ? "active" : ""} type="button" onClick={() => setExportQuality("best")}>高质量</button>
                </div>
                <b>{exportQuality === "best" ? "CRF18" : exportQuality === "high" ? "CRF20" : "CRF23"}</b>
              </div>
              <div className="segment-note">
                高光切片会根据字幕理解内容，自动找话题边界、评分并生成标题；适合直播、访谈、课程和口播长视频。
              </div>
            </div>
          </div>
          <button className={`cta ${sourcePath && !running ? "ready" : "disabled"}`} type="button" onClick={openConfirm}>
            {!sourcePath ? "请先导入视频" : running ? "生成中…" : "开始高光切片"}
          </button>
          {running || progress > 0 || status ? (
            <button className="task-mini" type="button" onClick={() => setTaskOpen(true)}>
              <span>{running ? "生成中" : progress >= 100 ? "生成完成" : "任务状态"}</span>
              <b>{progress}%</b>
              <em>{status || "查看高光切片任务"}</em>
            </button>
          ) : null}
          {exportDir ? <div className="segment-meta">生成完成，可在产出记录查看</div> : null}
        </aside>
      </div>
      <ExportTaskDrawer
        open={taskOpen}
        title="高光切片任务"
        status={status}
        progress={progress}
        running={running}
        exportDir={exportDir}
        manifest={manifest}
        items={taskItems}
        summary={summary}
        confirmLabel="确认生成"
        onConfirm={!running && progress === 0 ? startGenerate : undefined}
        onClose={() => setTaskOpen(false)}
      />
      <MaterialSourcePicker
        open={materialPickerOpen}
        defaultCategory="raw"
        onSelect={chooseMaterialRoot}
        onClose={() => setMaterialPickerOpen(false)}
      />
    </div>
  );
}
