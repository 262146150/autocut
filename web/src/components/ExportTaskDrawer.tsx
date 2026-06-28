export type ExportTaskItem = {
  id: string;
  name: string;
  status: "waiting" | "running" | "done" | "error";
  url?: string;
  path?: string;
  meta?: string;
};

function statusLabel(status: ExportTaskItem["status"]) {
  if (status === "done") return "已完成";
  if (status === "running") return "生成中";
  if (status === "error") return "失败";
  return "等待中";
}

export function ExportTaskDrawer({
  open,
  title,
  status,
  progress,
  running,
  exportDir,
  manifest,
  items,
  logs,
  onClose,
}: {
  open: boolean;
  title: string;
  status: string;
  progress: number;
  running: boolean;
  exportDir?: string;
  manifest?: string;
  items: ExportTaskItem[];
  logs: string[];
  onClose: () => void;
}) {
  if (!open) return null;
  const completed = items.filter((item) => item.status === "done").length;
  const total = items.length;
  return (
    <div className="task-drawer-backdrop" onMouseDown={onClose}>
      <aside className="task-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="task-drawer-h">
          <div>
            <b>{title}</b>
            <span>{running ? "任务进行中" : completed ? "任务已结束" : "等待开始"}</span>
          </div>
          <button className="icon-btn" type="button" onClick={onClose}>×</button>
        </div>

        <div className="task-progress-card">
          <div className="task-progress-top">
            <span>{status || "暂无任务"}</span>
            <b>{Math.max(0, Math.min(100, progress))}%</b>
          </div>
          <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>
          <div className="task-progress-meta">
            <span>{total ? `${completed}/${total} 个完成` : "尚未生成队列"}</span>
            {exportDir ? <span title={exportDir}>输出目录已生成</span> : null}
          </div>
        </div>

        {exportDir ? (
          <div className="task-path" title={exportDir}>
            <span>输出目录</span>
            <b>{exportDir}</b>
          </div>
        ) : null}
        {manifest ? (
          <div className="task-path" title={manifest}>
            <span>清单文件</span>
            <b>{manifest}</b>
          </div>
        ) : null}

        <div className="task-section-h">
          <b>产出队列</b>
          <span>{total} 项</span>
        </div>
        <div className="task-items">
          {items.length ? items.map((item) => (
            <div className={`task-item ${item.status}`} key={item.id}>
              <div>
                <b title={item.path || item.name}>{item.name}</b>
                {item.meta ? <span>{item.meta}</span> : null}
              </div>
              <em>{statusLabel(item.status)}</em>
              {item.url ? <video src={item.url} controls preload="metadata" /> : null}
            </div>
          )) : (
            <div className="task-empty">点击开始后会显示待生成的视频或片段</div>
          )}
        </div>

        <div className="task-section-h">
          <b>任务日志</b>
          <span>最近 {logs.length} 条</span>
        </div>
        <div className="task-logs">
          {logs.length ? logs.map((log, index) => <div key={`${log}-${index}`}>{log}</div>) : <div>暂无日志</div>}
        </div>

        <div className="task-actions">
          <button className="import-btn" type="button" onClick={() => { window.location.href = "/export-library"; }}>打开作品库</button>
          <button className="icon-btn text-btn" type="button" onClick={onClose}>收起</button>
        </div>
      </aside>
    </div>
  );
}
