// LLM client for nutrition estimation — supports OpenRouter (OAuth), GitHub Models, OpenAI, and Claude.

import * as openrouterAuth from './openrouter-auth.js'

const PROVIDER_STORAGE = 'mealjot-llm-provider'
const KEY_STORAGE = 'mealjot-openai-key'
const MODEL_STORAGE = 'mealjot-openai-model'
const CLAUDE_KEY_STORAGE = 'mealjot-claude-key'
const CLAUDE_MODEL_STORAGE = 'mealjot-claude-model'
const GITHUB_KEY_STORAGE = 'mealjot-github-key'
const GITHUB_MODEL_STORAGE = 'mealjot-github-model'
const OPENROUTER_MODEL_STORAGE = 'mealjot-openrouter-model'

// Dynamically fetches free model IDs from OpenRouter's public catalog.
// Caches the result for 1 hour so we don't hit the API on every request.
let _freeModelsCache = null
let _freeModelsCacheTime = 0
const FREE_MODELS_TTL = 60 * 60 * 1000 // 1 hour

async function fetchFreeModels() {
  if (_freeModelsCache && Date.now() - _freeModelsCacheTime < FREE_MODELS_TTL) {
    return _freeModelsCache
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    if (!res.ok) return _freeModelsCache || []
    const { data } = await res.json()
    // Filter to free models (prompt and completion both $0), prefer those with
    // text output and larger context. Sort by context length descending so
    // higher-quality models are tried first.
    const free = data
      .filter(m => m.pricing?.prompt === '0' && m.pricing?.completion === '0'
        && m.id.endsWith(':free')
        && m.architecture?.output_modalities?.includes('text'))
      .sort((a, b) => (b.top_provider?.context_length || 0) - (a.top_provider?.context_length || 0))
      .map(m => m.id)
    if (free.length > 0) {
      _freeModelsCache = free
      _freeModelsCacheTime = Date.now()
    }
    return free
  } catch {
    return _freeModelsCache || []
  }
}

export const PROVIDERS = {
  openrouter: { label: 'OpenRouter', defaultModel: 'openrouter/auto:free', oauth: true },
  github: { label: 'GitHub Models (free)', defaultModel: 'openai/gpt-4o-mini', keyPlaceholder: 'github_pat_… or ghp_…', keyUrl: 'https://github.com/settings/tokens' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o-mini', keyPlaceholder: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  claude: { label: 'Anthropic Claude', defaultModel: 'claude-haiku-4-5', keyPlaceholder: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/api-keys' },
}

export function getProvider() {
  const stored = localStorage.getItem(PROVIDER_STORAGE) || 'github'
  // If openrouter is saved but user disconnected, fall back to github
  if (stored === 'openrouter' && !openrouterAuth.isConnected()) return 'github'
  return stored
}
export function setProvider(p) {
  if (p) localStorage.setItem(PROVIDER_STORAGE, p)
}

function keyStorageFor(provider) {
  if (provider === 'claude') return CLAUDE_KEY_STORAGE
  if (provider === 'github') return GITHUB_KEY_STORAGE
  return KEY_STORAGE
}
function modelStorageFor(provider) {
  if (provider === 'openrouter') return OPENROUTER_MODEL_STORAGE
  if (provider === 'claude') return CLAUDE_MODEL_STORAGE
  if (provider === 'github') return GITHUB_MODEL_STORAGE
  return MODEL_STORAGE
}

export function getApiKey(provider = getProvider()) {
  if (provider === 'openrouter') return openrouterAuth.getKey() || ''
  return localStorage.getItem(keyStorageFor(provider)) || ''
}
export function setApiKey(key, provider = getProvider()) {
  if (provider === 'openrouter') return // managed by openrouter-auth
  const k = keyStorageFor(provider)
  if (key) localStorage.setItem(k, key)
  else localStorage.removeItem(k)
}

export function getModel(provider = getProvider()) {
  return localStorage.getItem(modelStorageFor(provider)) || PROVIDERS[provider]?.defaultModel || 'gpt-4o-mini'
}
export function setModel(model, provider = getProvider()) {
  const k = modelStorageFor(provider)
  if (model) localStorage.setItem(k, model)
  else localStorage.removeItem(k)
}

/**
 * Returns true if the currently-configured LLM provider has credentials.
 * Used to decide whether to surface AI-powered features like coaching and
 * the "Estimate and save" action.
 */
export function isReady(provider = getProvider()) {
  return Boolean(getApiKey(provider))
}

