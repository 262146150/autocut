// Stub.tsx — 尚未接入业务逻辑的模块占位页。
import type { ModuleDef } from "../data/modules";
import { Icon } from "../components/Icons";

export default function Stub({ mod }: { mod: ModuleDef }) {
  return (
    <div className="modwrap">
      <div className="modbar">
        <div className="mod-title">
          <b>{mod.name}</b>
          <span>模块待接入</span>
        </div>
      </div>
      <div className="stub">
        <div className="empty">
          <div className="big"><Icon name={mod.icon} size={40} /></div>
          <div className="t">{mod.name} · 结构已就位</div>
          <div className="s">该模块尚未接入本地处理管线</div>
        </div>
      </div>
    </div>
  );
}
