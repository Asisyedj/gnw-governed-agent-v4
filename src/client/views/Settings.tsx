import { useEffect, useState } from "react";
import { api, type SettingsResponse, type TestResult } from "../api";

export default function SettingsView() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState("nvidia/nemotron-3-ultra-550b-a55b");
  const [customKey, setCustomKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    try {
      const data = await api.settings.get();
      setSettings(data);
      if (data.model) setSelectedModel(data.model);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const payload: { model?: string; apiKey?: string } = { model: selectedModel };
      if (customKey.trim()) payload.apiKey = customKey.trim();
      await api.settings.update(payload);
      setMsg("Settings saved successfully.");
      setCustomKey("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (prompt?: string) => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await api.settings.test(prompt ? { model: selectedModel, prompt } : { model: selectedModel });
      setTestResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="gap-16">
      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="card">
        <div className="card-header">
          <span className="card-title">NVIDIA NIM API Configuration</span>
          <span className="status-chip status-done">ACTIVE</span>
        </div>

        <form onSubmit={save} className="gap-12" style={{ padding: "12px 0" }}>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-label">AI Provider</div>
              <div className="stat-value" style={{ fontSize: 18, color: "var(--accent)" }}>NVIDIA NIM</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">API Key Status</div>
              <div className="stat-value" style={{ fontSize: 18, color: "var(--success)" }}>
                {settings?.apiKeyConfigured ? "Configured" : "Missing"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Key Digest</div>
              <div className="stat-value" style={{ fontSize: 14 }}>
                {settings?.maskedApiKey ?? "Loading…"}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Base URL (OpenAI-compatible NIM)</label>
            <input className="form-input" disabled value={settings?.baseUrl ?? "https://integrate.api.nvidia.com/v1"} />
          </div>

          <div className="form-group">
            <label className="form-label">Active Model</label>
            <select
              className="form-input"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
            >
              {(settings?.availableModels ?? [
                // ── NVIDIA Nemotron ──────────────────────────────
                "nvidia/nemotron-3-ultra-550b-a55b",
                "nvidia/llama-3.1-nemotron-ultra-253b-v1",
                "nvidia/llama-3.3-nemotron-super-49b-v1.5",
                "nvidia/nemotron-3-super-120b-a12b",
                "nvidia/nemotron-3.5-lightning-30b-a3b",
                // ── Meta Llama 4 ─────────────────────────────────
                "meta/llama-4-maverick-17b-128e-instruct",
                "meta/llama-4-scout-17b-16e-instruct",
                // ── Meta Llama 3.x ───────────────────────────────
                "meta/llama-3.3-70b-instruct",
                "meta/llama-3.2-90b-vision-instruct",
                "meta/llama-3.2-11b-vision-instruct",
                // ── DeepSeek ─────────────────────────────────────
                "deepseek-ai/deepseek-r1",
                "deepseek-ai/deepseek-v4.1-flash",
                "deepseek-ai/deepseek-v4-pro-0813",
                // ── Mistral ──────────────────────────────────────
                "mistralai/mistral-large-2-instruct",
                "mistralai/mistral-7b-instruct-v0.3",
                // ── Google Gemma ──────────────────────────────────
                "google/gemma-3-27b-it",
                // ── IBM Granite ──────────────────────────────────
                "ibm/granite-3.0-8b-instruct",
                // ── AI21 ─────────────────────────────────────────
                "ai21labs/jamba-1.5-large-instruct"
              ]).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <span className="muted text-sm">Selected model is used for governed tasks and deep research.</span>
          </div>

          <div className="form-group">
            <label className="form-label">Update NVIDIA API Key (Optional)</label>
            <input
              type="password"
              className="form-input"
              value={customKey}
              onChange={e => setCustomKey(e.target.value)}
              placeholder="Paste new nvapi-... key to update"
            />
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save Settings"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={testing}
              onClick={() => testConnection()}
            >
              {testing ? "Testing Connection…" : "⚡ Test NVIDIA Connection"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={testing}
              onClick={() => testConnection("Provide a 2-sentence soil recommendation for wheat in Pasrur, Sialkot.")}
            >
              🌾 Test Agriculture AI Prompt
            </button>
          </div>
        </form>
      </div>

      {testResult && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Live NVIDIA NIM Inference Result</span>
            <span className="badge" style={{ background: "var(--success)" }}>
              {testResult.latencyMs}ms latency
            </span>
          </div>
          <div className="gap-12" style={{ padding: "12px 0" }}>
            <div>
              <div className="muted text-sm" style={{ marginBottom: 4 }}>Model: <strong>{testResult.model}</strong></div>
              <div style={{
                background: "var(--surface-2)",
                padding: "16px",
                borderRadius: "6px",
                lineHeight: 1.5,
                border: "1px solid var(--border)"
              }}>
                {testResult.response}
              </div>
            </div>
            {testResult.usage && (
              <div className="muted text-sm">
                Tokens: {JSON.stringify(testResult.usage)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
