// App.tsx — 路由：首页 + 模块页（混剪布局复用 / 其余占位）
import { Routes, Route, useParams, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import SmartMix from "./pages/SmartMix";
import Stub from "./pages/Stub";
import { ALL, MIX_LAYOUT_IDS } from "./data/modules";

function ModulePage() {
  const { id } = useParams();
  const mod = ALL.find((m) => m.id === id);
  if (!mod || !mod.ready) return <Navigate to="/" replace />;
  return MIX_LAYOUT_IDS.includes(mod.id) ? <SmartMix mod={mod} /> : <Stub mod={mod} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/:id" element={<ModulePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
