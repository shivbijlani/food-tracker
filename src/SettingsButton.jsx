import { useState, useEffect, useRef } from 'react'
import { storage } from './storage/storage.js'

/**
 * Folder picker: lists existing cloud folders + "New folder…" option.
 * onPick(name) called when user selects or creates a folder.
 */
function FolderPicker({ providerPart, currentFolder, onPick, onCancel }) {
  const [folders, setFolders] = useState(null) // null = loading
  const [newMode, setNewMode] = useState(false)
  const [newName, setNewName] = useState(currentFolder || '')
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = storage.listRootFolders
          ? await storage.listRootFolders()
          : []
        if (!cancelled) setFolders(list)
      } catch {
        if (!cancelled) setFolders([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (newMode && inputRef.current) inputRef.current.focus()
  }, [newMode])

  return (
    <div className="folder-picker">
      <div className="folder-picker-header">
        {providerPart && <span className="settings-folder-prefix">{providerPart}/</span>}
        <span className="folder-picker-title">Pick folder</span>
        <button className="settings-folder-cancel" onClick={onCancel} title="Cancel">✕</button>
      </div>

      {folders === null ? (
        <div className="folder-picker-loading">Loading folders…</div>
      ) : (
        <ul className="folder-picker-list">
          {folders.map(name => (
            <li key={name}>
              <button
                className={`folder-picker-item ${name === currentFolder ? 'current' : ''}`}
                onClick={() => onPick(name)}
              >
                📁 {name}
                {name === currentFolder && <span className="folder-picker-check"> ✓</span>}
              </button>
            </li>
          ))}
          {!newMode && (
            <li>
              <button className="folder-picker-new-btn" onClick={() => setNewMode(true)}>
                ＋ New folder…
              </button>
            </li>
          )}
        </ul>
      )}

      {newMode && (
        <div className="folder-picker-new">
          <input
            ref={inputRef}
            className="settings-folder-input"
            value={newName}
            placeholder="folder-name"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) onPick(newName.trim())
              if (e.key === 'Escape') setNewMode(false)
            }}
          />
          <button
            className="settings-folder-save"
            onClick={() => newName.trim() && onPick(newName.trim())}
            title="Create & select"
          >✓</button>
          <button className="settings-folder-cancel" onClick={() => setNewMode(false)} title="Cancel">✕</button>
        </div>
      )}
    </div>
  )
}

/** ⚙ Settings button shown in the header of both Simple and Advanced modes. */
export function SettingsButton({ mode, setMode, folderName, storageProvider, onRenameFolder }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)

  const isCloud = storageProvider === 'onedrive' || storageProvider === 'google-drive'
  const folderPart = folderName?.includes('/') ? folderName.split('/').slice(1).join('/') : folderName
  const providerPart = folderName?.includes('/') ? folderName.split('/')[0] : null

  const handlePick = async (name) => {
    if (onRenameFolder) await onRenameFolder(name)
    setPicking(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="settings-btn"
        onClick={() => { setOpen(o => !o); setPicking(false) }}
        title="Settings"
        aria-label="Settings"
      >
        ⚙
      </button>
      {open && (
        <>
          <div className="settings-backdrop" onClick={() => { setOpen(false); setPicking(false) }} />
          <div className="settings-panel">
            <div className="settings-panel-header">
              <span>Settings</span>
              <button className="settings-panel-close" onClick={() => { setOpen(false); setPicking(false) }}>✕</button>
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
              {picking ? (
                <FolderPicker
                  providerPart={providerPart}
                  currentFolder={folderPart}
                  onPick={handlePick}
                  onCancel={() => setPicking(false)}
                />
              ) : (
                <div className="settings-panel-value">
                  📁 {folderName}
                  {isCloud && (
                    <button
                      className="settings-folder-rename-btn"
                      onClick={() => setPicking(true)}
                      title="Change folder"
                    >✏️</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
