// LLM client for nutrition estimation — supports OpenRouter (OAuth), GitHub Models, OpenAI, and Claude.

import * as openrouterAuth from './openrouter-auth.js'

const PROVIDER_STORAGE = 'food-tracker-llm-provider'
const KEY_STORAGE = 'food-tracker-openai-key'
const MODEL_STORAGE = 'food-tracker-openai-model'
const CLAUDE_KEY_STORAGE = 'food-tracker-claude-key'
const CLAUDE_MODEL_STORAGE = 'food-tracker-claude-model'
const GITHUB_KEY_STORAGE = 'food-tracker-github-key'
const GITHUB_MODEL_STORAGE = 'food-tracker-github-model'
const OPENROUTER_MODEL_STORAGE = 'food-tracker-openrouter-model'

export const PROVIDERS = {
  openrouter: { label: 'OpenRouter', defaultModel: 'openai/gpt-4o-mini', oauth: true },
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
    if (provider === 'openrouter') throw new Error('OpenRouter not connected. Connect in Settings → LLM.')
    throw new Error(`No ${PROVIDERS[provider].label} API key configured. Add one in Settings.`)
  }

  const recipeContext = recipes.length
    ? `\n\nKnown recipes (per serving):\n${recipes.map(r =>
        `- ${r.Recipe}: ${r.Calories} kcal, ${r['Protein (g)']}g protein, ${r['Calcium (mg)']}mg calcium`
      ).join('\n')}`
    : ''

  const model = getModel(provider)
  const systemContent = SYSTEM_PROMPT + recipeContext

  let res
  if (provider === 'openrouter') {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://shivbijlani.github.io/food-tracker/',
        'X-Title': 'Food Tracker',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: foodDescription },
        ],
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
        response_format: { type: 'json_object' },
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

  // Extract JSON from content (Claude may wrap in markdown code fences)
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Model returned no JSON: ' + content.slice(0, 200))

  let parsed
  try { parsed = JSON.parse(jsonMatch[0]) } catch {
    throw new Error('Model returned invalid JSON: ' + content.slice(0, 200))
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
