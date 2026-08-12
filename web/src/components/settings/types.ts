export type AspectRatio = "9:16" | "16:9";
export type AspectRatioMode = AspectRatio | "auto";
export type FillMode = "blur" | "black";
export type Resolution = "1080p" | "720p";
export type MotionMode = "none" | "zoomIn" | "zoomOut" | "drift";
export type TransitionMode = "fade" | "none";
export type ExportQuality = "standard" | "high" | "best";

export type SubtitleFontOption = {
  label: string;
  family: string;
  file: string;
};

export const SUBTITLE_FONTS: SubtitleFontOption[] = [
  { label: "苹方简体", family: "PingFang SC", file: "/System/Library/Fonts/PingFang.ttc" },
  { label: "冬青黑体", family: "Hiragino Sans GB", file: "/System/Library/Fonts/Hiragino Sans GB.ttc" },
  { label: "系统黑体", family: "Heiti SC", file: "/System/Library/Fonts/STHeiti Medium.ttc" },
  { label: "系统宋体", family: "Songti SC", file: "/System/Library/Fonts/Supplemental/Songti.ttc" },
];
