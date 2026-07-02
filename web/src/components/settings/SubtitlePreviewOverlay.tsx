import type { CSSProperties, PointerEventHandler } from "react";
import { SUBTITLE_FONTS } from "./types";

export function SubtitlePreviewOverlay({
  enabled = true,
  text,
  fontIndex,
  fontSize,
  opacity,
  outlineWidth,
  color,
  outlineColor,
  x = 50,
  y = 82,
  active = false,
  className = "",
  onPointerDown,
}: {
  enabled?: boolean;
  text: string;
  fontIndex: number;
  fontSize: number;
  opacity: number;
  outlineWidth: number;
  color: string;
  outlineColor: string;
  x?: number;
  y?: number;
  active?: boolean;
  className?: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
}) {
  if (!enabled || !text.trim()) return null;

  const font = SUBTITLE_FONTS[fontIndex] ?? SUBTITLE_FONTS[0];
  const previewFontSize = Math.max(18, Math.round(fontSize * 0.46));
  const previewOutlineWidth = outlineWidth <= 0 ? 0 : Math.max(1, Math.round(outlineWidth * 0.65));
  const normalizedOpacity = opacity > 1 ? opacity / 100 : opacity;
  const style: CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    fontFamily: `"${font.family}", sans-serif`,
    fontSize: previewFontSize,
    color,
    opacity: normalizedOpacity,
    WebkitTextStroke: `${previewOutlineWidth}px ${outlineColor}`,
    textShadow: outlineWidth > 0 ? `0 1px 2px ${outlineColor}` : "none",
    pointerEvents: onPointerDown ? "auto" : "none",
    cursor: onPointerDown ? "move" : "default",
  };

  return (
    <div
      className={`subtitle-preview text-overlay ${active ? "active" : ""} ${className}`.trim()}
      style={style}
      onPointerDown={onPointerDown}
    >
      {text}
    </div>
  );
}
