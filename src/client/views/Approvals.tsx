import { useState } from "react";
import { api, type ApprovalSummary, type Summary } from "../api";

export default function ApprovalsView({ summary, onRefresh }: { summary: Summary; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = async (id: number, status: "approved" | "denied") => {
    setBusy(id); setError(null);
    try { await api.approvals.review(id, status); await onRefresh(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(null); }
  };

  const pending = summary.approvals.filter(a => a.status === "pending");
  const decided = summary.approvals.filter(a => a.status !== "pending");

  return (
    <div className="gap-16">
      {error && <div className="alert alert-error">{error}</div>}
      <div className="card">
        <div className="card-header"><span className="card-title">Pending approvals</span><span className="muted text-sm">{pending.length} waiting</span></div>
        <table className="table">
          <thead><tr><th>ID</th><th>Task</th><th>Action digest</th><th>Expires</th><th>Actions</th></tr></thead>
          <tbody>
            {pending.length === 0 && <tr><td colSpan={5} className="table-empty">No pending approvals.</td></tr>}
            {pending.map((a: ApprovalSummary) => (
              <tr key={a.id}>
                <td className="mono text-sm muted">#{a.id}</td>
                <td className="muted">{a.taskId ? `Task #${a.taskId}` : "—"}</td>
                <td className="mono text-sm" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.actionDigest}</td>
                <td className="muted text-sm">{new Date(a.expiresAt).toLocaleString()}</td>
                <td>
                  <div className="row">
                    <button className="btn btn-success btn-sm" disabled={busy === a.id} onClick={() => review(a.id, "approved")}>Approve</button>
                    <button className="btn btn-danger btn-sm" disabled={busy === a.id} onClick={() => review(a.id, "denied")}>Deny</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {decided.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">Recent decisions</span></div>
          <table className="table">
            <thead><tr><th>ID</th><th>Task</th><th>Status</th><th>Reviewed</th></tr></thead>
            <tbody>
              {decided.slice(0, 20).map((a: ApprovalSummary) => (
                <tr key={a.id}>
                  <td className="mono text-sm muted">#{a.id}</td>
                  <td className="muted">{a.taskId ? `Task #${a.taskId}` : "—"}</td>
                  <td><span className={`status-chip status-${a.status}`}>{a.status}</span></td>
                  <td className="muted text-sm">{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
