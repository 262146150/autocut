import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Ban,
  BarChart3,
  CheckCircle2,
  Clipboard,
  KeyRound,
  ListFilter,
  RefreshCw,
  Send,
  Shield,
  Users,
} from "lucide-react";
import "./styles.css";

const TABS = [
  { id: "overview", label: "概览", icon: BarChart3 },
  { id: "users", label: "用户管理", icon: Users },
  { id: "codes", label: "激活码", icon: KeyRound },
  { id: "issue", label: "生成发放", icon: Send },
  { id: "events", label: "使用数据", icon: Activity },
  { id: "logs", label: "操作日志", icon: ListFilter },
];

const STATUS_LABELS = {
  available: "库存",
  issued: "已发放",
  used: "已激活",
  revoked: "已作废",
  active: "正常",
  disabled: "停用",
  failed: "失败",
};

function fmtDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function useAdminApi(token) {
  return useMemo(() => {
    async function request(path, options = {}) {
      const resp = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
          ...(options.headers || {}),
        },
      });
      const text = await resp.text();
      const data = text ? JSON.parse(text) : {};
      if (!resp.ok) throw new Error(data.message || `请求失败：HTTP ${resp.status}`);
      return data;
    }
    return {
      stats: () => request("/api/admin/stats"),
      users: (params) => request(`/api/admin/users?${new URLSearchParams(params)}`),
      updateUser: (id, body) => request(`/api/admin/users/${id}`, { method: "POST", body: JSON.stringify(body) }),
      codes: (params) => request(`/api/admin/activation-codes?${new URLSearchParams(params)}`),
      createCodes: (body) => request("/api/admin/activation-codes", { method: "POST", body: JSON.stringify(body) }),
      issueCodes: (body) => request("/api/admin/activation-codes/issue", { method: "POST", body: JSON.stringify(body) }),
      revokeCode: (id, body) => request(`/api/admin/activation-codes/${id}/revoke`, { method: "POST", body: JSON.stringify(body) }),
      eventSummary: () => request("/api/admin/client-events/summary"),
      events: (params) => request(`/api/admin/client-events?${new URLSearchParams(params)}`),
      logs: (params) => request(`/api/admin/logs?${new URLSearchParams(params)}`),
    };
  }, [token]);
}

function TokenGate({ token, setToken }) {
  const [value, setValue] = useState(token);
  return (
    <main className="gate">
      <section className="gate-card">
        <div className="brand-row">
          <span className="brand-mark"><Shield size={22} /></span>
          <div>
            <h1>授权服务后台</h1>
            <p>输入 `AUTH_ADMIN_TOKEN` 后进入管理台。</p>
          </div>
        </div>
        <label>
          <span>管理员 Token</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} type="password" placeholder="AUTH_ADMIN_TOKEN" />
        </label>
        <button onClick={() => setToken(value.trim())} disabled={!value.trim()}>进入后台</button>
      </section>
    </main>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <b>{value ?? 0}</b>
      <small>{hint}</small>
    </div>
  );
}

function Overview({ api, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.stats().then(setData).catch((err) => setError(err.message));
  }, [api, refreshKey]);
  if (error) return <EmptyState text={error} />;
  if (!data) return <EmptyState text="正在读取统计..." />;
  return (
    <div className="page-grid">
      <section className="panel">
        <PanelHead title="基础统计" desc="用户、授权和激活码库存状态" />
        <div className="stats-grid">
          <StatCard label="用户总数" value={data.users.total} hint={`近 7 天新增 ${data.users.new7d}`} />
          <StatCard label="有效授权" value={data.licenses.active} hint={`过期 ${data.licenses.expired}`} />
          <StatCard label="库存码" value={data.codes.available} hint="未发放" />
          <StatCard label="已发未激活" value={data.codes.issued} hint="不可重复发放" />
          <StatCard label="已激活码" value={data.codes.used} hint="已绑定用户设备" />
          <StatCard label="作废码" value={data.codes.revoked} hint="不可使用" />
          <StatCard label="使用事件" value={data.events.total} hint={`近 7 天 ${data.events.last7d}，失败 ${data.events.failed}`} />
        </div>
      </section>
      <section className="panel">
        <PanelHead title="近 7 天操作" desc="授权服务记录的主要操作" />
        <div className="log-mini">
          {data.recentLogs.length ? data.recentLogs.map((item) => (
            <div key={item.action}>
              <span>{item.action}</span>
              <b>{item.count}</b>
            </div>
          )) : <EmptyState text="暂无操作记录" compact />}
        </div>
      </section>
    </div>
  );
}

