import { useState } from "react";
import { api, type Summary } from "../api";

export default function Workspace({ summary, onRefresh }: { summary: Summary; onRefresh: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [classification, setClassification] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.tasks.create({ title: title.trim(), description: description.trim() || undefined, classification });
      setTitle(""); setDescription(""); setCreating(false);
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally { setBusy(false); }
  };

  const cancel = async (id: number) => {
    try { await api.tasks.cancel(id); await onRefresh(); } catch {}
  };

  return (
    <div className="gap-16">
      <div className="grid-3">
        <div className="stat-card"><div className="stat-label">Total tasks</div><div className="stat-value">{summary.stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Running</div><div className="stat-value" style={{ color: "var(--accent)" }}>{summary.stats.running}</div></div>
        <div className="stat-card"><div className="stat-label">Done</div><div className="stat-value" style={{ color: "var(--success)" }}>{summary.stats.done}</div></div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Tasks</span>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(c => !c)}>{creating ? "Cancel" : "+ New task"}</button>
        </div>

        {creating && (
          <form onSubmit={createTask} className="gap-12" style={{ marginBottom: 20, padding: 16, background: "var(--surface-2)", borderRadius: 6 }}>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input className="form-input" required value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" />
            </div>
            <div className="form-group">
              <label className="form-label">Description (optional)</label>
              <textarea className="form-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the task goal…" style={{ resize: "vertical" }} />
            </div>
            <div className="form-group">
              <label className="form-label">Classification</label>
              <select className="form-input" value={classification} onChange={e => setClassification(e.target.value)}>
                <option value="standard">standard</option>
                <option value="sensitive">sensitive</option>
                <option value="restricted">restricted</option>
              </select>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create task"}</button>
          </form>
        )}

        <table className="table">
          <thead><tr><th>ID</th><th>Title</th><th>Classification</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            {summary.tasks.length === 0 && <tr><td colSpan={6} className="table-empty">No tasks yet. Create one above.</td></tr>}
            {summary.tasks.map(task => (
              <tr key={task.id}>
                <td className="muted mono text-sm">#{task.id}</td>
                <td>{task.title}</td>
                <td><span className="status-chip status-pending">{task.classification}</span></td>
                <td><span className={`status-chip status-${task.status}`}>{task.status}</span></td>
                <td className="muted text-sm">{new Date(task.updatedAt).toLocaleString()}</td>
                <td>{["pending", "running", "waiting_approval"].includes(task.status) && <button className="btn btn-danger btn-sm" onClick={() => cancel(task.id)}>Cancel</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
