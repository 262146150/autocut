// App.tsx — 常驻工作台导航 + 模块页（混剪布局复用 / 其余占位）
import { NavLink, Routes, Route, useParams, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import SmartMix from "./pages/SmartMix";
import SmartSegment from "./pages/SmartSegment";
import Stub from "./pages/Stub";
import { ALL, CATS, MIX_LAYOUT_IDS, type ModuleDef } from "./data/modules";
import { Icon } from "./components/Icons";

function ModulePage() {
  const { id } = useParams();
  const mod = ALL.find((m) => m.id === id);
  if (!mod || !mod.ready) return <Navigate to="/" replace />;
  if (mod.id === "smart-segment") return <SmartSegment mod={mod} />;
  return MIX_LAYOUT_IDS.includes(mod.id) ? <SmartMix mod={mod} /> : <Stub mod={mod} />;
}

function NavItem({ mod }: { mod: ModuleDef }) {
  const inner = (
    <>
      <span className="nav-ic"><Icon name={mod.icon} size={18} /></span>
      <span className="nav-label">{mod.name}</span>
      {!mod.ready ? <span className="nav-soon">soon</span> : null}
    </>
  );
  return mod.ready ? (
    <NavLink className={({ isActive }) => isActive ? "active" : ""} to={`/${mod.id}`}>
      {inner}
    </NavLink>
  ) : (
    <span className="nav-disabled">{inner}</span>
  );
}

function WorkbenchShell() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <NavLink className="logo" to="/">
          <span className="logo-mark">E</span>
          <span className="logo-text">ECutAuto</span>
          <small>MVP</small>
        </NavLink>
        <nav id="nav" aria-label="主导航">
          {Object.entries(CATS).map(([cat, modules]) => (
            <div className="nav-group" key={cat}>
              <div className="nav-group-title">{cat}</div>
              {modules.map((mod) => <NavItem key={mod.id} mod={mod} />)}
            </div>
          ))}
        </nav>
        <div className="foot">本地工作台</div>
      </aside>
      <main className="workspace">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/:id" element={<ModulePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return <WorkbenchShell />;
}
