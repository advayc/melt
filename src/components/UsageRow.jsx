import React, { useState } from 'react';
import Duration from './Duration';

export default function UsageRow({ app }) {
  const [open, setOpen] = useState(false);
  
  return (
    <>
      <tr className={`usage-row ${app.isActive ? 'active-app' : ''}`} onClick={() => setOpen(o=>!o)}>
        <td>
          <div className="app-cell">
            {app.iconDataURL && <img src={app.iconDataURL} alt="" className="app-icon" />}
            <div>
              <div className="app-name">{app.name}</div>
              <div className="app-id">{app.bundleId || app.id}</div>
              {app.currentWindow && app.isActive && (
                <div className="current-window">{app.currentWindow}</div>
              )}
            </div>
          </div>
        </td>
        <td><Duration ms={app.totalMs} /></td>
        <td>{app.sessions.length}</td>
        <td>
          <span className={`status-badge ${app.isActive ? 'active' : 'inactive'}`}>
            {app.isActive ? 'Active' : 'Inactive'}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="session-row">
          <td colSpan={4}>
            <div className="sessions">
              <h4>Recent Sessions</h4>
              {app.sessions.slice(-10).reverse().map((s,i)=>(
                <div key={i} className="session-chip">
                  <Duration ms={s.duration} />
                  {s.endReason && <span className="end-reason">({s.endReason})</span>}
                </div>
              ))}
              {app.sessions.length === 0 && <p className="muted">No completed sessions yet</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
