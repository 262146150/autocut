import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuleDef } from "../data/modules";
import { listExports, listGenerationTasks, saveExportRoot, saveMaterialSource, type ExportBatchItem, type ExportDateGroup, type ExportEntryItem, type ExportLibrary as ExportLibraryData, type ExportVideoItem, type GenerationTaskRecord } from "../api";

function formatBytes(bytes: number) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDurationMs(value: number | null) {
  const ms = Math.max(0, Number(value) || 0);
  if (!ms) return "-";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min < 60) return rest ? `${min} 分 ${rest} 秒` : `${min} 分`;
  const hour = Math.floor(min / 60);
  const leftMin = min % 60;
  return leftMin ? `${hour} 小时 ${leftMin} 分` : `${hour} 小时`;
}

function taskStatusText(status: string) {
  if (status === "success") return "完成";
  if (status === "failed") return "失败";
  if (status === "running") return "进行中";
  return status || "-";
}

function selectFirstBatch(data: ExportLibraryData | null) {
  for (const date of data?.dates ?? []) {
    for (const batch of date.batches) {
      return { date, batch };
    }
  }
  return null;
}

function entriesFromBatch(batch: ExportBatchItem | null): ExportEntryItem[] {
  if (!batch) return [];
  if (batch.entries?.length) return batch.entries;
  return batch.videos.map((video) => ({
    ...video,
    kind: "video",
    videoCount: 1,
  }));
}

function videoFromEntry(entry: ExportEntryItem): ExportVideoItem {
  return {
    name: entry.name,
    path: entry.path,
    url: entry.url || "",
    size: entry.size ?? 0,
    modifiedAt: entry.modifiedAt || "",
  };
}

function findEntryPath(entries: ExportEntryItem[], targetPath: string): string[] | null {
  for (const entry of entries) {
    if (entry.path === targetPath) return [entry.path];
    if (entry.kind === "dir" && entry.children?.length) {
      const childPath = findEntryPath(entry.children, targetPath);
      if (childPath) return [entry.path, ...childPath];
    }
  }
  return null;
}

