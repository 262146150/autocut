// Stub.tsx — 占位模块（结构就位，逻辑待接 docs/01·02）
import { Link } from "react-router-dom";
import type { ModuleDef } from "../data/modules";
import { Icon } from "../components/Icons";

export default function Stub({ mod }: { mod: ModuleDef }) {
  return (
    <div className="modwrap">
      <div className="modbar"><Link to="/">‹ 返回工作站</Link><b>{mod.name}</b></div>
      <div className="stub">
        <div className="empty">
          <div className="big"><Icon name={mod.icon} size={40} /></div>
          <div className="t">{mod.name} · 结构已就位</div>
          <div className="s">逻辑按 docs/01（滤镜配方）·02（数据模型）接入即可</div>
        </div>
      </div>
    </div>
  );
}
