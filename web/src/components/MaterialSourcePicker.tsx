import { useEffect, useState } from "react";
import { listMaterialLibrary, type MaterialLibraryCategory, type MaterialLibraryRoot } from "../api";

type PickerCategory = "all" | MaterialLibraryCategory;
type PickerOrientation = "all" | "portrait" | "landscape";

const CATEGORY_OPTIONS: Array<{ value: PickerCategory; label: string }> = [
  { value: "all", label: "全部" },
  { value: "raw", label: "原始素材" },
  { value: "segments", label: "分割片段" },
  { value: "reuse", label: "成品复用" },
];

export function MaterialSourcePicker({
  open,
  title = "选择素材来源",
  defaultCategory = "all",
  onSelect,
  onClose,
}: {
  open: boolean;
  title?: string;
  defaultCategory?: PickerCategory;
  onSelect: (root: MaterialLibraryRoot) => void;
  onClose: () => void;
}) {
  const [roots, setRoots] = useState<MaterialLibraryRoot[]>([]);
  const [status, setStatus] = useState("正在读取素材仓库…");
  const [category, setCategory] = useState<PickerCategory>(defaultCategory);
  const [orientation, setOrientation] = useState<PickerOrientation>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCategory(defaultCategory);
    setOrientation("all");
    setQuery("");
    setStatus("正在读取素材仓库…");
    listMaterialLibrary()
      .then((library) => {
        if (cancelled) return;
        const nextRoots = library.roots.filter((root) => root.exists && root.videoCount > 0);
        setRoots(nextRoots);
        setStatus(nextRoots.length ? `仅显示包含视频的素材源 · ${nextRoots.length} 个可用` : "素材仓库里还没有可用视频素材源");
      })
      .catch((err) => {
        if (cancelled) return;
        setRoots([]);
        setStatus("读取素材仓库失败：" + (err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [defaultCategory, open]);

  if (!open) return null;
  const rootOrientation = (root: MaterialLibraryRoot): "portrait" | "landscape" | "unknown" => {
    const portrait = root.items.filter((item) => item.orientation === "portrait").length;
    const landscape = root.items.filter((item) => item.orientation === "landscape").length;
    if (portrait > landscape) return "portrait";
    if (landscape > portrait) return "landscape";
    return "unknown";
  };
  const visibleRoots = roots.filter((root) => {
    if (category !== "all" && root.category !== category) return false;
    if (orientation !== "all" && rootOrientation(root) !== orientation) return false;
    const q = query.trim().toLowerCase();
    if (q && !`${root.name} ${root.path}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const totalVideos = visibleRoots.reduce((sum, root) => sum + root.videoCount, 0);

  return (
    <div className="copy-modal-backdrop" onMouseDown={onClose}>
      <div className="material-picker-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="copy-modal-h material-picker-h">
          <div className="material-picker-title">
            <b>{title}</b>
            <span>{status}</span>
          </div>
          <div className="material-picker-h-side">
            <b>{totalVideos} 个视频</b>
            <button className="icon-btn" type="button" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="material-picker-filters">
          <div className="mini-seg compact">
            {CATEGORY_OPTIONS.map((item) => (
              <button className={category === item.value ? "active" : ""} key={item.value} type="button" onClick={() => setCategory(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="mini-seg compact">
            <button className={orientation === "all" ? "active" : ""} type="button" onClick={() => setOrientation("all")}>全部方向</button>
            <button className={orientation === "portrait" ? "active" : ""} type="button" onClick={() => setOrientation("portrait")}>竖屏</button>
            <button className={orientation === "landscape" ? "active" : ""} type="button" onClick={() => setOrientation("landscape")}>横屏</button>
          </div>
          <input className="inp material-picker-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材源名称或路径" />
        </div>
        <div className="material-picker-list">
          {visibleRoots.length ? visibleRoots.map((root) => (
            <button className="material-picker-row" type="button" key={root.path} onClick={() => onSelect(root)} title={root.path}>
              <div className="material-picker-row-main">
                <span className="material-picker-chip">{root.categoryLabel}</span>
                <b>{root.name}</b>
                <span className="material-picker-meta">{root.videoCount} 个视频 · {root.audioCount} 个音频 · {Math.round(root.durationSec || 0)} 秒</span>
              </div>
              <em>{root.path}</em>
            </button>
          )) : <div className="task-empty">{roots.length ? "没有符合筛选的素材源" : "请先在素材仓库添加包含视频的素材源"}</div>}
        </div>
      </div>
    </div>
  );
}