export default function ExportLibrary({ mod }: { mod: ModuleDef }) {
  const [data, setData] = useState<ExportLibraryData | null>(null);
  const [tasks, setTasks] = useState<GenerationTaskRecord[]>([]);
  const [selectedRoot, setSelectedRoot] = useState("");
  const [selectedDateDir, setSelectedDateDir] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<ExportBatchItem | null>(null);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<ExportVideoItem | null>(null);
  const [status, setStatus] = useState("正在读取导出目录…");
  const columnsRef = useRef<HTMLDivElement | null>(null);

  const rootRows = useMemo(() => (data?.roots ?? []).map((root) => {
    const dates = data?.dates.filter((date) => date.root === root) ?? [];
    const parts = root.split(/[\\/]/).filter(Boolean);
    return {
      root,
      label: root === data?.root ? "默认导出" : parts[parts.length - 1] || root,
      kind: root === data?.root ? "默认" : "外部",
      count: dates.reduce((sum, date) => sum + date.count, 0),
      dateCount: dates.length,
    };
  }), [data]);

  const visibleDates = useMemo(
    () => (data?.dates ?? []).filter((date) => !selectedRoot || date.root === selectedRoot),
    [data, selectedRoot],
  );

  const totalVideos = useMemo(
    () => data?.dates.reduce((sum, date) => sum + date.count, 0) ?? 0,
    [data],
  );
  const selectedDate = useMemo(
    () => visibleDates.find((date) => date.dir === selectedDateDir) ?? visibleDates[0] ?? null,
    [visibleDates, selectedDateDir],
  );
  const totalBatches = useMemo(
    () => data?.dates.reduce((sum, date) => sum + date.batches.length, 0) ?? 0,
    [data],
  );
  const contentColumns = useMemo(() => {
    const columns: Array<{ title: string; entries: ExportEntryItem[]; selectedPath?: string }> = [];
    let entries = entriesFromBatch(selectedBatch);
    let title = "内容";
    for (let depth = 0; ; depth += 1) {
      columns.push({ title, entries, selectedPath: selectedEntryPath[depth] });
      const selected = entries.find((entry) => entry.path === selectedEntryPath[depth]);
      if (!selected || selected.kind !== "dir") break;
      entries = selected.children ?? [];
      title = selected.name;
    }
    return columns;
  }, [selectedBatch, selectedEntryPath]);
  const selectedDirectoryEntry = useMemo(() => {
    let entries = entriesFromBatch(selectedBatch);
    let selectedDir: ExportEntryItem | null = null;
    for (const currentPath of selectedEntryPath) {
      const entry = entries.find((item) => item.path === currentPath);
      if (!entry || entry.kind !== "dir") break;
      selectedDir = entry;
      entries = entry.children ?? [];
    }
    return selectedDir;
  }, [selectedBatch, selectedEntryPath]);

  const refresh = async () => {
    setStatus("正在读取导出目录…");
    try {
      const [next, taskData] = await Promise.all([
        listExports(),
        listGenerationTasks(8).catch(() => ({ tasks: [], totals: { count: 0, running: 0, failed: 0 } })),
      ]);
      setData(next);
      setTasks(taskData.tasks);
      let current: { date: ExportDateGroup; batch: ExportBatchItem; video: ExportVideoItem; entryPath: string[] } | null = null;
      if (selectedVideo) {
        for (const date of next.dates) {
          for (const batch of date.batches) {
            const video = batch.videos.find((item) => item.path === selectedVideo.path);
            if (video) current = { date, batch, video, entryPath: findEntryPath(entriesFromBatch(batch), video.path) ?? [video.path] };
          }
        }
      }
      if (current) {
        setSelectedRoot(current.date.root);
        setSelectedDateDir(current.date.dir);
        setSelectedBatch(current.batch);
        setSelectedEntryPath(current.entryPath);
        setSelectedVideo(current.video);
      } else {
        const first = selectFirstBatch(next);
        setSelectedRoot(first?.date.root ?? next.roots[0] ?? "");
        setSelectedDateDir(first?.date.dir ?? next.dates[0]?.dir ?? "");
        setSelectedBatch(first?.batch ?? null);
        setSelectedEntryPath([]);
        setSelectedVideo(null);
      }
      setStatus(next.dates.length ? `共 ${next.dates.length} 天，${next.dates.reduce((sum, date) => sum + date.batches.length, 0)} 个批次，${next.dates.reduce((sum, date) => sum + date.count, 0)} 个视频` : "暂无导出视频");
    } catch (err) {
      setStatus("读取失败：" + (err as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToColumn = (index: number) => {
    requestAnimationFrame(() => {
      const target = columnsRef.current?.querySelector<HTMLElement>(`[data-export-column="${index}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    });
  };

  const chooseRoot = (root: string) => {
    const firstDate = (data?.dates ?? []).find((date) => date.root === root) ?? null;
    const firstBatch = firstDate?.batches[0] ?? null;
    setSelectedRoot(root);
    setSelectedDateDir(firstDate?.dir ?? "");
    setSelectedBatch(firstBatch);
    setSelectedEntryPath([]);
    setSelectedVideo(null);
    scrollToColumn(1);
  };

  const chooseDate = (date: ExportDateGroup) => {
    const firstBatch = date.batches[0] ?? null;
    setSelectedRoot(date.root);
    setSelectedDateDir(date.dir);
    setSelectedBatch(firstBatch);
    setSelectedEntryPath([]);
    setSelectedVideo(null);
    scrollToColumn(2);
  };

  const chooseBatch = (batch: ExportBatchItem) => {
    setSelectedBatch(batch);
    setSelectedEntryPath([]);
    setSelectedVideo(null);
    scrollToColumn(3);
  };

  const chooseEntry = (entry: ExportEntryItem, depth: number) => {
    const nextPath = [...selectedEntryPath.slice(0, depth), entry.path];
    setSelectedEntryPath(nextPath);
    if (entry.kind === "video") {
      setSelectedVideo(videoFromEntry(entry));
      scrollToColumn(3 + depth);
    } else {
      setSelectedVideo(null);
      scrollToColumn(4 + depth);
    }
  };

  const addRoot = async () => {
    const next = prompt("输入需要加入作品库的导出根目录路径", "");
    if (next === null) return;
    const input = next.trim();
    if (!input) {
      setStatus("请填写导出目录路径");
      return;
    }
    try {
      await saveExportRoot(input);
      await refresh();
      setStatus("已添加导出目录");
    } catch (err) {
      setStatus("添加失败：" + (err as Error).message);
    }
  };

  const removeRoot = async (root: string) => {
    if (!data || root === data.root) return;
    try {
      await saveExportRoot(root, true);
      if (selectedRoot === root || selectedVideo?.path.startsWith(root)) {
        setSelectedRoot("");
        setSelectedDateDir("");
        setSelectedBatch(null);
        setSelectedEntryPath([]);
        setSelectedVideo(null);
      }
      await refresh();
      setStatus("已移除导出目录记录");
    } catch (err) {
      setStatus("移除失败：" + (err as Error).message);
    }
  };

  const addSelectedToMaterialLibrary = async () => {
    if (!selectedVideo) return;
    try {
      await saveMaterialSource(selectedVideo.path, "reuse");
      setStatus("已加入素材仓库：成品复用");
    } catch (err) {
      setStatus("加入素材仓库失败：" + (err as Error).message);
    }
  };

  const addBatchToMaterialLibrary = async () => {
    if (!selectedBatch) return;
    const targetDir = selectedDirectoryEntry?.path ?? selectedBatch.dir;
    try {
      await saveMaterialSource(targetDir, "reuse");
      setStatus("已将目录加入素材仓库：成品复用");
    } catch (err) {
      setStatus("目录加入素材仓库失败：" + (err as Error).message);
    }
  };

  return (
    <div className="modwrap">
      <div className="modbar">
        <div className="mod-title">
          <b>{mod.name}</b>
          <span>本地导出目录 · {totalBatches} 个批次</span>
        </div>
        <button className="icon-btn text-btn" type="button" onClick={addRoot}>添加目录</button>
        <button className="import-btn" type="button" onClick={refresh}>刷新</button>
      </div>
      <div className={`export-page ${selectedVideo ? "has-preview" : "no-preview"}`}>
        <section className="export-browser box">
          <div className="box-h">
            <span>产出浏览</span>
            <span className="muted">{totalVideos} 个视频</span>
          </div>
          {tasks.length ? (
            <div className="export-task-strip" aria-label="最近生成任务">
              {tasks.map((task) => (
                <div className={`export-task-card ${task.status}`} key={task.id} title={task.error || task.outputDir || task.inputPath}>
                  <div>
                    <b>{task.modeLabel}</b>
                    <span>{taskStatusText(task.status)}</span>
                  </div>
                  <strong>{formatDurationMs(task.durationMs)}</strong>
                  <em>{task.outputCount ? `${task.outputCount} 个产出` : task.status === "running" ? "正在生成" : "无产出"}</em>
                  <small>{task.taskName}</small>
                </div>
              ))}
            </div>
          ) : null}
          <div className="export-columns" ref={columnsRef}>
            <div className="export-column" data-export-column="0">
              <div className="export-column-h">目录</div>
              {rootRows.length ? rootRows.map((item) => (
                <div className={`export-root-row ${selectedRoot === item.root ? "active" : ""}`} key={item.root}>
                  <button
                    className={`export-column-row has-next root ${selectedRoot === item.root ? "active" : ""}`}
                    type="button"
                    onClick={() => chooseRoot(item.root)}
                    title={item.root}
                  >
                    <span>{item.label}</span>
                    <em>{item.kind} · {item.dateCount} 天</em>
                    <b>{item.count}</b>
                  </button>
                  {item.root !== data?.root ? (
                    <button
                      className="export-remove-root"
                      type="button"
                      onClick={() => removeRoot(item.root)}
                      aria-label="移除导出目录"
                    >
                      x
                    </button>
                  ) : null}
                </div>
              )) : <div className="task-empty">暂无目录</div>}
            </div>
            <div className="export-column" data-export-column="1">
              <div className="export-column-h">日期</div>
              {visibleDates.length ? visibleDates.map((date) => (
                <button
                  className={`export-column-row has-next ${selectedDate?.dir === date.dir ? "active" : ""}`}
                  key={date.dir}
                  type="button"
                  onClick={() => chooseDate(date)}
                  title={date.dir}
                >
                  <span>{date.date}</span>
                  <em>{date.rootName}</em>
                  <b>{date.count}</b>
                </button>
              )) : <div className="task-empty">暂无产出记录</div>}
            </div>
            <div className="export-column" data-export-column="2">
              <div className="export-column-h">批次</div>
              {selectedDate?.batches.length ? selectedDate.batches.map((batch) => (
                <button
                  className={`export-column-row has-next batch ${selectedBatch?.dir === batch.dir ? "active" : ""}`}
                  key={batch.dir}
                  type="button"
                  onClick={() => chooseBatch(batch)}
                  title={batch.dir}
                >
                  <span>{batch.name}</span>
                  <em>{batch.modeLabel}</em>
                  <b>{batch.videoCount}</b>
                </button>
              )) : <div className="task-empty">请选择日期</div>}
            </div>
            {selectedBatch ? contentColumns.map((column, depth) => (
              <div className="export-column" data-export-column={3 + depth} key={`${selectedBatch.dir}-${depth}`}>
                <div className="export-column-h" title={column.title}>{column.title}</div>
                {column.entries.length ? column.entries.map((entry) => (
                  <button
                    className={`export-column-row ${entry.kind === "dir" ? "has-next dir" : "video"} ${column.selectedPath === entry.path ? "active" : ""}`}
                    key={`${entry.kind}-${entry.path}`}
                    type="button"
                    onClick={() => chooseEntry(entry, depth)}
                    title={entry.path}
                  >
                    <span>{entry.name}</span>
                    <em>{entry.kind === "dir" ? `${entry.videoCount} 个视频` : formatBytes(entry.size ?? 0)}</em>
                    {entry.kind === "dir" ? <b>{entry.videoCount}</b> : null}
                  </button>
                )) : <div className="task-empty">{depth ? "此目录暂无视频" : "此批次暂无视频"}</div>}
              </div>
            )) : (
              <div className="export-column" data-export-column="3">
                <div className="export-column-h">内容</div>
                <div className="task-empty">请选择批次</div>
              </div>
            )}
          </div>
        </section>

        {selectedVideo ? (
          <section className="export-main">
            <div className="export-player">
              <video key={selectedVideo.path} src={selectedVideo.url} controls />
            </div>
            <div className="export-status">{status}</div>
            {selectedBatch ? (
              <section className="export-inspector box">
                <div className="box-h">
                  <span>视频信息</span>
                  <div className="r">
                    <button className="icon-btn text-btn" type="button" onClick={addSelectedToMaterialLibrary}>视频入库</button>
                    <button className="icon-btn text-btn" type="button" onClick={addBatchToMaterialLibrary}>目录入库</button>
                  </div>
                </div>
                <div className="export-info">
                  <label>
                    <span>文件名</span>
                    <b title={selectedVideo.name}>{selectedVideo.name}</b>
                  </label>
                  <label>
                    <span>大小</span>
                    <b>{formatBytes(selectedVideo.size)}</b>
                  </label>
                  <label>
                    <span>修改时间</span>
                    <b>{formatTime(selectedVideo.modifiedAt)}</b>
                  </label>
                  <label>
                    <span>生成模式</span>
                    <b>{selectedBatch.modeLabel}</b>
                  </label>
                  <label className="wide">
                    <span>批次目录</span>
                    <b title={selectedBatch.dir}>{selectedBatch.dir}</b>
                  </label>
                  <label className="wide">
                    <span>导出根目录</span>
                    <b title={data?.roots.find((root) => selectedBatch.dir.startsWith(root)) || ""}>
                      {data?.roots.find((root) => selectedBatch.dir.startsWith(root)) || "-"}
                    </b>
                  </label>
                  <label className="wide">
                    <span>视频路径</span>
                    <b title={selectedVideo.path}>{selectedVideo.path}</b>
                  </label>
                  {selectedBatch.manifest ? (
                    <label className="wide">
                      <span>清单文件</span>
                      <b title={selectedBatch.manifest}>{selectedBatch.manifest}</b>
                    </label>
                  ) : null}
                </div>
              </section>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
