import { useEffect, useState } from "react";
import { api } from "../api";

export default function AuditView() {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setEntries(await api.audit.list(200)); }
      catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to load"); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="card">
      <div className="card-header"><span className="card-title">Audit trail</span><span className="muted text-sm">{entries.length} events</span></div>
      {loading && <div className="row"><span className="spinner" /><span className="muted">Loading…</span></div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && (
        <table className="table">
          <thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Outcome</th><th>Detail</th></tr></thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan={5} className="table-empty">No audit events yet.</td></tr>}
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="muted text-sm mono">{new Date(e.createdAt as string).toLocaleString()}</td>
                <td className="text-sm">{e.eventType as string}</td>
                <td className="muted text-sm">{(e.actorId as number | null) ? `user:${e.actorId}` : "system"}</td>
                <td><span className={`status-chip status-${e.outcome ?? "pending"}`}>{(e.outcome as string) ?? "—"}</span></td>
                <td className="mono text-xs muted" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.detail ? JSON.stringify(e.detail) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
