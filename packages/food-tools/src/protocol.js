import { createTools, VERSION, ToolError } from './tools.js'
import { planTool } from './planner.js'

const mode = { type: 'string', enum: ['advanced', 'simple'], default: 'advanced' }
const nutrition = {
  type: 'object', additionalProperties: false,
  properties: {
    protein_g: { type: ['number', 'null'], minimum: 0 },
    calories: { type: ['number', 'null'], minimum: 0 },
    calcium_mg: { type: ['number', 'null'], minimum: 0 },
    veg_servings: { type: ['number', 'null'], minimum: 0 },
    water_oz: { type: ['number', 'null'], minimum: 0 },
    omega3: { type: 'string', enum: ['Y', 'N', ''] },
  },
}
const preparationSchema = {
  type: 'object', required: ['apiVersion', 'mode', 'catalogRevision', 'items'],
  properties: {
    apiVersion: { const: 1 }, mode, catalogRevision: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object', required: ['query', 'options'],
        properties: { query: { type: 'string' }, options: { type: 'array', items: { type: 'object' } } },
      },
    },
    savedFoods: { type: 'array', items: { type: 'object' } },
  },
}
export const TOOL_DEFINITIONS = [
  {
    name: 'prepare_food_log',
    description: 'READ ONLY. Mandatory before logging. Look up each food separately using concise catalog search terms; returns saved foods, halves, recipe portions, canonical names, nutrition, sources and revision. If no fit, search alternate terms before explicitly choosing a new food. Never choose a different food merely to match.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['items'],
      properties: { items: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } }, mode },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'commit_food_log',
    description: 'Write selected prepared foods directly to Food Tracker OneDrive. Pass unchanged preparation, one selection per item, explicit date and meal, and stable operationId mode:YYYY-MM-DD:UUID. Reuse the exact request and operationId on retries; STALE_PREPARATION requires new lookup and reviewed selections. quantity multiplies the saved portion; never override saved nutrition.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['preparation', 'selections', 'date', 'meal', 'operationId'],
      properties: {
        preparation: preparationSchema,
        selections: { type: 'array', minItems: 1, items: {
          type: 'object', additionalProperties: false, required: ['quantity'],
          properties: {
            optionId: { type: 'string' }, quantity: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            newFood: { type: 'object', additionalProperties: false, required: ['name', 'nutritionStatus', 'nutrition'],
              description: 'A food with no matching option. You (the calling model) estimate its nutrition: always include nutrition.protein_g as your best estimate for the portion and set nutritionStatus "estimated" unless the user supplied the numbers.',
              properties: { name: { type: 'string' }, nutritionStatus: { type: 'string', enum: ['estimated', 'provided'] },
                nutrition,
              } },
          },
          oneOf: [{ required: ['optionId'], not: { required: ['newFood'] } }, { required: ['newFood'], not: { required: ['optionId'] } }],
        } },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, meal: { type: 'string', minLength: 1 },
        operationId: { type: 'string', minLength: 20, maxLength: 160 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'get_day', description: 'Read logged entries and totals. Unknown nutrition is reported as incomplete, not silently counted as zero.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['date'], properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, mode } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
]

export function safeError(error) {
  return error instanceof ToolError ? { code: error.code, message: error.message } :
    { code: 'INTERNAL_ERROR', message: 'The tool failed unexpectedly. No success is claimed; retry with the same operationId.' }
}

export function protocol(store, { brokerMode = false } = {}) {
  const tools = createTools(store)
  return async message => {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } }
    }
    if (message.id === undefined) return null
    const reply = result => ({ jsonrpc: '2.0', id: message.id, result })
    if (message.method === 'initialize') {
      const requested = message.params?.protocolVersion
      return reply({ protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(requested) ? requested : '2025-03-26',
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'mealjot', version: VERSION } })
    }
    if (message.method === 'ping') return reply({})
    if (message.method === 'tools/list') return reply({ tools: brokerMode ? [{
      name: 'mealjot_plan',
      description: 'Tokenless Food Tracker broker transport. Does not perform HTTP or accept credentials. Call with tool prepare_food_log/commit_food_log/get_day, its arguments, and previously fetched content/id/etag snapshots. Follow read_required/write_required plans using secure Graph Authorization-header substitution. After writes re-read and verify the same operation. Never report write_required as logged.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['tool', 'arguments'],
        properties: {
          tool: { type: 'string', enum: TOOL_DEFINITIONS.map(t => t.name) },
          arguments: { type: 'object' },
          snapshots: { type: 'object', additionalProperties: {
            type: 'object', required: ['content', 'id', 'etag'],
            properties: { content: { type: ['string', 'null'] }, id: { type: ['string', 'null'] }, etag: { type: ['string', 'null'] } },
          } },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }] : TOOL_DEFINITIONS })
    if (message.method === 'tools/call') {
      const name = message.params?.name
      if (brokerMode ? name !== 'mealjot_plan' : !Object.hasOwn(tools, name)) return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Unknown tool' } }
      try {
        const result = brokerMode ? await planTool(message.params.arguments || {}) : await tools[name](message.params.arguments || {})
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false })
      } catch (error) {
        return reply({ content: [{ type: 'text', text: JSON.stringify(safeError(error)) }], isError: true })
      }
    }
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }
  }
}
