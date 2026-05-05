/**
 * Storage provider picker component
 */
import { useState, useEffect } from 'react'
import { 
  getAvailableProviders, 
  getProviderName, 
  PROVIDERS, 
  setProvider 
} from '../storage/storage.js'
import { FSAProvider } from '../storage/fsa-provider.js'
import { OneDriveProvider } from '../storage/onedrive-provider.js'
import { GoogleDriveProvider } from '../storage/google-drive-provider.js'

export function StoragePicker({ onStorageReady }) {
  const [availableProviders] = useState(getAvailableProviders())
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')

  // Check if we have existing storage on mount
  useEffect(() => {
    const savedProvider = localStorage.getItem('storage-provider')
    if (savedProvider && availableProviders.includes(savedProvider)) {
      setSelectedProvider(savedProvider)
      tryConnectProvider(savedProvider, true)
    }
  }, [availableProviders])

  const tryConnectProvider = async (providerId, isReconnect = false) => {
    setIsConnecting(true)
    setError('')

    try {
      let provider
      switch (providerId) {
        case PROVIDERS.FSA:
          provider = new FSAProvider()
          break
        case PROVIDERS.ONEDRIVE:
          provider = new OneDriveProvider()
          break
        case PROVIDERS.GOOGLE_DRIVE:
          provider = new GoogleDriveProvider()
          break
        default:
          throw new Error('Unknown provider')
      }

      const success = await provider.init()
      if (success && await provider.isReady()) {
        setProvider(provider)
        localStorage.setItem('storage-provider', providerId)
        onStorageReady(providerId)
      } else if (!isReconnect) {
        // init() returned false, probably redirected for OAuth
        // Don't show error, user will be back after auth
      } else {
        setError('Failed to connect to storage')
      }
    } catch (e) {
      console.error('Storage connection error:', e)
      setError(e.message || 'Failed to connect to storage')
    } finally {
      setIsConnecting(false)
    }
  }

  const handleProviderSelect = (providerId) => {
    setSelectedProvider(providerId)
    tryConnectProvider(providerId)
  }

  const handleReconnect = () => {
    if (selectedProvider) {
      tryConnectProvider(selectedProvider, true)
    }
  }

  const handleChangeProvider = () => {
    localStorage.removeItem('storage-provider')
    setSelectedProvider(null)
    setError('')
  }

  const getProviderDescription = (provider) => {
    switch (provider) {
      case PROVIDERS.FSA:
        return 'Store files locally on your computer. Works in Chrome/Edge on desktop only.'
      case PROVIDERS.ONEDRIVE:
        return 'Store files in your OneDrive. Sync across all devices and works on mobile.'
      case PROVIDERS.GOOGLE_DRIVE:
        return 'Store files in your Google Drive. Sync across all devices and works on mobile.'
      default:
        return ''
    }
  }

  return (
    <div className="welcome">
      <h1>🍎 Food Tracker</h1>
      <p>Choose how to store your food tracking data</p>

      {!selectedProvider && (
        <div className="storage-options">
          {availableProviders.map(provider => (
            <div key={provider} className="card storage-option">
              <h3>{getProviderName(provider)}</h3>
              <p className="muted">{getProviderDescription(provider)}</p>
              <button 
                className="btn"
                onClick={() => handleProviderSelect(provider)}
                disabled={provider === PROVIDERS.GOOGLE_DRIVE}
              >
                {provider === PROVIDERS.GOOGLE_DRIVE ? 'Coming Soon' : 'Choose'}
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedProvider && (
        <div className="card">
          <h3>Connecting to {getProviderName(selectedProvider)}</h3>
          
          {isConnecting && (
            <div className="banner info">
              <span className="spinner"></span>
              Connecting to storage...
            </div>
          )}

          {error && (
            <div className="banner error">
              <strong>Connection Failed:</strong> {error}
              <br />
              <button className="btn" onClick={handleReconnect}>
                Try Again
              </button>
              <button className="btn btn-secondary" onClick={handleChangeProvider}>
                Choose Different Storage
              </button>
            </div>
          )}

          {selectedProvider === PROVIDERS.ONEDRIVE && !isConnecting && !error && (
            <div className="banner info">
              You may be redirected to Microsoft for authentication...
            </div>
          )}
        </div>
      )}
    </div>
  )
}