const NUTRITION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    calories: { type: 'number', description: 'total kcal' },
    protein_g: { type: 'number', description: 'grams of protein' },
    calcium_mg: { type: 'number', description: 'milligrams of calcium' },
    veg_servings: { type: 'number', description: '1 serving = ~1 cup raw or 1/2 cup cooked vegetables' },
    omega3: { type: 'string', enum: ['Y', 'N'], description: 'Y if the meal contains a meaningful source (fatty fish, walnuts, flax, chia)' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['calories', 'protein_g', 'calcium_mg', 'veg_servings', 'omega3', 'confidence'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `You are a precise nutrition estimator. Given a free-text food description (which may include multiple items, portions, and recipe references), estimate the totals and reply with JSON only.

Required JSON schema:
{
  "calories": number,           // total kcal
  "protein_g": number,          // grams of protein
  "calcium_mg": number,         // milligrams of calcium
  "veg_servings": number,       // 1 serving = ~1 cup raw or 1/2 cup cooked vegetables
  "omega3": "Y" | "N",          // Y if the meal contains a meaningful source (fatty fish, walnuts, flax, chia)
  "confidence": "low" | "medium" | "high"
}

Be conservative. Round calories/calcium to nearest 10, protein to nearest 1, veg_servings to 0.5. Use values from typical USDA food data. If the input is empty or non-food, return all zeros with confidence "low".`

export async function estimateNutrition(foodDescription, { recipes = [], signal } = {}) {
  const provider = getProvider()
  const apiKey = getApiKey(provider)
  if (!apiKey) {
    const err = provider === 'openrouter'
      ? new Error('OpenRouter not connected. Connect in Settings.')
      : new Error(`No ${PROVIDERS[provider].label} API key configured. Add one in Settings.`)
    err.code = 'LLM_NOT_CONFIGURED'
    throw err
  }

  const recipeContext = recipes.length
    ? `\n\nKnown recipes (nutrition is per serving):\n${recipes.map(r =>
        `- ${r.Recipe}${r.Servings ? ` (makes ${r.Servings} servings)` : ''}: ${r.Calories} kcal, ${r['Protein (g)']}g protein, ${r['Calcium (mg)']}mg calcium per serving`
      ).join('\n')}`
    : ''

  const model = getModel(provider)
  const systemContent = SYSTEM_PROMPT + recipeContext

  let res
  if (provider === 'openrouter') {
    // For free models, dynamically discover fallbacks from OpenRouter's catalog
    // so we auto-route around rate-limited providers. Max 3 models per API limit.
    let fallbacks
    if (model.endsWith(':free')) {
      const freeModels = await fetchFreeModels()
      fallbacks = [model, ...freeModels.filter(m => m !== model)].slice(0, 3)
    } else {
      fallbacks = [model]
    }
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://mealjot.com/',
        'X-Title': 'Mealjot Food Tracker',
      },
      body: JSON.stringify({
        models: fallbacks,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: foodDescription },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'nutrition_estimate', strict: true, schema: NUTRITION_JSON_SCHEMA },
        },
        temperature: 0.2,
      }),
      signal,
    })
  } else if (provider === 'claude') {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        system: systemContent,
        messages: [{ role: 'user', content: foodDescription }],
        temperature: 0.2,
      }),
      signal,
    })
  } else if (provider === 'github') {
    res = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemContent + '\n\nReturn only valid JSON, no markdown.' },
          { role: 'user', content: foodDescription },
        ],
        temperature: 0.2,
      }),
      signal,
    })
  } else {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'nutrition_estimate', strict: true, schema: NUTRITION_JSON_SCHEMA },
        },
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: foodDescription },
        ],
        temperature: 0.2,
      }),
      signal,
    })
  }

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${PROVIDERS[provider].label} API error (${res.status}): ${err}`)
  }

  const data = await res.json()

  let content
  if (provider === 'claude') {
    content = data.content?.[0]?.text
  } else {
    // openrouter, openai, github all use chat completions response shape
    content = data.choices?.[0]?.message?.content
  }
  if (!content) throw new Error('No response from model')

  let parsed
  try {
    // Try parsing the entire content as JSON first (common for structured outputs)
    parsed = JSON.parse(content)
  } catch {
    // Fallback: Extract JSON from content (Claude or other models may wrap in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Model returned no JSON: ' + content.slice(0, 200))
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      throw new Error('Model returned invalid JSON: ' + content.slice(0, 200))
    }
  }

  return {
    calories: Math.round(Number(parsed.calories) || 0),
    protein_g: Math.round(Number(parsed.protein_g) || 0),
    calcium_mg: Math.round(Number(parsed.calcium_mg) || 0),
    veg_servings: Math.round((Number(parsed.veg_servings) || 0) * 2) / 2,
    omega3: parsed.omega3 === 'Y' || parsed.omega3 === true ? 'Y' : 'N',
    confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
  }
}

// --- Coaching ---------------------------------------------------------------

const COACH_SYSTEM_PROMPT = `Reply with the coaching message only — no preamble, no rules, no quoting these instructions.`

// Kept separate from the system prompt so it can be included in the user
// message instead. Small/free models often echo system prompts verbatim,
// so we put behavioural guidance in the user turn and keep the system
// message minimal. Used by the leak filter below as well.
const COACH_GUIDANCE = `As a performance nutritionist, respond to this meal log entry.

