// App.tsx — 常驻工作台导航 + 模块页（混剪布局复用 / 其余占位）
import { useEffect, useState } from "react";
import { NavLink, Routes, Route, useParams, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import SmartMix from "./pages/SmartMix";
import SmartSegment from "./pages/SmartSegment";
import HighlightClip from "./pages/HighlightClip";
import ImageToVideo from "./pages/ImageToVideo";
import ExportLibrary from "./pages/ExportLibrary";
import MaterialLibrary from "./pages/MaterialLibrary";
import Settings from "./pages/Settings";
import Stub from "./pages/Stub";
import { ALL, MIX_LAYOUT_IDS, NAV_CATS, type ModuleDef } from "./data/modules";
import { Icon } from "./components/Icons";
import { activateLicense, getAuthStatus, loginUser, registerUser, type AuthStatus } from "./api";

function ModulePage() {
  const { id } = useParams();
  const mod = ALL.find((m) => m.id === id);
  if (!mod || !mod.ready) return <Navigate to="/" replace />;
  if (mod.id === "smart-segment") return <SmartSegment mod={mod} />;
  if (mod.id === "live-clip") return <HighlightClip mod={mod} />;
  if (mod.id === "image-to-video") return <ImageToVideo mod={mod} />;
  if (mod.id === "material-library") return <MaterialLibrary mod={mod} />;
  if (mod.id === "export-library") return <ExportLibrary mod={mod} />;
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

function formatLicenseDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN");
}

function activationHint(status: AuthStatus | null) {
  if (!status || !status.registered) return "首次使用需要注册或登录账号，再输入激活码完成授权。";
  if (status.reason === "device_mismatch") return "当前授权已绑定到其他设备，请使用新的激活码或联系管理员处理。";
  if (status.expired) return "当前授权已过期，请输入新的激活码续期。";
  if (status.warning) return `授权服务暂时不可用，当前使用本机缓存：${status.warning}`;
  return "账号已登录，请输入购买或分配的激活码完成授权。";
}

function ActivationGate({ status, onActivated }: { status: AuthStatus | null; onActivated: () => void }) {
  const [account, setAccount] = useState(status?.user?.account ?? "");
  const [name, setName] = useState(status?.user?.name ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(activationHint(status));
  const [busy, setBusy] = useState<"" | "register" | "login" | "activate">("");

  useEffect(() => {
    setAccount(status?.user?.account ?? "");
    setName(status?.user?.name ?? "");
    setMessage(activationHint(status));
  }, [status]);

  const register = async () => {
    setBusy("register");
    try {
      const result = await registerUser({ account, password, name });
      setMessage(result.status.active ? "注册成功，授权已生效。" : "注册成功，请输入激活码。");
      onActivated();
    } catch (err) {
      setMessage("注册失败：" + (err as Error).message);
    } finally {
      setBusy("");
    }
  };

  const login = async () => {
    setBusy("login");
    try {
      const result = await loginUser({ account, password });
      setMessage(result.status.active ? "登录成功，授权已生效。" : "登录成功，请输入激活码。");
      onActivated();
    } catch (err) {
      setMessage("登录失败：" + (err as Error).message);
    } finally {
      setBusy("");
    }
  };

  const activate = async () => {
    setBusy("activate");
    try {
      const next = await activateLicense(code);
      if (!next.active) throw new Error("激活后仍未获得有效授权");
      setMessage("激活成功");
      onActivated();
    } catch (err) {
      setMessage("激活失败：" + (err as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="activation-page">
      <section className="activation-card">
        <div className="activation-head">
          <span>账号授权</span>
          <h1>注册并激活后使用</h1>
          <p>{message}</p>
        </div>

        <div className="activation-status">
          <label>
            <span>当前状态</span>
            <b>{status?.active ? "已激活" : status?.reason === "device_mismatch" ? "设备不匹配" : status?.expired ? "授权过期" : status?.registered ? "待激活" : "未登录"}</b>
          </label>
          <label>
            <span>到期时间</span>
            <b>{formatLicenseDate(status?.license?.expiresAt)}</b>
          </label>
          <label>
            <span>授权类型</span>
            <b>{status?.license?.type === "official" ? "正式" : status?.license?.type === "trial" ? "试用" : "-"}</b>
          </label>
          <label>
            <span>授权服务</span>
            {/* <b>{status?.serviceUrl || "-"}</b> */}
            <b>正常</b>
          </label>
        </div>

        <div className="activation-form">
          <label htmlFor="activation-account">
            <span>账号</span>
            <input
              id="activation-account"
              className="inp"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="手机号或邮箱"
              autoComplete="username"
            />
          </label>
          <label htmlFor="activation-name">
            <span>昵称</span>
            <input
              id="activation-name"
              className="inp"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="可选"
            />
          </label>
          <label htmlFor="activation-password">
            <span>密码</span>
            <input
              id="activation-password"
              className="inp"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete="current-password"
            />
          </label>
          <div className="activation-actions">
            <button className="import-btn" type="button" onClick={register} disabled={Boolean(busy) || !account.trim() || password.length < 6}>
              {busy === "register" ? "注册中" : "注册账号"}
            </button>
            <button className="ghost-btn" type="button" onClick={login} disabled={Boolean(busy) || !account.trim() || !password}>
              {busy === "login" ? "登录中" : "登录"}
            </button>
          </div>
        </div>

        <div className="activation-form">
          <label htmlFor="activation-code">
            <span>激活码</span>
            <input
              id="activation-code"
              className="inp"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ECT/ECF 开头的激活码"
              autoComplete="off"
            />
          </label>
          <button className="cta ready" type="button" onClick={activate} disabled={Boolean(busy) || !status?.registered || !code.trim()}>
            {busy === "activate" ? "激活中" : status?.expired ? "续期并进入" : "激活并进入"}
          </button>
        </div>
      </section>
    </div>
  );
}

function WorkbenchShell() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const refreshAuth = async () => {
    setAuthLoading(true);
    try {
      setAuth(await getAuthStatus());
    } catch {
      setAuth(null);
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    void refreshAuth();
  }, []);

  const workspaceContent = authLoading ? (
    <div className="activation-page">
      <section className="activation-card">
        <div className="activation-head">
          <span>账号授权</span>
          <h1>正在检查授权</h1>
          <p>正在读取本机授权状态。</p>
        </div>
      </section>
    </div>
  ) : auth?.active ? (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/:id" element={<ModulePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  ) : (
    <ActivationGate status={auth} onActivated={refreshAuth} />
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <NavLink className="logo" to="/">
          <span className="logo-mark">E</span>
          <span className="logo-text">ECutAuto</span>
          <small>MVP</small>
        </NavLink>
        <nav id="nav" aria-label="主导航">
          {Object.entries(NAV_CATS).map(([cat, modules]) => (
            <div className="nav-group" key={cat}>
              <div className="nav-group-title">{cat}</div>
              {modules.map((mod) => <NavItem key={mod.id} mod={mod} />)}
            </div>
          ))}
        </nav>
        <NavLink className={({ isActive }) => `sidebar-settings ${isActive ? "active" : ""}`} to="/settings">
          <span className="nav-ic"><Icon name="settings" size={18} /></span>
          <span className="nav-label">系统设置</span>
        </NavLink>
        <div className="foot">本地工作台</div>
      </aside>
      <main className="workspace">
        {workspaceContent}
      </main>
    </div>
  );
}

export default function App() {
  return <WorkbenchShell />;
}
