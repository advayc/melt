import React, { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import Duration from './components/Duration';
import UsageRow from './components/UsageRow';
import './theme.css';

export default function App() {
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.screenTimeAPI.getUsage().then(data => { setUsage(data); setLoading(false); });
    window.screenTimeAPI.onUsageUpdate(data => setUsage(data));
  }, []);

  function exportData() {
    window.screenTimeAPI.exportData().then(file => alert(`Exported to ${file}`));
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Screen Time</h1>
        <div className="header-actions">
          <button onClick={exportData}>Export JSON</button>
        </div>
      </header>
      <main className="content">
        {loading && <p className="muted">Loading…</p>}
        {!loading && usage.length === 0 && <p>No data yet. Use your Mac a bit…</p>}
        {usage.length > 0 && (
          <table className="usage-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Total</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {usage.map(app => <UsageRow key={app.id} app={app} />)}
            </tbody>
          </table>
        )}
      </main>
      <footer className="footer muted">Updates every 3s • Times since launch • Prototype build</footer>
    </div>
  );
}
