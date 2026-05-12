import { useState } from 'react'
import { SettingsView } from './App.jsx'

/** Settings button shown in the header of both Simple and Advanced modes.
 *  Optionally accepts `renderTrigger(onOpen)` to render a custom trigger
 *  (e.g. the StatusBadge) instead of the default ⚙ gear button. */
export function SettingsButton({ mode, setMode, folderName, storageProvider, renderTrigger }) {
  const [open, setOpen] = useState(false)
  const onOpen = () => setOpen(true)

  return (
    <>
      {renderTrigger ? renderTrigger(onOpen) : (
        <button
          className="settings-btn"
          onClick={onOpen}
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
      )}
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
