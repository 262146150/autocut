import { useEffect, useMemo, useState } from "react";
import type { ModuleDef } from "../data/modules";
import { listExports, saveExportRoot, type ExportBatchItem, type ExportLibrary as ExportLibraryData, type ExportVideoItem } from "../api";

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
      if (batch.videos[0]) return { batch, video: batch.videos[0] };
    }
  }
  return null;
}

export default function ExportLibrary({ mod }: { mod: ModuleDef }) {
  const [data, setData] = useState<ExportLibraryData | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<ExportBatchItem | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<ExportVideoItem | null>(null);
  const [status, setStatus] = useState("正在读取导出目录…");

  const totalVideos = useMemo(
    () => data?.dates.reduce((sum, date) => sum + date.count, 0) ?? 0,
    [data],
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
      const currentStillExists = selectedVideo
        ? next.dates.some((date) => date.batches.some((batch) => batch.videos.some((video) => video.path === selectedVideo.path)))
        : false;
      if (!currentStillExists) {
        const first = selectFirstVideo(next);
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

  const choose = (batch: ExportBatchItem, video: ExportVideoItem) => {
    setSelectedBatch(batch);
    setSelectedVideo(video);
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
      if (selectedVideo?.path.startsWith(root)) {
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
        <section className="export-left box">
          <div className="box-h">
            <span>导出目录</span>
            <span className="muted">{totalVideos} 个视频</span>
          </div>
          <div className="export-tree">
            {data?.roots.length ? (
              <div className="export-roots">
                {data.roots.map((root) => (
                  <div className="export-root-chip" key={root} title={root}>
                    <span>{root === data.root ? "默认" : "外部"}</span>
                    <b>{root}</b>
                    {root !== data.root ? (
                      <button type="button" onClick={() => removeRoot(root)} aria-label="移除导出目录">×</button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {data?.dates.length ? data.dates.map((date) => (
              <div className="export-date" key={date.dir}>
                <div className="export-date-h">
                  <b>{date.date}</b>
                  <em title={date.root}>{date.rootName}</em>
                  <span>{date.count}</span>
                </div>
                {date.batches.map((batch) => (
                  <div className="export-batch" key={batch.dir}>
                    <div className="export-batch-h" title={batch.dir}>
                      <strong>{batch.name}</strong>
                      <em>{batch.modeLabel}</em>
                    </div>
                    <div className="export-video-list">
                      {batch.videos.map((video) => (
                        <button
                          className={`export-video-row ${selectedVideo?.path === video.path ? "active" : ""}`}
                          key={video.path}
                          type="button"
                          onClick={() => choose(batch, video)}
                          title={video.path}
                        >
                          <span>{video.name}</span>
                          <em>{formatBytes(video.size)}</em>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )) : (
              <div className="empty">
                <div className="t">暂无导出视频</div>
                <div className="s">生成视频后会出现在这里</div>
              </div>
            )}
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
        </section>

        <aside className="export-right box">
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
              <label>
                <span>批次目录</span>
                <b title={selectedBatch.dir}>{selectedBatch.dir}</b>
              </label>
              <label>
                <span>导出根目录</span>
                <b title={data?.roots.find((root) => selectedBatch.dir.startsWith(root)) || ""}>
                  {data?.roots.find((root) => selectedBatch.dir.startsWith(root)) || "-"}
                </b>
              </label>
              <label>
                <span>视频路径</span>
                <b title={selectedVideo.path}>{selectedVideo.path}</b>
              </label>
              {selectedBatch.manifest ? (
                <label>
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
        </aside>
      </div>
    </div>
  );
}
