import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listExports,
  listMaterialLibrary,
  type ExportBatchItem,
  type ExportLibrary,
  type MaterialLibraryData,
} from "../api";
import { ALL, type IconName, type ModuleDef } from "../data/modules";
import { Icon } from "../components/Icons";

type HomeState = {
  material: MaterialLibraryData | null;
  exports: ExportLibrary | null;
  loading: boolean;
  error: string;
};

type RecentBatch = ExportBatchItem & {
  date: string;
};

const QUICK_IDS = ["ai-smart-mix", "interval-mix", "smart-segment"];

function moduleById(id: string) {
  return ALL.find((item) => item.id === id);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Math.round(Number(value) || 0)));
}

function formatDuration(seconds?: number) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h) return `${h} 小时 ${m} 分钟`;
  return `${m} 分钟`;
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function statFromCategory(material: MaterialLibraryData | null, category: "raw" | "segments" | "reuse" | "audio") {
  const roots = material?.roots.filter((root) => root.exists && root.category === category) ?? [];
  return {
    roots: roots.length,
    videos: roots.reduce((sum, root) => sum + root.videoCount, 0),
    audios: roots.reduce((sum, root) => sum + root.audioCount, 0),
  };
}

function flattenRecentBatches(data: ExportLibrary | null) {
  const batches: RecentBatch[] = [];
  for (const date of data?.dates ?? []) {
    for (const batch of date.batches) batches.push({ ...batch, date: date.date });
  }
  return batches
    .sort((a, b) => new Date(b.modifiedAt || b.createdAt).getTime() - new Date(a.modifiedAt || a.createdAt).getTime())
    .slice(0, 5);
}

function FlowStep({
  icon,
  title,
  meta,
  to,
  active = true,
}: {
  icon: IconName;
  title: string;
  meta: string;
  to: string;
  active?: boolean;
}) {
  return (
    <Link className={`home-flow-step ${active ? "active" : ""}`} to={to}>
      <span className="home-flow-ic"><Icon name={icon} size={18} /></span>
      <b>{title}</b>
      <em>{meta}</em>
    </Link>
  );
}

function QuickStart({ mod }: { mod: ModuleDef }) {
  return (
    <Link className="home-quick-card" to={`/${mod.id}`}>
      <span><Icon name={mod.icon} size={20} /></span>
      <b>{mod.name}</b>
      <em>{mod.desc}</em>
    </Link>
  );
}

