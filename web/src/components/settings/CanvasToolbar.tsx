import { SettingSegment } from "./SettingControls";
import type { AspectRatio, FillMode } from "./types";

export function CanvasToolbar({
  aspect,
  fillMode,
  onAspectChange,
  onFillModeChange,
}: {
  aspect: AspectRatio;
  fillMode: FillMode;
  onAspectChange: (value: AspectRatio) => void;
  onFillModeChange: (value: FillMode) => void;
}) {
  return (
    <div className="preview-h" aria-label="视频预览设置">
      <div className="preview-tools">
        <div className="preview-tool-group">
          <span className="preview-tool-label">比例</span>
          <SettingSegment
            value={aspect}
            onChange={onAspectChange}
            options={[
              { value: "9:16", label: "9:16" },
              { value: "16:9", label: "16:9" },
            ]}
          />
        </div>
        <div className="preview-tool-group">
          <span className="preview-tool-label">填充</span>
          <SettingSegment
            value={fillMode}
            onChange={onFillModeChange}
            options={[
              { value: "blur", label: "虚化" },
              { value: "black", label: "纯黑" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
