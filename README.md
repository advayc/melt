# Screen Time Tracker (Electron + React)

Prototype macOS screen time tracker built with Electron + React + Vite.

Features:
- Per‑app active usage tracking via polling foreground window (3s interval)
- App icons (where available) captured from active process owner
- Session breakdown (last 10 sessions per app expandable)
- Dark modern UI (inspired by contemporary interview prep dashboards) with Roboto
- JSON export to Documents folder

## Development

Install deps and run in dev (renderer + electron):

```bash
npm install
npm run dev
```

## Packaging
(Add electron-builder or forge if you want packaging later.)

## Notes / Limitations
- Uses polling every 3 seconds; very short focus changes under interval granularity are approximated.
- Only tracks while the app is running (no background daemon yet).
- macOS privacy permissions: If icons or app detection fail, ensure Accessibility permissions are granted (System Settings > Privacy & Security > Accessibility / Screen Recording) for terminal / Electron.

## Next Ideas
- Persist history to disk (SQLite / JSON) per day
- Chart visualizations (stacked bar by hour)
- Daily / weekly rollups
- Menu bar mini display
- Configurable polling interval
- Idle detection + pause counting
