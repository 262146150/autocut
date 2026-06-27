// controls.tsx — 复用控件（开关/滑块/分段/步进器/分组/字段），样式对应 styles.css
import { useState, type ReactNode } from "react";

export function Switch({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <label className="switch">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <i />
    </label>
  );
}

export function Slider({ value, max = 100, unit = "%", display }: { value: number; max?: number; unit?: string; display?: string }) {
  const [v, setV] = useState(value);
  return (
    <>
      <input type="range" min={0} max={max} value={v} onChange={(e) => setV(+e.target.value)} />
      <span className="val">{display ?? `${v}${unit}`}</span>
    </>
  );
}

export function Seg({ options, active = 0 }: { options: string[]; active?: number }) {
  const [idx, setIdx] = useState(active);
  return (
    <div className="seg">
      {options.map((o, i) => (
        <button key={o} className={i === idx ? "active" : ""} onClick={() => setIdx(i)}>{o}</button>
      ))}
    </div>
  );
}

export function NumStepper({ value, step = 1 }: { value: number; step?: number }) {
  const [v, setV] = useState(value);
  return (
    <span className="num">
      <input type="number" value={v} onChange={(e) => setV(+e.target.value)} />
      <span className="arrows">
        <button onClick={() => setV((x) => +(x + step).toFixed(2))}>▲</button>
        <button onClick={() => setV((x) => +(x - step).toFixed(2))}>▼</button>
      </span>
    </span>
  );
}

export function Group({ title, withSwitch, switchOn, badge, children }:
  { title: string; withSwitch?: boolean; switchOn?: boolean; badge?: string; children: ReactNode }) {
  return (
    <div className="group">
      <div className="group-h">
        <span className="t">{title}</span>
        {badge ? <span className="badge">{badge}</span> : withSwitch ? <Switch defaultOn={switchOn} /> : null}
      </div>
      {children}
    </div>
  );
}

export function Field({ label, children, valEnd }: { label?: string; children: ReactNode; valEnd?: boolean }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {valEnd ? <div style={{ marginLeft: "auto" }}>{children}</div> : children}
    </div>
  );
}
