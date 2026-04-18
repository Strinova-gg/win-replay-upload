import type { LogEntry } from '../log/uploadLog';

export function LogTable({ entries }: { entries: Record<string, LogEntry> }) {
  const rows = Object.entries(entries).sort(([, a], [, b]) => (a.at < b.at ? 1 : -1));

  if (rows.length === 0) {
    return <p className="muted">No upload history yet.</p>;
  }

  return (
    <table className="logtable">
      <thead>
        <tr>
          <th>File</th>
          <th>Status</th>
          <th>When</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, entry]) => (
          <tr key={name} className={`status-${entry.status}`}>
            <td title={name}>{name}</td>
            <td>{entry.status}</td>
            <td>{new Date(entry.at).toLocaleString()}</td>
            <td>
              {entry.error ?? (entry.httpStatus ? `HTTP ${entry.httpStatus}` : '')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
