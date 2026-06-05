import { Modal } from './Modal.jsx'
import { NutritionSettings } from './NutritionSettings.jsx'

export function UpsellModal({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="✨ Nutrition Estimation">
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Connect OpenRouter to estimate nutrition automatically using AI. Or continue manually if you prefer.
      </p>

      <NutritionSettings showOnlyOpenRouter={true} />

      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <button className="btn btn-secondary" onClick={onClose} style={{ width: '100%', textAlign: 'center' }}>
          Continue manually
        </button>
      </div>
    </Modal>
  )
}
