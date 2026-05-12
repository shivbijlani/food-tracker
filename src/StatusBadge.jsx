import { SettingsButton } from './SettingsButton.jsx'

/**
 * Single actionable badge that shows storage location + sync state.
 * Clicking it opens Settings. Coloring/label adapts to sync status so the
 * user can see at-a-glance whether things are syncing, idle, or broken.
 */
export function StatusBadge({ folderName, syncStatus, mode, setMode, storageProvider }) {
  const state = syncStatus?.state || 'idle'
  const anyReconnect = state === 'reconnect-required'
    || Object.values(syncStatus?.providers || {}).some(p => p?.needsReconnect)

  // Pick the most informative status: errors > syncing > offline > idle/synced.
  let dot, label, srLabel
  if (anyReconnect) {
    dot = '#e11d48'; label = 'Reconnect'; srLabel = 'Cloud reconnect needed — click to open settings'
  } else if (state === 'syncing') {
    dot = '#3b82f6'; label = 'Syncing…'; srLabel = 'Syncing to cloud'
  } else if (state === 'offline') {
    dot = '#aaa'; label = 'Offline'; srLabel = 'Offline — changes saved locally'
  } else if (state === 'synced') {
    dot = 'var(--good, #2e8b57)'; label = 'Synced'; srLabel = 'Synced to cloud'
  } else {
    dot = null; label = null; srLabel = `Storage: ${folderName || 'Browser'} — click to open settings`
  }

  return (
    <SettingsButton
      mode={mode}
      setMode={setMode}
      folderName={folderName}
      storageProvider={storageProvider}
      renderTrigger={(onOpen) => (
        <button
          type="button"
          className="folder-pill status-badge"
          onClick={onOpen}
          title={srLabel}
          aria-label={srLabel}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            border: 'none',
            font: 'inherit',
          }}
        >
          <span aria-hidden="true">📁</span>
          <span>{folderName || 'Browser'}</span>
          {dot && (
            <>
              <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
              <span
                aria-hidden="true"
                style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' }}
              />
              <span style={{ fontSize: '0.8rem' }}>{label}</span>
            </>
          )}
        </button>
      )}
    />
  )
}
