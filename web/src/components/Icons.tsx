// Icons.tsx — 内联 SVG 图标（teal 线性）
import type { IconName } from "../data/modules";

const PATHS: Record<IconName, JSX.Element> = {
  spark: (<><path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4z" fill="currentColor" /><circle cx="18" cy="5" r="1.3" fill="currentColor" /></>),
  fx: (<><path d="M5 12l1.3 3.2L9.5 16l-3.2 1.3L5 20l-1.3-3.2L.5 16l3.2-.8z" fill="currentColor" /><path d="M14 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="currentColor" /></>),
  arrow: (<path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />),
  layers: (<path d="M12 3l9 5-9 5-9-5z M3 13l9 5 9-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />),
  doc: (<path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />),
  flame: (<path d="M12 3c1 4-3 5-3 9a3 3 0 006 0c0-1.5-1-2.5-1-4 2 1 3 3 3 5a6 6 0 11-12 0c0-4 4-6 7-10z" fill="currentColor" />),
  caption: (<><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M7 13h5M14 13h3M7 16h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  tag: (<><path d="M3 12l8-8h8v8l-8 8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="15" cy="9" r="1.4" fill="currentColor" /></>),
  image: (<><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" /><path d="M5 18l5-5 4 3 3-2 4 4" fill="none" stroke="currentColor" strokeWidth="2" /></>),
  poster: (<><rect x="4" y="3" width="16" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  mic: (<><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M6 11a6 6 0 0012 0M12 17v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  video: (<><rect x="3" y="6" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 10l5-3v10l-5-3z" fill="currentColor" /></>),
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}>
      {PATHS[name]}
    </svg>
  );
}
