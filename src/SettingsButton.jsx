import { useState } from 'react'
import { PROVIDERS, getProvider } from './storage/storage.js'
import { FSAProvider } from './storage/fsa-provider.js'
import { setProvider } from './storage/storage.js'

/** Settings button shown in the header of both Simple and Advanced modes. */
export function SettingsButton({ mode, setMode, folderName, storageProvider }) {
  const [open, setOpen] = useState(false)

  const changeFolder = async () => {
    const fsa = new FSAProvider()
    const handle = await fsa.pick()
    if (handle) {
      setProvider(fsa)
      localStorage.setItem('storage-provider', PROVIDERS.FSA)
      window.location.reload()
    }
  }

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
                  ? 'Simple: protein-only tracking'
                  : 'Advanced: full macro tracking'}
              </div>
            </div>

            <div className="settings-panel-section">
              <div className="settings-panel-label">Storage</div>
              <div className="settings-panel-value">📁 {folderName}</div>
              {storageProvider === PROVIDERS.FSA && (
                <button className="settings-panel-btn" onClick={changeFolder}>
                  📂 Change folder
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