export default function Home() {
  const [state, setState] = useState<HomeState>({
    material: null,
    exports: null,
    loading: true,
    error: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const [material, exportsData] = await Promise.all([listMaterialLibrary(), listExports()]);
        if (!cancelled) setState({ material, exports: exportsData, loading: false, error: "" });
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: "读取本地工作台状态失败：" + (err as Error).message,
          }));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const raw = useMemo(() => statFromCategory(state.material, "raw"), [state.material]);
  const segments = useMemo(() => statFromCategory(state.material, "segments"), [state.material]);
  const reuse = useMemo(() => statFromCategory(state.material, "reuse"), [state.material]);
  const recentBatches = useMemo(() => flattenRecentBatches(state.exports), [state.exports]);
  const exportVideos = useMemo(
    () => state.exports?.dates.reduce((sum, date) => sum + date.count, 0) ?? 0,
    [state.exports],
  );
  const exportBatches = useMemo(
    () => state.exports?.dates.reduce((sum, date) => sum + date.batches.length, 0) ?? 0,
    [state.exports],
  );
  const quickModules = useMemo(() => QUICK_IDS.map(moduleById).filter(Boolean) as ModuleDef[], []);
  const totalVideoMinutes = formatDuration(state.material?.totals.durationSec);

  const suggestion = useMemo(() => {
    if (state.loading) return "正在读取素材和产出状态。";
    if (state.error) return "本地服务状态异常，先确认后端是否正在运行。";
    if (!state.material?.totals.videos) return "先进入素材仓库添加原始素材，再开始分割或混剪。";
    if (raw.videos > 0 && segments.videos === 0) return "已有原始素材，建议先用智能分割建立片段库。";
    if (segments.videos > 0) return "已有分割片段，可以直接进入 AI 智能混剪按文案匹配画面。";
    if (exportVideos > 0) return "已有产出记录，可把效果好的成片加入素材仓库做成品复用。";
    return "素材已准备好，可以从视频混剪开始生成第一批成片。";
  }, [exportVideos, raw.videos, segments.videos, state.error, state.loading, state.material]);

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-main">
          <span className="home-kicker">本地混剪工作台</span>
          <h1>从素材到成片的生成总览</h1>
          <p>{state.error || suggestion}</p>
        </div>
        <div className="home-actions">
          <Link className="import-btn" to="/ai-smart-mix">开始 AI 智能混剪</Link>
          <Link className="icon-btn text-btn" to="/material-library">管理素材</Link>
        </div>
      </section>

      <section className="home-stats" aria-label="工作台统计">
        <div className="home-stat">
          <span>素材源</span>
          <b>{formatNumber(state.material?.totals.roots ?? 0)}</b>
          <em>{formatNumber(state.material?.totals.validRoots ?? 0)} 个可用</em>
        </div>
        <div className="home-stat">
          <span>视频素材</span>
          <b>{formatNumber(state.material?.totals.videos ?? 0)}</b>
          <em>总时长 {totalVideoMinutes}</em>
        </div>
        <div className="home-stat">
          <span>分割片段</span>
          <b>{formatNumber(segments.videos)}</b>
          <em>{formatNumber(segments.roots)} 个片段源</em>
        </div>
        <div className="home-stat">
          <span>产出视频</span>
          <b>{formatNumber(exportVideos)}</b>
          <em>{formatNumber(exportBatches)} 个批次</em>
        </div>
      </section>

      <section className="home-flow" aria-label="混剪流程">
        <FlowStep icon="layers" title="素材仓库" meta={`${formatNumber(raw.videos)} 个原始视频`} to="/material-library" active={raw.videos > 0} />
        <FlowStep icon="layers" title="智能分割" meta={`${formatNumber(segments.videos)} 个分割片段`} to="/smart-segment" active={raw.videos > 0 || segments.videos > 0} />
        <FlowStep icon="spark" title="AI 智能混剪" meta={segments.videos ? "片段库可用" : "建议先准备片段"} to="/ai-smart-mix" active={segments.videos > 0} />
        <FlowStep icon="video" title="产出记录" meta={`${formatNumber(exportVideos)} 个视频`} to="/export-library" active={exportVideos > 0} />
      </section>

      <div className="home-main">
        <section className="home-panel">
          <div className="home-panel-h">
            <b>快捷开始</b>
            <span>选择当前任务</span>
          </div>
          <div className="home-quick-grid">
            {quickModules.map((mod) => <QuickStart key={mod.id} mod={mod} />)}
          </div>
        </section>

        <section className="home-panel">
          <div className="home-panel-h">
            <b>素材结构</b>
            <span>当前入库资产</span>
          </div>
          <div className="home-material-bars">
            <div>
              <span>原始素材</span>
              <b>视频 {formatNumber(raw.videos)} · 音频 {formatNumber(raw.audios)}</b>
            </div>
            <div>
              <span>分割片段</span>
              <b>视频 {formatNumber(segments.videos)} · 音频 {formatNumber(segments.audios)}</b>
            </div>
            <div>
              <span>成品复用</span>
              <b>视频 {formatNumber(reuse.videos)} · 音频 {formatNumber(reuse.audios)}</b>
            </div>
          </div>
        </section>
      </div>

      <section className="home-panel home-recent">
        <div className="home-panel-h">
          <b>最近产出</b>
          <Link to="/export-library">查看全部</Link>
        </div>
        {recentBatches.length ? (
          <div className="home-recent-list">
            {recentBatches.map((batch) => (
              <Link className="home-recent-row" to="/export-library" key={batch.dir}>
                <span>{batch.name}</span>
                <em>{batch.date} · {batch.modeLabel || "混剪"} · {formatTime(batch.modifiedAt)}</em>
                <b>{formatNumber(batch.videoCount)} 个视频</b>
              </Link>
            ))}
          </div>
        ) : (
          <div className="home-empty">
            <b>还没有产出记录</b>
            <span>完成一次混剪后，批次和视频会出现在这里。</span>
          </div>
        )}
      </section>
    </div>
  );
}
