import type { ReactNode } from "react";

export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
};

export function SettingSegment<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`mini-seg compact ${className}`.trim()}>
      {options.map((option) => (
        <button
          className={value === option.value ? "active" : ""}
          disabled={option.disabled}
          key={option.value}
          title={option.title}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function NumberSettingInput({
  value,
  onChange,
  min = 0,
  max,
  className = "inp small-inp",
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
  disabled?: boolean;
}) {
  const normalize = (raw: string) => {
    const parsed = Number(raw);
    const base = Number.isFinite(parsed) ? parsed : min;
    const floor = Math.max(min, base);
    return typeof max === "number" ? Math.min(max, floor) : floor;
  };

  return (
    <input
      className={className}
      disabled={disabled}
      max={max}
      min={min}
      type="number"
      value={value}
      onChange={(event) => onChange(normalize(event.target.value))}
    />
  );
}

export function ControlledSlider({
  value,
  onChange,
  max = 100,
  min = 0,
  unit = "%",
  display,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  min?: number;
  unit?: string;
  display?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <input
        disabled={disabled}
        max={max}
        min={min}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="val">{display ?? `${value}${unit}`}</span>
    </>
  );
}

export function hexColor(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return "#" + value.slice(1).split("").map((char) => char + char).join("");
  }
  return "#ffffff";
}

export function ColorInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="image-color-input">
      <span style={{ background: value }} />
      <input
        disabled={disabled}
        type="color"
        value={hexColor(value)}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function rateLabel(value: number) {
  return `${(1 + value / 100).toFixed(1)}x`;
}
