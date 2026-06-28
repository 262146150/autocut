// modules.ts — 模块清单（1:1 对应 ECutAuto 的 Vite chunk）+ 首页分类数据（按截图复刻）

export type IconName =
  | "spark" | "fx" | "arrow" | "layers" | "doc" | "flame"
  | "caption" | "tag" | "image" | "poster" | "mic" | "video";

export interface ModuleDef {
  id: string;
  icon: IconName;
  name: string;
  ready: boolean;
  desc: string;
  tags: string[];
}

export const CATS: Record<string, ModuleDef[]> = {
  创作中心: [
    { id: "ai-smart-mix", icon: "spark", name: "AI 智能混剪", ready: true,
      desc: "输入文案，AI 自动根据文案从您的素材中自动匹配符合文案的素材，一键生成混剪视频。",
      tags: ["Ai智能混剪", "语音合成", "字幕识别", "视频理解"] },
    { id: "video-effects", icon: "fx", name: "视频效果处理", ready: false,
      desc: "十几种效果一键应用，支持去水印、加文字/图片/视频水印、加贴画。一键裂变999+差异化视频",
      tags: ["批量处理", "裂变", "Ai智能分割", "差异化处理"] },
    { id: "interval-mix", icon: "arrow", name: "视频混剪", ready: true,
      desc: "多文件夹素材混剪，支持随机打乱重组 文案转语音配音，一键生成混剪视频",
      tags: ["视频混剪", "语音合成", "字幕识别", "随机重组"] },
    { id: "smart-segment", icon: "layers", name: "智能分割", ready: true,
      desc: "自动检测镜头边界，把长视频拆成可复用片段库，供 AI 智能混剪和其他视频处理模块复用。",
      tags: ["镜头检测", "素材预处理", "TransNetV2", "片段库"] },
    { id: "category-mix", icon: "layers", name: "分类混剪", ready: false,
      desc: "按分类文件夹自动组合混剪，支持自定义/文案/音频模式 拖拽排序分类文件夹，随机或顺序抽取素材，一键生成混剪视频",
      tags: ["分类混剪", "语音合成", "字幕识别", "多文件夹"] },
    { id: "text-rewrite", icon: "doc", name: "文案改写", ready: false,
      desc: "粘贴文案，AI 智能改写降低重复率 多个叙事视角，一次生成多个版本",
      tags: ["AI改写", "文案优化", "多版本"] },
    { id: "live-clip", icon: "flame", name: "视频内容提炼", ready: false,
      desc: "根据文案从长视频中提取有价值片段并重新组合，AI 智能识别 或 手动选取，可自定义Ai提示词。适用于电商带货、知识干货、vlog、直播访谈等场景",
      tags: ["视频切片", "直播切片", "精华提取", "AI筛选"] },
  ],
  效率工具: [
    { id: "material-library", icon: "layers", name: "素材仓库", ready: true,
      desc: "管理本地素材源，查看原始素材、分割片段、成品复用和音频素材，供混剪与 AI 智能混剪复用。",
      tags: ["素材管理", "本地目录", "分割片段", "素材预览"] },
    { id: "export-library", icon: "video", name: "产出记录", ready: true,
      desc: "浏览本地导出目录，按日期、批次和视频查看成片，并在工作台内直接预览。",
      tags: ["产出记录", "本地目录", "视频预览"] },
    { id: "subtitle", icon: "caption", name: "字幕识别", ready: false,
      desc: "本地语音识别(ASR)，导出 SRT/词级时间戳，支持多语言与关键词。",
      tags: ["语音识别", "SRT", "词级时间戳", "多语言"] },
    { id: "image-to-video", icon: "image", name: "图片转视频", ready: false,
      desc: "图片批量合成视频，支持运镜、转场与配乐。", tags: ["图片成片", "运镜", "转场"] },
    { id: "file-rename", icon: "tag", name: "文件重命名", ready: false,
      desc: "批量规则重命名，前后缀/序号/智能命名。", tags: ["批量", "规则", "前后缀"] },
    { id: "poster", icon: "poster", name: "封面设计", ready: false,
      desc: "生成视频封面/海报，模板化排版。", tags: ["封面", "海报", "模板"] },
  ],
  自动化: [
    { id: "ai-narration", icon: "mic", name: "AI 解说口播", ready: false,
      desc: "AI 生成解说文案并配音，长视频转口播成片。", tags: ["解说", "配音", "口播"] },
  ],
};

export const ALL: ModuleDef[] = Object.values(CATS).flat();

/** 这些可用模块复用「混剪三栏」布局。 */
export const MIX_LAYOUT_IDS = ["ai-smart-mix", "interval-mix", "category-mix", "live-clip", "video-effects"];
