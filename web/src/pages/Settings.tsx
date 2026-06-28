import { useEffect, useState } from "react";
import {
  getVolcengineSettings,
  saveVolcengineSettings,
  testVolcengineSettings,
  type VolcengineSettings,
} from "../api";

const DEFAULT_ARK_MODEL = "doubao-seed-2-0-mini-260428";
const DEFAULT_TTS_RESOURCE_ID = "volc.service_type.10029";

function sourceLabel(source?: VolcengineSettings["ark"]["source"]) {
  if (source === "db") return "本地数据库";
  return "未配置";
}

function ConfigStatus({ configured, masked, source }: { configured: boolean; masked: string; source: VolcengineSettings["ark"]["source"] }) {
  return (
    <span className={`settings-status ${configured ? "ok" : ""}`}>
      {configured ? `已配置 ${masked}` : "未配置"} · {sourceLabel(source)}
    </span>
  );
}

function TestResult({ result }: { result?: { ok: boolean; message: string } }) {
  if (!result) return null;
  return <div className={`settings-test-result ${result.ok ? "ok" : "err"}`}>{result.message}</div>;
}

export default function Settings() {
  const [settings, setSettings] = useState<VolcengineSettings | null>(null);
  const [arkApiKey, setArkApiKey] = useState("");
  const [arkModel, setArkModel] = useState(DEFAULT_ARK_MODEL);
  const [ttsApiKey, setTtsApiKey] = useState("");
  const [ttsResourceId, setTtsResourceId] = useState(DEFAULT_TTS_RESOURCE_ID);
  const [status, setStatus] = useState("正在读取设置…");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"" | "ark" | "tts">("");
  const [testResult, setTestResult] = useState<{
    ark?: { ok: boolean; message: string };
    tts?: { ok: boolean; message: string };
  }>({});

  const applySettings = (next: VolcengineSettings) => {
    setSettings(next);
    setArkModel(next.ark.model || DEFAULT_ARK_MODEL);
    setTtsResourceId(next.tts.resourceId || DEFAULT_TTS_RESOURCE_ID);
    setArkApiKey("");
    setTtsApiKey("");
  };

  const refresh = async () => {
    setStatus("正在读取设置…");
    try {
      const next = await getVolcengineSettings();
      applySettings(next);
      setStatus("设置已读取");
    } catch (err) {
      setStatus("读取失败：" + (err as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus("正在保存设置…");
    try {
      const next = await saveVolcengineSettings({
        arkApiKey,
        arkModel,
        ttsApiKey,
        ttsResourceId,
      });
      applySettings(next);
      setStatus("已保存，后续 AI 改写和语音合成会使用当前配置");
    } catch (err) {
      setStatus("保存失败：" + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const testArk = async () => {
    setTesting("ark");
    setStatus("正在测试 AI 改写 Key…");
    setTestResult((prev) => ({ ...prev, ark: undefined }));
    try {
      const result = await testVolcengineSettings({
        target: "ark",
      });
      const message = result.text ? "测试成功，已收到最小响应" : result.message;
      setTestResult((prev) => ({ ...prev, ark: { ok: true, message } }));
      setStatus(message);
    } catch (err) {
      const message = "测试失败：" + (err as Error).message;
      setTestResult((prev) => ({ ...prev, ark: { ok: false, message } }));
      setStatus(message);
    } finally {
      setTesting("");
    }
  };

  const testTts = async () => {
    setTesting("tts");
    setStatus("正在测试语音合成 Key…");
    setTestResult((prev) => ({ ...prev, tts: undefined }));
    try {
      const result = await testVolcengineSettings({
        target: "tts",
      });
      const message = result.bytes ? `测试成功，已生成 ${result.bytes} 字节测试音频` : result.message;
      setTestResult((prev) => ({ ...prev, tts: { ok: true, message } }));
      setStatus(message);
    } catch (err) {
      const message = "测试失败：" + (err as Error).message;
      setTestResult((prev) => ({ ...prev, tts: { ok: false, message } }));
      setStatus(message);
    } finally {
      setTesting("");
    }
  };

  const clearArk = async () => {
    setSaving(true);
    setStatus("正在清除 AI 改写 Key…");
    try {
      const next = await saveVolcengineSettings({ clearArkApiKey: true, arkModel, ttsResourceId });
      applySettings(next);
      setStatus("已清除 AI 改写 Key");
    } catch (err) {
      setStatus("清除失败：" + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearTts = async () => {
    setSaving(true);
    setStatus("正在清除语音合成 Key…");
    try {
      const next = await saveVolcengineSettings({ clearTtsApiKey: true, arkModel, ttsResourceId });
      applySettings(next);
      setStatus("已清除语音合成 Key");
    } catch (err) {
      setStatus("清除失败：" + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-head">
        <div>
          <span>系统设置</span>
          <h1>火山引擎配置</h1>
          <p>当前 MVP 默认使用本地用户 ID 1。完整 Key 只会写入本地数据库，保存后再用于测试和生成。</p>
        </div>
        <button className="import-btn" type="button" onClick={save} disabled={saving || Boolean(testing)}>保存配置</button>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-h">
            <div>
              <b>AI 改写</b>
              <span>用于文案模式中的 AI 改写</span>
            </div>
            <ConfigStatus configured={Boolean(settings?.ark.configured)} masked={settings?.ark.masked || ""} source={settings?.ark.source || "none"} />
          </div>
          <div className="settings-form">
            <label htmlFor="ark-api-key">
              <span>ARK API Key</span>
              <input
                id="ark-api-key"
                className="inp"
                type="password"
                value={arkApiKey}
                onChange={(e) => setArkApiKey(e.target.value)}
                placeholder={settings?.ark.configured ? "留空表示不修改已有 Key" : "填写火山 ARK API Key"}
                autoComplete="off"
              />
            </label>
            <label htmlFor="ark-model">
              <span>模型</span>
              <input
                id="ark-model"
                className="inp"
                value={arkModel}
                onChange={(e) => setArkModel(e.target.value)}
                placeholder={DEFAULT_ARK_MODEL}
              />
            </label>
            <div className="settings-actions">
              <button
                className="import-btn"
                type="button"
                onClick={testArk}
                disabled={saving || Boolean(testing) || !settings?.ark.configured}
              >
                {testing === "ark" ? "测试中" : "测试 AI 改写"}
              </button>
              <button className="icon-btn text-btn" type="button" onClick={clearArk} disabled={saving || Boolean(testing) || settings?.ark.source !== "db"}>清除本地 Key</button>
            </div>
            <TestResult result={testResult.ark} />
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-h">
            <div>
              <b>语音合成</b>
              <span>用于文案模式和 AI 智能混剪配音</span>
            </div>
            <ConfigStatus configured={Boolean(settings?.tts.configured)} masked={settings?.tts.masked || ""} source={settings?.tts.source || "none"} />
          </div>
          <div className="settings-form">
            <label htmlFor="tts-api-key">
              <span>TTS API Key</span>
              <input
                id="tts-api-key"
                className="inp"
                type="password"
                value={ttsApiKey}
                onChange={(e) => setTtsApiKey(e.target.value)}
                placeholder={settings?.tts.configured ? "留空表示不修改已有 Key" : "填写火山 TTS API Key"}
                autoComplete="off"
              />
            </label>
            <label htmlFor="tts-resource-id">
              <span>Resource ID</span>
              <input
                id="tts-resource-id"
                className="inp"
                value={ttsResourceId}
                onChange={(e) => setTtsResourceId(e.target.value)}
                placeholder={DEFAULT_TTS_RESOURCE_ID}
              />
            </label>
            <div className="settings-actions">
              <button
                className="import-btn"
                type="button"
                onClick={testTts}
                disabled={saving || Boolean(testing) || !settings?.tts.configured}
              >
                {testing === "tts" ? "测试中" : "测试语音合成"}
              </button>
              <button className="icon-btn text-btn" type="button" onClick={clearTts} disabled={saving || Boolean(testing) || settings?.tts.source !== "db"}>清除本地 Key</button>
            </div>
            <TestResult result={testResult.tts} />
          </div>
        </section>
      </div>

      <section className="settings-note">
        <b>存储策略</b>
        <span>当前 Key 保存在本机数据库中。后续接入注册登录后，会从默认用户切换为真实用户；桌面正式版再迁移到系统钥匙串。</span>
      </section>

      <div className="settings-status-line">{status}</div>
    </div>
  );
}