Write 2–3 plain-text sentences (60 words max) that:
1. Honestly assess today's progress — skip praise unless they are genuinely on track (within 10% of a goal). If behind, say so plainly.
2. State the most important remaining gap in specific numbers.
3. Name 1–2 foods from their history that would efficiently close the gap.

Plain text only — no markdown, no bullet points, no headings. Never invent numbers or foods not in the provided data.`

/**
 * Get a short coaching message from the configured LLM.
 * Silently returns `null` if not configured or if the call fails.
 *
 * @param {{ recentEntriesText?: string, systemsText?: string, proteinGoal?: number,
 *           lastMeal?: string, lastProteinLogged?: number|string,
 *           todayEntriesText?: string, todayTotals?: object,
 *           goalsText?: string, frequentFoodsText?: string,
 *           signal?: AbortSignal }} ctx
 * @returns {Promise<string|null>}
 */
export async function getCoaching(ctx = {}) {
  const provider = getProvider()
  const apiKey = getApiKey(provider)
  if (!apiKey) return null

  const {
    recentEntriesText = '',
    systemsText = '',
    proteinGoal,
    lastMealLine = '',
    todayEntriesText = '',
    todayTotals = null,
    goalsText = '',
    frequentFoodsText = '',
    signal,
  } = ctx

  // Cap context sizes to keep latency + token costs predictable.
  const trimmedEntries = String(recentEntriesText).slice(-2000)
  const trimmedSystems = String(systemsText).slice(0, 1000)

  const todaySection = todayEntriesText
    ? `Today's meals so far:\n${todayEntriesText}`
    : 'No meals logged today yet.'

  const totalsLine = todayTotals
    ? `Today's totals: ${todayTotals.calories}kcal, ${todayTotals.protein}g protein, ${todayTotals.calcium}mg calcium, ${todayTotals.veg} veg servings, omega-3: ${todayTotals.omega3 ? 'yes' : 'no'}`
    : ''

  const userContent = [
    COACH_GUIDANCE,
    '',
    goalsText ? `Daily goals: ${goalsText}` : (proteinGoal ? `Daily protein goal: ${proteinGoal}g` : ''),
    '',
    todaySection,
    totalsLine,
    lastMealLine ? `\nJust logged: ${lastMealLine}.` : '',
    frequentFoodsText ? `\nFoods this user has tracked before (suggest from these):\n${frequentFoodsText}` : '',
    trimmedSystems ? `\nPersonal systems:\n${trimmedSystems}` : '',
    trimmedEntries ? `\nRecent history (last 30 days, for pattern context):\n${trimmedEntries}` : '',
  ].filter(Boolean).join('\n')

  const model = getModel(provider)

  try {
    let res
    if (provider === 'openrouter') {
      let fallbacks = [model]
      if (model.endsWith(':free')) {
        const freeModels = await fetchFreeModels()
        fallbacks = [model, ...freeModels.filter(m => m !== model)].slice(0, 3)
      }
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://mealjot.com/',
          'X-Title': 'Mealjot Food Tracker',
        },
        body: JSON.stringify({
          models: fallbacks,
          messages: [
            { role: 'system', content: COACH_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          temperature: 0.7,
          max_tokens: 120,
        }),
        signal,
      })
    } else if (provider === 'claude') {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 120,
          system: COACH_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
          temperature: 0.7,
        }),
        signal,
      })
    } else if (provider === 'github') {
      res = await fetch('https://models.github.ai/inference/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: COACH_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          temperature: 0.7,
          max_tokens: 120,
        }),
        signal,
      })
    } else {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: COACH_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          temperature: 0.7,
          max_tokens: 120,
        }),
        signal,
      })
    }

    if (!res.ok) return null
    const data = await res.json()
    const content = provider === 'claude'
      ? data.content?.[0]?.text
      : data.choices?.[0]?.message?.content
    if (!content) return null

    // Strip any markdown formatting the model may have ignored instructions on.
    let cleaned = String(content)
      .trim()
      .replace(/^[#>*\-•\s]+/, '')
      .replace(/\*\*/g, '')
      .replace(/^["']|["']$/g, '')
      .trim()

    // Leak filter: small/free models sometimes echo the system prompt or our
    // guidance text. If the response contains a non-trivial substring from
    // either, drop it rather than show garbled output to the user.
    if (looksLikePromptLeak(cleaned)) return null

    return cleaned || null
  } catch {
    // Abort or network/parse failure — silent.
    return null
  }
}

function looksLikePromptLeak(text) {
  if (!text) return false
  const lower = text.toLowerCase()
  // Clear giveaways from either prompt.
  const tells = [
    'you are a friendly',
    'coaching message only',
    'nutrition coach',
    'never invent data',
    'plain text only',
    'rules:',
    'max 50 words',
    'maximum 60 words',
    'personal systems:',
    'recent log',
  ]
  let hits = 0
  for (const t of tells) if (lower.includes(t)) hits++
  // 2+ tells is almost certainly a leak; a single very specific one also counts.
  return hits >= 2
    || lower.includes('you are a friendly nutrition coach')
    || lower.includes('coaching message only')
}
