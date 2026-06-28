import { useEffect, useMemo, useState } from "react";
import type { ModuleDef } from "../data/modules";
import {
  listMaterialLibrary,
  refreshMaterialLibrary,
  saveMaterialSource,
  type MaterialLibraryCategory,
  type MaterialLibraryData,
  type MaterialLibraryItem,
  type MaterialLibraryOrientation,
  type MaterialLibraryRoot,
} from "../api";

const CATEGORY_OPTIONS: Array<{ value: "all" | MaterialLibraryCategory; label: string }> = [
  { value: "all", label: "全部" },
  { value: "raw", label: "原始素材" },
  { value: "segments", label: "分割片段" },
  { value: "reuse", label: "成品复用" },
  { value: "audio", label: "音频素材" },
];

function formatBytes(bytes?: number) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds?: number) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function orientationLabel(value?: MaterialLibraryOrientation) {
  if (value === "portrait") return "竖屏";
  if (value === "landscape") return "横屏";
  if (value === "square") return "方形";
  if (value === "audio") return "音频";
  return "未知";
}

function selectedRootFrom(data: MaterialLibraryData | null, path: string) {
  return data?.roots.find((root) => root.path === path) ?? data?.roots[0] ?? null;
}

export default function MaterialLibrary({ mod }: { mod: ModuleDef }) {
  const [data, setData] = useState<MaterialLibraryData | null>(null);
  const [selectedRootPath, setSelectedRootPath] = useState("");
  const [selectedItem, setSelectedItem] = useState<MaterialLibraryItem | null>(null);
  const [status, setStatus] = useState("正在读取素材仓库…");
  const [addCategory, setAddCategory] = useState<MaterialLibraryCategory>("raw");
  const [categoryFilter, setCategoryFilter] = useState<"all" | MaterialLibraryCategory>("all");
  const [kindFilter, setKindFilter] = useState<"all" | "video" | "audio">("all");
  const [orientationFilter, setOrientationFilter] = useState<"all" | "portrait" | "landscape" | "square">("all");
  const [query, setQuery] = useState("");

  const refresh = async (rescan = false) => {
    setStatus(rescan ? "正在刷新素材索引…" : "正在读取素材仓库…");
    try {
      const next = rescan ? await refreshMaterialLibrary() : await listMaterialLibrary();
      setData(next);
      const nextRoot = selectedRootFrom(next, selectedRootPath);
      setSelectedRootPath(nextRoot?.path ?? "");
      setSelectedItem((item) => next.items.find((nextItem) => nextItem.path === item?.path) ?? null);
      setStatus(next.totals.items ? `共 ${next.totals.roots} 个素材源，${next.totals.items} 个素材` : "素材仓库为空，请添加素材目录");
    } catch (err) {
      setStatus("读取失败：" + (err as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRoot = useMemo(() => selectedRootFrom(data, selectedRootPath), [data, selectedRootPath]);

  const visibleRoots = useMemo(() => {
    const roots = data?.roots ?? [];
    return categoryFilter === "all" ? roots : roots.filter((root) => root.category === categoryFilter);
  }, [data, categoryFilter]);

  const visibleItems = useMemo(() => {
    const source = selectedRoot?.items ?? [];
    const q = query.trim().toLowerCase();
    return source.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (orientationFilter !== "all" && item.orientation !== orientationFilter) return false;
      if (q && !`${item.name} ${item.path}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [selectedRoot, kindFilter, orientationFilter, query]);

  const addSource = async () => {
    const next = prompt("输入素材目录或单个素材文件路径", "");
    if (next === null) return;
    const input = next.trim();
    if (!input) {
      setStatus("请填写素材路径");
      return;
    }
    try {
      const payload = await saveMaterialSource(input, addCategory);
      setData(payload);
      const added = payload.roots.find((root) => root.path === input) ?? payload.roots.find((root) => root.name === input.split(/[\\/]/).pop());
      setSelectedRootPath(added?.path ?? payload.roots[0]?.path ?? "");
      setSelectedItem(null);
      setStatus("已添加素材源");
    } catch (err) {
      setStatus("添加失败：" + (err as Error).message);
    }
  };

  const removeSource = async (root: MaterialLibraryRoot) => {
    try {
      const payload = await saveMaterialSource(root.path, root.category, true);
      setData(payload);
      if (selectedRootPath === root.path || selectedItem?.rootPath === root.path) {
        setSelectedRootPath(payload.roots[0]?.path ?? "");
        setSelectedItem(null);
      }
      setStatus("已移除素材源记录");
    } catch (err) {
      setStatus("移除失败：" + (err as Error).message);
    }
  };

  const chooseRoot = (root: MaterialLibraryRoot) => {
    setSelectedRootPath(root.path);
    setSelectedItem(null);
  };

  return (
    <div className="modwrap">
      <div className="modbar">
        <div className="mod-title">
          <b>{mod.name}</b>
          <span>本地素材源 · {data?.totals.items ?? 0} 个素材</span>
        </div>
        <div className="material-add-mode mini-seg compact">
          {CATEGORY_OPTIONS.filter((item) => item.value !== "all").map((item) => (
            <button
              className={addCategory === item.value ? "active" : ""}
              key={item.value}
              type="button"
              onClick={() => setAddCategory(item.value as MaterialLibraryCategory)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button className="icon-btn text-btn" type="button" onClick={addSource}>添加素材源</button>
        <button className="import-btn" type="button" onClick={() => refresh(true)}>刷新索引</button>
      </div>

      <div className={`material-page ${selectedItem ? "has-preview" : "no-preview"}`}>
        <section className="material-browser box">
          <div className="box-h">
            <span>素材管理</span>
            <span className="muted">{status}</span>
          </div>
          <div className="material-filters">
            <div className="mini-seg compact">
              {CATEGORY_OPTIONS.map((item) => (
                <button
                  className={categoryFilter === item.value ? "active" : ""}
                  key={item.value}
                  type="button"
                  onClick={() => {
                    const nextCategory = item.value;
                    setCategoryFilter(nextCategory);
                    const nextRoot = (data?.roots ?? []).find((root) => nextCategory === "all" || root.category === nextCategory);
                    setSelectedRootPath(nextRoot?.path ?? "");
                    setSelectedItem(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mini-seg compact">
              <button className={kindFilter === "all" ? "active" : ""} type="button" onClick={() => setKindFilter("all")}>全部</button>
              <button className={kindFilter === "video" ? "active" : ""} type="button" onClick={() => setKindFilter("video")}>视频</button>
              <button className={kindFilter === "audio" ? "active" : ""} type="button" onClick={() => setKindFilter("audio")}>音频</button>
            </div>
            <div className="mini-seg compact">
              <button className={orientationFilter === "all" ? "active" : ""} type="button" onClick={() => setOrientationFilter("all")}>方向</button>
              <button className={orientationFilter === "portrait" ? "active" : ""} type="button" onClick={() => setOrientationFilter("portrait")}>竖屏</button>
              <button className={orientationFilter === "landscape" ? "active" : ""} type="button" onClick={() => setOrientationFilter("landscape")}>横屏</button>
            </div>
            <input className="inp material-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文件名或路径" />
          </div>
          <div className="material-columns">
            <div className="material-column roots">
              <div className="export-column-h">素材源</div>
              {visibleRoots.length ? visibleRoots.map((root) => (
                <div className={`material-root-row ${selectedRootPath === root.path ? "active" : ""}`} key={root.path}>
                  <button
                    className={`export-column-row has-next root ${selectedRootPath === root.path ? "active" : ""}`}
                    type="button"
                    onClick={() => chooseRoot(root)}
                    title={root.path}
                  >
                    <span>{root.name}</span>
                    <em>{root.categoryLabel} · {root.exists ? `${root.count} 个` : "路径失效"}</em>
                    <b>{root.videoCount}/{root.audioCount}</b>
                  </button>
                  <button className="export-remove-root" type="button" onClick={() => removeSource(root)} aria-label="移除素材源">x</button>
                </div>
              )) : <div className="task-empty">暂无素材源</div>}
            </div>
            <div className="material-column items">
              <div className="export-column-h">素材</div>
              {visibleItems.length ? visibleItems.map((item) => (
                <button
                  className={`material-item-row ${selectedItem?.path === item.path ? "active" : ""}`}
                  key={item.path}
                  type="button"
                  onClick={() => setSelectedItem(item)}
                  title={item.path}
                >
                  <span>{item.name}</span>
                  <em>{item.categoryLabel} · {item.kind === "audio" ? "音频" : orientationLabel(item.orientation)} · {formatDuration(item.durationSec)}</em>
                  <b>{item.width && item.height ? `${item.width}x${item.height}` : formatBytes(item.size)}</b>
                </button>
              )) : <div className="task-empty">{selectedRoot ? "没有符合筛选的素材" : "请选择素材源"}</div>}
            </div>
          </div>
        </section>

        {selectedItem ? (
          <section className="material-main">
            <div className="material-player">
              {selectedItem.kind === "audio" ? (
                <audio key={selectedItem.path} src={selectedItem.url} controls />
              ) : (
                <video key={selectedItem.path} src={selectedItem.url} controls />
              )}
            </div>
            <section className="export-inspector box">
              <div className="box-h">素材信息</div>
              <div className="export-info">
                <label>
                  <span>文件名</span>
                  <b title={selectedItem.name}>{selectedItem.name}</b>
                </label>
                <label>
                  <span>分类</span>
                  <b>{selectedItem.categoryLabel}</b>
                </label>
                <label>
                  <span>类型</span>
                  <b>{selectedItem.kind === "audio" ? "音频" : "视频"}</b>
                </label>
                <label>
                  <span>时长</span>
                  <b>{formatDuration(selectedItem.durationSec)}</b>
                </label>
                <label>
                  <span>方向</span>
                  <b>{orientationLabel(selectedItem.orientation)}</b>
                </label>
                <label>
                  <span>分辨率</span>
                  <b>{selectedItem.width && selectedItem.height ? `${selectedItem.width}x${selectedItem.height}` : "-"}</b>
                </label>
                <label>
                  <span>音频</span>
                  <b>{selectedItem.hasAudio ? "有" : "无"}</b>
                </label>
                <label>
                  <span>大小</span>
                  <b>{formatBytes(selectedItem.size)}</b>
                </label>
                <label>
                  <span>修改时间</span>
                  <b>{formatTime(selectedItem.modifiedAt)}</b>
                </label>
                <label className="wide">
                  <span>素材源</span>
                  <b title={selectedItem.rootPath}>{selectedItem.rootPath}</b>
                </label>
                <label className="wide">
                  <span>文件路径</span>
                  <b title={selectedItem.path}>{selectedItem.path}</b>
                </label>
              </div>
            </section>
          </section>
        ) : null}
      </div>
    </div>
  );
}
