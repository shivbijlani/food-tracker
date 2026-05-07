import { useState } from 'react'
import { SettingsView } from './App.jsx'

/** Settings button shown in the header of both Simple and Advanced modes. */
export function SettingsButton({ mode, setMode, folderName, storageProvider }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className="settings-btn"
        onClick={() => setOpen(true)}
        title="Settings"
        aria-label="Settings"
      >
        ⚙
      </button>
      {open && (
        <div className="settings-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h2 style={{ margin: 0 }}>Settings</h2>
              <button className="settings-panel-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="settings-modal-body">
              <SettingsView
                folderName={folderName}
                storageProvider={storageProvider}
                mode={mode}
                setMode={(m) => { setMode(m); setOpen(false) }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