function UsersPage({ api, refreshKey }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const load = () => api.users({ q: query, status, limit: "50" }).then((data) => {
    setRows(data.users || []);
    setError("");
  }).catch((err) => setError(err.message));
  useEffect(() => {
    void load();
  }, [refreshKey]);
  const toggle = async (user) => {
    await api.updateUser(user.id, { status: user.status === "active" ? "disabled" : "active" });
    await load();
  };
  return (
    <section className="panel">
      <PanelHead title="用户管理" desc="查看账号、授权状态和最近登录" />
      <div className="toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索账号或昵称" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">停用</option>
        </select>
        <button onClick={load}><RefreshCw size={16} /> 查询</button>
      </div>
      {error ? <EmptyState text={error} /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>账号</th><th>状态</th><th>授权</th><th>设备</th><th>注册</th><th>最近登录</th><th>操作</th></tr></thead>
            <tbody>
              {rows.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td><b>{user.account}</b><small>{user.name || "-"}</small></td>
                  <td><Badge value={user.status} /></td>
                  <td>{user.license ? <><b>{user.license.type}</b><small>{fmtDate(user.license.expiresAt)}</small></> : "-"}</td>
                  <td className="mono">{user.license?.deviceId || "-"}</td>
                  <td>{fmtDate(user.createdAt)}</td>
                  <td>{fmtDate(user.lastLoginAt)}</td>
                  <td><button className="mini" onClick={() => toggle(user)}>{user.status === "active" ? "停用" : "启用"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CodesPage({ api, refreshKey }) {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const load = () => api.codes({ status, limit: "80" }).then((data) => {
    setRows(data.codes || []);
    setError("");
  }).catch((err) => setError(err.message));
  useEffect(() => {
    void load();
  }, [refreshKey]);
  const copy = async (code) => navigator.clipboard?.writeText(code);
  const revoke = async (row) => {
    await api.revokeCode(row.id, { reason: "manual revoke" });
    await load();
  };
  return (
    <section className="panel">
      <PanelHead title="激活码列表" desc="查看完整码、发放状态、激活用户和设备" />
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="available">库存</option>
          <option value="issued">已发放</option>
          <option value="used">已激活</option>
          <option value="revoked">已作废</option>
        </select>
        <button onClick={load}><RefreshCw size={16} /> 刷新</button>
      </div>
      {error ? <EmptyState text={error} /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>完整激活码</th><th>状态</th><th>类型</th><th>发放</th><th>激活</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td className="mono strong">{row.code || row.preview}</td>
                  <td><Badge value={row.status} /></td>
                  <td>{row.type}<small>{row.durationDays} 天</small></td>
                  <td><b>{row.issuedTo || row.assignedAccount || "-"}</b><small>{fmtDate(row.issuedAt)}</small></td>
                  <td><b>{row.activatedAccount || "-"}</b><small>{row.activatedDeviceId || fmtDate(row.activatedAt)}</small></td>
                  <td>{row.note || "-"}</td>
                  <td className="row-actions">
                    {row.code ? <button className="icon-btn" title="复制" onClick={() => copy(row.code)}><Clipboard size={15} /></button> : null}
                    {row.status !== "used" && row.status !== "revoked" ? <button className="icon-btn danger" title="作废" onClick={() => revoke(row)}><Ban size={15} /></button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function IssuePage({ api }) {
  const [createForm, setCreateForm] = useState({ type: "trial", durationDays: 7, count: 10, note: "", status: "available", issuedTo: "", assignedAccount: "" });
  const [issueForm, setIssueForm] = useState({ type: "trial", count: 1, sourceNote: "", issuedTo: "", assignedAccount: "", note: "" });
  const [result, setResult] = useState([]);
  const [message, setMessage] = useState("");
  const submitCreate = async () => {
    const data = await api.createCodes(createForm);
    setResult(data.codes || []);
    setMessage(`已生成 ${data.codes?.length || 0} 个激活码`);
  };
  const submitIssue = async () => {
    const data = await api.issueCodes(issueForm);
    setResult(data.codes || []);
    setMessage(`已发放 ${data.codes?.length || 0} 个激活码`);
  };
  const updateCreate = (key, value) => setCreateForm((prev) => ({ ...prev, [key]: value }));
  const updateIssue = (key, value) => setIssueForm((prev) => ({ ...prev, [key]: value }));
  const copyAll = () => navigator.clipboard?.writeText(result.map((item) => item.code).join("\n"));
  return (
    <div className="page-grid two">
      <section className="panel">
        <PanelHead title="生成库存码" desc="生成后默认进入 available 库存" />
        <FormGrid>
          <Field label="类型"><select value={createForm.type} onChange={(e) => updateCreate("type", e.target.value)}><option value="trial">试用</option><option value="official">正式</option></select></Field>
          <Field label="授权天数"><input type="number" value={createForm.durationDays} onChange={(e) => updateCreate("durationDays", Number(e.target.value))} /></Field>
          <Field label="数量"><input type="number" value={createForm.count} onChange={(e) => updateCreate("count", Number(e.target.value))} /></Field>
          <Field label="状态"><select value={createForm.status} onChange={(e) => updateCreate("status", e.target.value)}><option value="available">库存</option><option value="issued">直接发放</option></select></Field>
          <Field label="发放对象"><input value={createForm.issuedTo} onChange={(e) => updateCreate("issuedTo", e.target.value)} placeholder="可选" /></Field>
          <Field label="绑定账号"><input value={createForm.assignedAccount} onChange={(e) => updateCreate("assignedAccount", e.target.value)} placeholder="可选" /></Field>
          <Field label="批次备注"><input value={createForm.note} onChange={(e) => updateCreate("note", e.target.value)} placeholder="batch-202607" /></Field>
        </FormGrid>
        <button className="primary" onClick={submitCreate}><KeyRound size={16} /> 生成激活码</button>
      </section>
      <section className="panel">
        <PanelHead title="从库存发放" desc="只从 available 中取码并改为 issued" />
        <FormGrid>
          <Field label="类型"><select value={issueForm.type} onChange={(e) => updateIssue("type", e.target.value)}><option value="trial">试用</option><option value="official">正式</option></select></Field>
          <Field label="数量"><input type="number" value={issueForm.count} onChange={(e) => updateIssue("count", Number(e.target.value))} /></Field>
          <Field label="库存批次"><input value={issueForm.sourceNote} onChange={(e) => updateIssue("sourceNote", e.target.value)} placeholder="可选" /></Field>
          <Field label="发放对象"><input value={issueForm.issuedTo} onChange={(e) => updateIssue("issuedTo", e.target.value)} placeholder="渠道/客户" /></Field>
          <Field label="绑定账号"><input value={issueForm.assignedAccount} onChange={(e) => updateIssue("assignedAccount", e.target.value)} placeholder="可选" /></Field>
          <Field label="发放备注"><input value={issueForm.note} onChange={(e) => updateIssue("note", e.target.value)} placeholder="可选" /></Field>
        </FormGrid>
        <button className="primary" onClick={submitIssue}><Send size={16} /> 发放激活码</button>
      </section>
      <section className="panel wide">
        <PanelHead title="本次结果" desc={message || "生成或发放后在这里显示完整激活码"} />
        {result.length ? <button className="copy-all" onClick={copyAll}><Clipboard size={16} /> 复制全部</button> : null}
        <div className="code-result">
          {result.length ? result.map((item, index) => (
            <div key={`${item.code}-${index}`}>
              <span className="mono">{item.code}</span>
              <small>{item.type} · {item.durationDays} 天 · {STATUS_LABELS[item.status] || item.status}</small>
            </div>
          )) : <EmptyState text="暂无结果" compact />}
        </div>
      </section>
    </div>
  );
}

function EventsPage({ api, refreshKey }) {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [module, setModule] = useState("");
  const [event, setEvent] = useState("");
  const [user, setUser] = useState("");
  const [error, setError] = useState("");
  const load = () => Promise.all([
    api.eventSummary(),
    api.events({ module, event, user, limit: "80" }),
  ]).then(([summaryData, eventData]) => {
    setSummary(summaryData);
    setRows(eventData.events || []);
    setError("");
  }).catch((err) => setError(err.message));
  useEffect(() => {
    void load();
  }, [refreshKey]);
  return (
    <div className="page-grid">
      <section className="panel">
        <PanelHead title="使用数据汇总" desc="近 30 天按模块和事件统计" />
        {!summary ? <EmptyState text={error || "正在读取使用数据..."} /> : (
          <div className="usage-grid">
            <div>
              <h3>模块</h3>
              <div className="metric-list">
                {summary.byModule.map((item) => <MetricRow key={item.module} name={item.module} item={item} />)}
              </div>
            </div>
            <div>
              <h3>事件</h3>
              <div className="metric-list">
                {summary.byEvent.map((item) => <MetricRow key={item.event} name={item.event} item={item} />)}
              </div>
            </div>
          </div>
        )}
      </section>
      <section className="panel">
        <PanelHead title="事件明细" desc="按用户、模块、事件查看最近上报" />
        <div className="toolbar">
          <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="模块，如 video_mix" />
          <input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="事件，如 mix_success" />
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="用户账号" />
          <button onClick={load}><RefreshCw size={16} /> 查询</button>
        </div>
        {error ? <EmptyState text={error} /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>用户</th><th>模块</th><th>事件</th><th>结果</th><th>耗时</th><th>设备</th><th>Meta</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{fmtDate(row.createdAt)}</td>
                    <td>{row.account || "-"}</td>
                    <td><b>{row.module || "-"}</b></td>
                    <td className="mono">{row.event}</td>
                    <td>{row.success === null ? "-" : row.success ? <CheckCircle2 className="ok-ic" size={16} /> : <Badge value="failed" />}</td>
                    <td>{row.durationMs === null ? "-" : `${row.durationMs}ms`}</td>
                    <td className="mono">{row.deviceId || "-"}</td>
                    <td><code>{JSON.stringify(row.meta || {})}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricRow({ name, item }) {
  return (
    <div className="metric-row">
      <span>{name}</span>
      <b>{item.count}</b>
      <small>失败 {item.failed || 0} · 平均 {item.avgDurationMs || 0}ms</small>
    </div>
  );
}

function LogsPage({ api, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const load = () => api.logs({ action, limit: "80" }).then((data) => {
    setRows(data.logs || []);
    setError("");
  }).catch((err) => setError(err.message));
  useEffect(() => {
    void load();
  }, [refreshKey]);
  return (
    <section className="panel">
      <PanelHead title="操作日志" desc="用户注册、登录、激活和人工后台操作" />
      <div className="toolbar">
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="按 action 过滤" />
        <button onClick={load}><RefreshCw size={16} /> 刷新</button>
      </div>
      {error ? <EmptyState text={error} /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>操作</th><th>操作者</th><th>目标</th><th>IP</th><th>详情</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{fmtDate(row.createdAt)}</td>
                  <td><b>{row.action}</b></td>
                  <td>{row.actorLabel || row.actorType}</td>
                  <td>{row.targetType || "-"} {row.targetId || ""}</td>
                  <td>{row.ip || "-"}</td>
                  <td><code>{JSON.stringify(row.detail || {})}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Badge({ value }) {
  return <span className={`badge ${value}`}>{STATUS_LABELS[value] || value || "-"}</span>;
}

function PanelHead({ title, desc }) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function FormGrid({ children }) {
  return <div className="form-grid">{children}</div>;
}

function EmptyState({ text, compact = false }) {
  return <div className={`empty ${compact ? "compact" : ""}`}>{text}</div>;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("auth-admin-token") || "");
  const [tab, setTab] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const api = useAdminApi(token);

  useEffect(() => {
    if (token) localStorage.setItem("auth-admin-token", token);
  }, [token]);

  if (!token) return <TokenGate token={token} setToken={setToken} />;

  const ActiveIcon = TABS.find((item) => item.id === tab)?.icon || BarChart3;
  return (
    <div className="app-shell">
      <aside className="side">
        <div className="brand-row side-brand">
          <span className="brand-mark"><Shield size={20} /></span>
          <div>
            <b>授权后台</b>
            <small>ECutAuto</small>
          </div>
        </div>
        <nav>
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                <Icon size={17} /> {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow"><ActiveIcon size={16} /> 授权服务</span>
            <h1>{TABS.find((item) => item.id === tab)?.label}</h1>
          </div>
          <div className="top-actions">
            <button onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={16} /> 刷新</button>
            <button onClick={() => { localStorage.removeItem("auth-admin-token"); setToken(""); }}>退出</button>
          </div>
        </header>
        {tab === "overview" ? <Overview api={api} refreshKey={refreshKey} /> : null}
        {tab === "users" ? <UsersPage api={api} refreshKey={refreshKey} /> : null}
        {tab === "codes" ? <CodesPage api={api} refreshKey={refreshKey} /> : null}
        {tab === "issue" ? <IssuePage api={api} /> : null}
        {tab === "events" ? <EventsPage api={api} refreshKey={refreshKey} /> : null}
        {tab === "logs" ? <LogsPage api={api} refreshKey={refreshKey} /> : null}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
