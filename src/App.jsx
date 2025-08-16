import React, { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import Duration from './components/Duration';
import UsageRow from './components/UsageRow';
import './theme.css';
import useIdle from './components/IdleDetector.jsx';

export default function App() {
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [systemInfo, setSystemInfo] = useState({});
  const idle = useIdle(120000); // 2 min idle threshold

  useEffect(() => {
    Promise.all([
      window.screenTimeAPI.getUsage(),
      window.screenTimeAPI.getSystemInfo()
    ]).then(([usageData, sysInfo]) => {
      setUsage(usageData);
      setSystemInfo(sysInfo);
      setLoading(false);
    });
    
    window.screenTimeAPI.onUsageUpdate(data => setUsage(data));
    
    // Update system info periodically
    const sysInfoInterval = setInterval(() => {
      window.screenTimeAPI.getSystemInfo().then(setSystemInfo);
    }, 5000);
    
    return () => clearInterval(sysInfoInterval);
  }, []);

  function exportData() {
    window.screenTimeAPI.exportData().then(file => 
      alert(`Exported to ${file.split('/').pop()}`)
    );
  }
  
  function clearData() {
    if (confirm('Clear all tracking data? This cannot be undone.')) {
      window.screenTimeAPI.clearData().then(() => {
        setUsage([]);
      });
    }
  }

  const totalTime = usage.reduce((sum, app) => sum + app.totalMs, 0);
  const activeApps = usage.filter(app => app.isActive).length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Screen Time</h1>
        <div className="header-actions">
          <button onClick={exportData}>Export JSON</button>
          <button onClick={clearData} className="btn-secondary">Clear Data</button>
        </div>
      </header>
      
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Total Time</span>
          <span className="stat-value"><Duration ms={totalTime} /></span>
        </div>
        <div className="stat">
          <span className="stat-label">Apps Tracked</span>
          <span className="stat-value">{usage.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Currently Active</span>
          <span className="stat-value">{activeApps}</span>
        </div>
        <div className="stat">
          <span className="stat-label">System Status</span>
          <span className={`stat-value ${systemInfo.isIdle ? 'idle' : 'active'}`}>
            {systemInfo.isIdle ? 'Idle' : 'Active'}
          </span>
        </div>
      </div>
      
      <main className="content">
        {loading && <p className="muted">Loading…</p>}
        {!loading && usage.length === 0 && <p>No data yet. Use your Mac a bit…</p>}
        {usage.length > 0 && (
          <table className="usage-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Total Time</th>
                <th>Sessions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {usage.map(app => <UsageRow key={app.id} app={app} />)}
            </tbody>
          </table>
        )}
      </main>
      <footer className="footer muted">
        Updates every 1s • Idle detection: {systemInfo.idleTime || 0}s • 
        {systemInfo.isIdle ? 'Paused' : 'Tracking'} • Enhanced accuracy
      </footer>
    </div>
  );
}