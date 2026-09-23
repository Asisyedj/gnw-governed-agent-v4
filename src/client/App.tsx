import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Summary } from "./api";
import Workspace from "./views/Workspace";
import ApprovalsView from "./views/Approvals";
import AuditView from "./views/Audit";
import ControlsView from "./views/Controls";

type View = "workspace" | "approvals" | "audit" | "controls";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [bootstrap, setBootstrap] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api.summary();
      setSummary(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setSummary(null);
      else { console.error("summary error:", error); setSummary(null); }
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setBootstrap(me.bootstrap);
        setAllowRegistration(me.allowSelfRegistration);
        if (me.user) await refresh();
      } catch (err) {
        console.error("session error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  if (loading) {
    return <div className="auth-screen"><div className="row"><span className="spinner" aria-hidden /><span className="muted">Loading…</span></div></div>;
  }

  if (!summary) {
    return <AuthScreen bootstrap={bootstrap} allowRegistration={allowRegistration} onAuthenticated={refresh} />;
  }

  const pendingApprovals = summary.approvals.filter(a => a.status === "pending").length;
  const interlockEngaged = summary.interlock.killSwitch || summary.interlock.circuitOpen;

  return (
    <div className="layout">
      <header className="topbar">
        <span className="topbar-brand">GNW / Control Plane</span>
        <nav className="topbar-nav">
          <button className={view === "workspace" ? "active" : ""} onClick={() => setView("workspace")}>Workspace</button>
          <button className={view === "approvals" ? "active" : ""} onClick={() => setView("approvals")}>
            Approvals {pendingApprovals > 0 && <span className="badge">{pendingApprovals}</span>}
          </button>
          <button className={view === "audit" ? "active" : ""} onClick={() => setView("audit")}>Audit Trail</button>
          <button className={view === "controls" ? "active" : ""} onClick={() => setView("controls")}>Safety Controls</button>
        </nav>
        <div className="topbar-actions">
          {interlockEngaged && <span className="badge" style={{ background: "var(--danger)" }}>INTERLOCK</span>}
          <button className="btn btn-ghost btn-sm" onClick={async () => { await api.logout(); window.location.reload(); }}>Sign out</button>
        </div>
      </header>
      <div className="main-content">
        {interlockEngaged && <div className="interlock-banner">⚠ Fail-closed: kill switch or circuit breaker is engaged. No new task actions will be admitted until cleared in Safety Controls.</div>}
        {view === "workspace" && <Workspace summary={summary} onRefresh={refresh} />}
        {view === "approvals" && <ApprovalsView summary={summary} onRefresh={refresh} />}
        {view === "audit" && <AuditView />}
        {view === "controls" && <ControlsView summary={summary} onRefresh={refresh} />}
      </div>
    </div>
  );
}

function AuthScreen({ bootstrap, allowRegistration, onAuthenticated }: { bootstrap: boolean; allowRegistration: boolean; onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">(bootstrap ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === "register") await api.register(email, password);
      else await api.login(email, password);
      await onAuthenticated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Request failed. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card card">
        <p className="auth-title">GNW Governed Agent</p>
        <p className="auth-subtitle">{bootstrap ? "First run: create the owner account." : mode === "login" ? "Sign in to your workspace." : "Create an account."}</p>
        <form onSubmit={submit} className="gap-12">
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input id="email" type="email" className="form-input" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input id="password" type="password" className="form-input" required minLength={mode === "register" ? 12 : 1} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%" }}>{busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}</button>
        </form>
        {(bootstrap || allowRegistration) && (
          <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Create an account" : "Already have an account"}
          </button>
        )}
      </div>
    </div>
  );
}
