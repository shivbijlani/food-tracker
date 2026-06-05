export function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="settings-modal-header">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="settings-modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}
