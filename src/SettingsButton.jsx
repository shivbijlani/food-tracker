import { useState, useEffect } from 'react'
import { SettingsView } from './App.jsx'
import { Modal } from './Modal.jsx'

const OPEN_EVENT = 'mealjot:open-settings'

/** Programmatically open the Settings modal and optionally scroll to an anchor.
 *  Usage: openSettings('settings-llm') */
export function openSettings(scrollTo) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { scrollTo } }))
}

/** Settings button shown in the header of both Simple and Advanced modes.
 *  Optionally accepts `renderTrigger(onOpen)` to render a custom trigger
 *  (e.g. the StatusBadge) instead of the default ⚙ gear button. */
export function SettingsButton({ mode, setMode, folderName, storageProvider, renderTrigger }) {
  const [open, setOpen] = useState(false)
  const [pendingScroll, setPendingScroll] = useState(null)
  const onOpen = () => setOpen(true)

  // Listen for global open requests (e.g. from a failed nutrition estimate).
  useEffect(() => {
    const handler = (e) => {
      setOpen(true)
      if (e.detail?.scrollTo) setPendingScroll(e.detail.scrollTo)
    }
    window.addEventListener(OPEN_EVENT, handler)
    return () => window.removeEventListener(OPEN_EVENT, handler)
  }, [])

  // After the modal is rendered, scroll the requested section into view.
  useEffect(() => {
    if (!open || !pendingScroll) return
    const id = pendingScroll
    setPendingScroll(null)
    // Wait one frame so the modal body is mounted.
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [open, pendingScroll])

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
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Settings">
        <SettingsView
          folderName={folderName}
          storageProvider={storageProvider}
          mode={mode}
          setMode={(m) => { setMode(m); setOpen(false) }}
        />
      </Modal>
    </>
  )
}
