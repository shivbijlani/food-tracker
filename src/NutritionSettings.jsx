import { useState } from 'react'
import * as llm from './llm.js'
import * as openrouterAuth from './openrouter-auth.js'
import * as debugLog from './llmDebugLog.js'

export function NutritionSettings({ showOnlyOpenRouter = false }) {
  const [orConnected, setOrConnected] = useState(openrouterAuth.isConnected())
  const [orModel, setOrModel] = useState(() => llm.getModel('openrouter'))
  const [activeProvider, setActiveProvider] = useState(llm.getProvider())
  const [saved, setSaved] = useState(false)
  const [showManual, setShowManual] = useState(!openrouterAuth.isConnected())

  // Manual key section state
  const initManualProvider = () => {
    const p = llm.getProvider()
    return p === 'openrouter' ? 'github' : p
  }
  const [manualProvider, setManualProvider] = useState(initManualProvider)
  const [apiKey, setApiKeyState] = useState(() => llm.getApiKey(manualProvider))
  const [model, setModelState] = useState(() => llm.getModel(manualProvider))

  const handleManualProviderChange = (p) => {
    setManualProvider(p)
    setApiKeyState(llm.getApiKey(p))
    setModelState(llm.getModel(p))
  }

  const activateOpenRouter = () => {
    llm.setModel(orModel || llm.PROVIDERS.openrouter.defaultModel, 'openrouter')
    llm.setProvider('openrouter')
    setActiveProvider('openrouter')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleDisconnectOpenRouter = () => {
    openrouterAuth.clearKey()
    setOrConnected(false)
    if (activeProvider === 'openrouter') {
      llm.setProvider('github')
      setActiveProvider('github')
    }
    setShowManual(true)
  }

  const saveManualSettings = () => {
    llm.setProvider(manualProvider)
    llm.setApiKey(apiKey.trim(), manualProvider)
    llm.setModel(model.trim(), manualProvider)
    setActiveProvider(manualProvider)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const manualProviderInfo = llm.PROVIDERS[manualProvider]
  const isOrActive = activeProvider === 'openrouter'

  return (
    <div id="settings-llm">
      {!showOnlyOpenRouter && <h2>Nutrition Estimation</h2>}

      {/* OpenRouter OAuth option */}
      <div className={`llm-option-card${isOrActive ? ' llm-option-active' : ''}`}>
        <div className="llm-option-header">
          <span className="llm-option-icon">🔀</span>
          <div style={{ flex: 1 }}>
            <div className="llm-option-name">
              OpenRouter
              {!orConnected && <span className="llm-badge-recommended">Recommended</span>}
              {isOrActive && <span className="llm-badge-active">✓ Active</span>}
            </div>
            <div className="llm-option-tagline">Sign in once — works automatically with free AI models</div>
          </div>
        </div>

        {orConnected ? (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {!isOrActive && (
                <button className="btn" onClick={activateOpenRouter}>Use OpenRouter</button>
              )}
              {isOrActive && saved && <span style={{ color: 'var(--good)' }}>Saved ✓</span>}
              <button className="btn btn-secondary" onClick={handleDisconnectOpenRouter}>Disconnect</button>
            </div>
            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--muted)' }}>
                Advanced: choose a specific model
              </summary>
              <div className="field" style={{ marginTop: '0.5rem' }}>
                <label>Model</label>
                <input
                  value={orModel}
                  onChange={e => setOrModel(e.target.value)}
                  placeholder={llm.PROVIDERS.openrouter.defaultModel}
                />
                <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  Leave blank for automatic (free). Or enter a specific model from <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">openrouter.ai/models</a>.
                </div>
              </div>
              {isOrActive && !saved && (
                <button className="btn btn-secondary" onClick={activateOpenRouter}>Save model</button>
              )}
            </details>
          </div>
        ) : (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              No manual key needed — connect once with your OpenRouter account.
              You control your credit limits and can revoke access anytime from <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">openrouter.ai</a>.
            </p>
            <button className="btn" onClick={() => openrouterAuth.startAuth()}>
              Connect with OpenRouter →
            </button>
          </div>
        )}
      </div>

      {!showOnlyOpenRouter && (
        <>
          {/* Manual API key toggle */}
          <button
            className="btn btn-secondary"
            style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}
            onClick={() => setShowManual(s => !s)}
          >
            {showManual ? '▾' : '▸'} Use a manual API key instead
          </button>

          {showManual && (
            <div style={{ marginTop: '0.75rem' }}>
              <div className="field">
                <label>Provider</label>
                <select value={manualProvider} onChange={e => handleManualProviderChange(e.target.value)}>
                  {Object.entries(llm.PROVIDERS).filter(([k]) => k !== 'openrouter').map(([key, p]) => (
                    <option key={key} value={key}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>API key</label>
                <input
                  type="password"
                  placeholder={manualProviderInfo.keyPlaceholder}
                  value={apiKey}
                  onChange={e => setApiKeyState(e.target.value)}
                  autoComplete="off"
                />
                {manualProvider === 'github' ? (
                  <div className="muted" style={{fontSize:'0.85rem', marginTop: '0.5rem', lineHeight: '1.7'}}>
                    <strong>Free — no billing required.</strong> To get your token:
                    <ol style={{margin: '0.4rem 0 0 1.2rem', padding: 0}}>
                      <li>Go to <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">github.com/settings/personal-access-tokens/new</a></li>
                      <li>Give it any name (e.g. <em>mealjot</em>)</li>
                      <li>Under <strong>Account permissions</strong> → <strong>Models</strong> → set to <strong>Read-only</strong></li>
                      <li>Click <strong>Generate token</strong>, copy it, paste above</li>
                    </ol>
                    Rate limits: ~150 low-tier requests/day (more than enough for food logging).
                  </div>
                ) : manualProvider === 'openai' ? (
                  <div className="muted" style={{fontSize:'0.85rem', marginTop: '0.5rem', lineHeight: '1.7'}}>
                    <strong>Pay-as-you-go.</strong> ~$0.00015 per estimate with gpt-4o-mini.{' '}
                    <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get your key →</a>
                    <div style={{marginTop: '0.4rem'}}>
                      <button className="btn btn-secondary" style={{fontSize:'0.8rem', padding:'0.2rem 0.6rem'}}
                        onClick={async () => {
                          try {
                            const text = await navigator.clipboard.readText()
                            if (text.startsWith('sk-')) setApiKeyState(text.trim())
                            else alert('Clipboard does not contain an OpenAI key (should start with sk-)')
                          } catch { alert('Could not read clipboard. Paste the key manually.') }
                        }}>📋 Paste from clipboard</button>
                    </div>
                  </div>
                ) : manualProvider === 'claude' ? (
                  <div className="muted" style={{fontSize:'0.85rem', marginTop: '0.5rem', lineHeight: '1.7'}}>
                    <strong>Pay-as-you-go.</strong> ~$0.0001 per estimate with Claude Haiku.{' '}
                    <a href="https://console.anthropic.com/settings/api-keys" target="_blank" rel="noreferrer">Get your key →</a>
                    <div style={{marginTop: '0.4rem'}}>
                      <button className="btn btn-secondary" style={{fontSize:'0.8rem', padding:'0.2rem 0.6rem'}}
                        onClick={async () => {
                          try {
                            const text = await navigator.clipboard.readText()
                            if (text.startsWith('sk-ant-')) setApiKeyState(text.trim())
                            else alert('Clipboard does not contain an Anthropic key (should start with sk-ant-)')
                          } catch { alert('Could not read clipboard. Paste the key manually.') }
                        }}>📋 Paste from clipboard</button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Model</label>
                <input
                  value={model}
                  onChange={e => setModelState(e.target.value)}
                  placeholder={manualProviderInfo.defaultModel}
                />
              </div>
              <div className="flex gap-8 items-center">
                <button className="btn" onClick={saveManualSettings}>Save</button>
                {saved && !isOrActive && <span style={{ color: 'var(--good)' }}>Saved ✓</span>}
              </div>
            </div>
          )}
        </>
      )}

      {!showOnlyOpenRouter && <LlmDiagnostics />}
    </div>
  )
}

/**
 * Diagnostic LLM logging (task #273). Off by default. When on, each estimate /
 * coaching call is appended to an on-device ring buffer the user can copy into
 * a GitHub issue — enough for us to spot a model that misbehaves consistently.
 */
function LlmDiagnostics() {
  const [enabled, setEnabled] = useState(() => debugLog.isEnabled())
  const [count, setCount] = useState(() => debugLog.getLogs().length)
  const [status, setStatus] = useState('')

  const flash = (msg) => {
    setStatus(msg)
    setTimeout(() => setStatus(''), 2000)
  }

  const toggle = (on) => {
    debugLog.setEnabled(on)
    setEnabled(on)
    setCount(debugLog.getLogs().length)
  }

  const copyLogs = async () => {
    const logs = debugLog.getLogs()
    if (!logs.length) return flash('Nothing to copy yet')
    const md = debugLog.toMarkdown(logs)
    try {
      await navigator.clipboard.writeText(md)
      flash(`Copied ${logs.length} record${logs.length === 1 ? '' : 's'} ✓`)
    } catch {
      flash('Clipboard blocked — see console')
      console.log(md)
    }
  }

  const clear = () => {
    debugLog.clearLogs()
    setCount(0)
    flash('Cleared ✓')
  }

  return (
    <details style={{ marginTop: '1.25rem' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--muted)' }}>
        Troubleshooting: LLM diagnostics
      </summary>

      <div style={{ marginTop: '0.75rem' }}>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => toggle(e.target.checked)}
            style={{ marginTop: '0.25rem' }}
          />
          <span>
            <strong>Log LLM diagnostics</strong>
            <div className="muted" style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
              Records the last {debugLog.MAX_RECORDS} AI requests and responses (model, prompt,
              raw reply, timing) on this device only. Nothing is uploaded, and API keys are
              never stored. Turn this on, reproduce a bad response, then copy the logs into a
              GitHub issue.
            </div>
          </span>
        </label>

        <div className="flex gap-8 items-center" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={copyLogs} disabled={!count}>
            📋 Copy diagnostic logs
          </button>
          <button className="btn btn-secondary" onClick={clear} disabled={!count}>
            Clear logs
          </button>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {count} record{count === 1 ? '' : 's'} stored
          </span>
          {status && <span style={{ color: 'var(--good)' }}>{status}</span>}
        </div>
      </div>
    </details>
  )
}
