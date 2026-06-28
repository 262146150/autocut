import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuleDef } from "../data/modules";
import { listExports, saveExportRoot, type ExportBatchItem, type ExportDateGroup, type ExportLibrary as ExportLibraryData, type ExportVideoItem } from "../api";

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

function selectFirstVideo(data: ExportLibraryData | null) {
  for (const date of data?.dates ?? []) {
    for (const batch of date.batches) {
      if (batch.videos[0]) return { date, batch, video: batch.videos[0] };
    }
  }
  return null;
}

export default function ExportLibrary({ mod }: { mod: ModuleDef }) {
  const [data, setData] = useState<ExportLibraryData | null>(null);
  const [selectedRoot, setSelectedRoot] = useState("");
  const [selectedDateDir, setSelectedDateDir] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<ExportBatchItem | null>(null);
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

  const refresh = async () => {
    setStatus("正在读取导出目录…");
    try {
      const next = await listExports();
      setData(next);
      let current: ReturnType<typeof selectFirstVideo> = null;
      if (selectedVideo) {
        for (const date of next.dates) {
          for (const batch of date.batches) {
            const video = batch.videos.find((item) => item.path === selectedVideo.path);
            if (video) current = { date, batch, video };
          }
        }
      }
      if (current) {
        setSelectedRoot(current.date.root);
        setSelectedDateDir(current.date.dir);
        setSelectedBatch(current.batch);
        setSelectedVideo(current.video);
      } else {
        const first = selectFirstVideo(next);
        setSelectedRoot(first?.date.root ?? next.roots[0] ?? "");
        setSelectedDateDir(first?.date.dir ?? next.dates[0]?.dir ?? "");
        setSelectedBatch(first?.batch ?? null);
        setSelectedVideo(first?.video ?? null);
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
    setSelectedVideo(firstBatch?.videos[0] ?? null);
    scrollToColumn(1);
  };

  const chooseDate = (date: ExportDateGroup) => {
    const firstBatch = date.batches[0] ?? null;
    setSelectedRoot(date.root);
    setSelectedDateDir(date.dir);
    setSelectedBatch(firstBatch);
    setSelectedVideo(firstBatch?.videos[0] ?? null);
    scrollToColumn(2);
  };

  const chooseBatch = (batch: ExportBatchItem) => {
    setSelectedBatch(batch);
    setSelectedVideo(batch.videos[0] ?? null);
    scrollToColumn(3);
  };

  const choose = (batch: ExportBatchItem, video: ExportVideoItem) => {
    setSelectedBatch(batch);
    setSelectedVideo(video);
    scrollToColumn(3);
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
        setSelectedVideo(null);
      }
      await refresh();
      setStatus("已移除导出目录记录");
    } catch (err) {
      setStatus("移除失败：" + (err as Error).message);
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
      <div className="export-page">
        <section className="export-browser box">
          <div className="box-h">
            <span>产出浏览</span>
            <span className="muted">{totalVideos} 个视频</span>
          </div>
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
            <div className="export-column" data-export-column="3">
              <div className="export-column-h">视频</div>
              {selectedBatch?.videos.length ? selectedBatch.videos.map((video) => (
                <button
                  className={`export-column-row video ${selectedVideo?.path === video.path ? "active" : ""}`}
                  key={video.path}
                  type="button"
                  onClick={() => choose(selectedBatch, video)}
                  title={video.path}
                >
                  <span>{video.name}</span>
                  <em>{formatBytes(video.size)}</em>
                </button>
              )) : <div className="task-empty">请选择批次</div>}
            </div>
          </div>
        </section>

        <section className="export-main">
          <div className="export-player">
            {selectedVideo ? (
              <video key={selectedVideo.path} src={selectedVideo.url} controls />
            ) : (
              <div className="preview-empty">选择一个导出视频</div>
            )}
          </div>
          <div className="export-status">{status}</div>
          <section className="export-inspector box">
            <div className="box-h">视频信息</div>
            {selectedVideo && selectedBatch ? (
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
            ) : (
              <div className="empty">
                <div className="t">未选择视频</div>
                <div className="s">从左侧目录选择视频后查看信息</div>
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}
