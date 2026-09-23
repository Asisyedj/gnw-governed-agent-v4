import { useState } from "react";
import { api, type Summary } from "../api";

export default function ControlsView({ summary, onRefresh }: { summary: Summary; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const set = async (patch: { killSwitch?: boolean; circuitOpen?: boolean }) => {
    setBusy(true); setError(null); setMsg(null);
    try { await api.interlock.set(patch); setMsg("Interlock updated."); await onRefresh(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };

  const { killSwitch, circuitOpen, generation } = summary.interlock;

  return (
    <div className="gap-16">
      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}
      <div className="card">
        <div className="card-header"><span className="card-title">Interlock controls</span><span className="muted text-sm">Generation {generation}</span></div>
        <div className="gap-12">
          <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Kill switch</div>
              <div className="muted text-sm">Fail-closed: immediately halts all governed agent actions across the workspace.</div>
            </div>
            <div className="row">
              <span className={`status-chip ${killSwitch ? "status-failed" : "status-done"}`}>{killSwitch ? "ENGAGED" : "CLEAR"}</span>
              {killSwitch
                ? <button className="btn btn-success btn-sm" disabled={busy} onClick={() => set({ killSwitch: false })}>Clear kill switch</button>
                : <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => set({ killSwitch: true })}>Engage kill switch</button>
              }
            </div>
          </div>
          <div className="row" style={{ justifyContent: "space-between", padding: "12px 0" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Circuit breaker</div>
              <div className="muted text-sm">Trips automatically on repeated failures. Can also be manually opened or reset.</div>
            </div>
            <div className="row">
              <span className={`status-chip ${circuitOpen ? "status-failed" : "status-done"}`}>{circuitOpen ? "OPEN" : "CLOSED"}</span>
              {circuitOpen
                ? <button className="btn btn-success btn-sm" disabled={busy} onClick={() => set({ circuitOpen: false })}>Reset circuit</button>
                : <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => set({ circuitOpen: true })}>Open circuit</button>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
