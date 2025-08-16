import React, { useState } from 'react';
import Duration from './Duration';

export default function UsageRow({ app }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="usage-row" onClick={() => setOpen(o=>!o)}>
        <td>
          <div className="app-cell">
            {app.iconDataURL && <img src={app.iconDataURL} alt="" className="app-icon" />}
            <div>
              <div className="app-name">{app.name}</div>
              <div className="app-id">{app.id}</div>
            </div>
          </div>
        </td>
        <td><Duration ms={app.totalMs} /></td>
        <td>{app.sessions.length}</td>
      </tr>
      {open && (
        <tr className="session-row">
          <td colSpan={3}>
            <div className="sessions">
              {app.sessions.slice(-10).reverse().map((s,i)=>(
                <div key={i} className="session-chip">
                  <Duration ms={s.duration} />
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
