import { useEffect, useState } from "react";
import { api, type SettingsResponse, type TestResult } from "../api";

export default function SettingsView() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState("meta/llama-3.2-11b-vision-instruct");
  const [error, setError] = useState<string | null>(null);
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

      <div className="card">
        <div className="card-header">
          <span className="card-title">NVIDIA NIM API Configuration</span>
          <span className={settings?.apiKeyConfigured ? "status-chip status-done" : "status-chip"}>
            {settings?.apiKeyConfigured ? "CONFIGURED" : "MISSING"}
          </span>
        </div>

        <div className="gap-12" style={{ padding: "12px 0" }}>
          <div className="muted text-sm" style={{ marginBottom: 16 }}>
            API credentials and the active model are managed by deployment configuration and the approved secret provider.
            This screen does not accept, persist, or expose secrets. The model selector below applies only to a connection test.
          </div>

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
              <div className="stat-label">Credential Status</div>
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
            <label className="form-label">Model for connection test</label>
            <select
              className="form-input"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
            >
              {(settings?.availableModels ?? [
                "nvidia/nemotron-3-ultra-550b-a55b",
                "nvidia/llama-3.1-nemotron-ultra-253b-v1",
                "nvidia/llama-3.3-nemotron-super-49b-v1.5",
                "nvidia/nemotron-3-super-120b-a12b",
                "nvidia/nemotron-3.5-lightning-30b-a3b",
                "meta/llama-4-maverick-17b-128e-instruct",
                "meta/llama-4-scout-17b-16e-instruct",
                "meta/llama-3.3-70b-instruct",
                "meta/llama-3.2-90b-vision-instruct",
                "meta/llama-3.2-11b-vision-instruct",
                "deepseek-ai/deepseek-v4.1-flash",
                "deepseek-ai/deepseek-coder-6.7b-instruct",
                "mistralai/mistral-large-2-instruct",
                "mistralai/mistral-7b-instruct-v0.3",
                "google/gemma-3-27b-it",
                "ibm/granite-3.0-8b-instruct",
                "ai21labs/jamba-1.5-large-instruct",
              ]).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
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
        </div>
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
