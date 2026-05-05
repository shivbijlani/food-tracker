import { useState } from 'react'

/**
 * ⚙ Settings button shown in the header of both Simple and Advanced modes.
 * Opens a compact inline panel with the Simple/Advanced mode toggle.
 */
export function SettingsButton({ mode, setMode, folderName, onOpenSettings }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="settings-btn"
        onClick={() => setOpen(o => !o)}
        title="Settings"
        aria-label="Settings"
      >
        ⚙
      </button>
      {open && (
        <>
          <div className="settings-backdrop" onClick={() => setOpen(false)} />
          <div className="settings-panel">
            <div className="settings-panel-header">
              <span>Settings</span>
              <button className="settings-panel-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="settings-panel-section">
              <div className="settings-panel-label">Mode</div>
              <div className="mode-pill">
                <button
                  className={`mode-pill-btn ${mode === 'simple' ? 'active' : ''}`}
                  onClick={() => { setMode('simple'); setOpen(false) }}
                >Simple</button>
                <button
                  className={`mode-pill-btn ${mode === 'advanced' ? 'active' : ''}`}
                  onClick={() => { setMode('advanced'); setOpen(false) }}
                >Advanced</button>
              </div>
              <div className="settings-panel-hint">
                {mode === 'simple'
                  ? 'Protein-only tracking'
                  : 'Full macro & calorie tracking'}
              </div>
            </div>
            {folderName && (
              <div className="settings-panel-section">
                <div className="settings-panel-label">Storage</div>
                <div className="settings-panel-value">📁 {folderName}</div>
              </div>
            )}
            {onOpenSettings && (
              <div className="settings-panel-section">
                <button
                  className="settings-panel-link"
                  onClick={() => { setOpen(false); onOpenSettings() }}
                >
                  More settings →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
