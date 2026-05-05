// OpenAI client for nutrition estimation.
// User provides their own API key (stored in localStorage).

const KEY_STORAGE = 'food-tracker-openai-key'
const MODEL_STORAGE = 'food-tracker-openai-model'
const DEFAULT_MODEL = 'gpt-4o-mini'

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || ''
}

export function setApiKey(key) {
  if (key) localStorage.setItem(KEY_STORAGE, key)
  else localStorage.removeItem(KEY_STORAGE)
}

export function getModel() {
  return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL
}

export function setModel(model) {
  if (model) localStorage.setItem(MODEL_STORAGE, model)
  else localStorage.removeItem(MODEL_STORAGE)
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
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('No OpenAI API key configured. Add one in Settings.')

  const recipeContext = recipes.length
    ? `\n\nKnown recipes (per serving):\n${recipes.map(r =>
        `- ${r.Recipe}: ${r.Calories} kcal, ${r['Protein (g)']}g protein, ${r['Calcium (mg)']}mg calcium`
      ).join('\n')}`
    : ''

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModel(),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + recipeContext },
        { role: 'user', content: foodDescription },
      ],
      temperature: 0.2,
    }),
    signal,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI API error (${res.status}): ${err}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('No response from model')

  let parsed
  try { parsed = JSON.parse(content) } catch {
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
