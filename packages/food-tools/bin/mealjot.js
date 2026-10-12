#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { createTools, VERSION, ToolError } from '../src/tools.js'
import { oneDriveStore } from '../src/onedrive.js'
import { environmentAuth, deviceAuth } from '../src/auth.js'
import { protocol, safeError } from '../src/protocol.js'
import { planTool } from '../src/planner.js'

const [command, ...flags] = process.argv.slice(2)
if (command === '--version') {
  console.log(VERSION)
} else if (!command || command === '--help') {
  console.log('mealjot <prepare_food_log|commit_food_log|get_day> < input.json\nmealjot plan < snapshot-request.json\nmealjot mcp [--device-code]\nNode 22+. plan is tokenless; a secure broker performs HTTPS externally. Direct mode accepts runtime MEALJOT_ACCESS_TOKEN, never input JSON or arguments.')
} else {
  try {
    if (flags.some(f => !['--device-code', '--broker'].includes(f))) throw new ToolError('INVALID_INPUT', 'Unsupported flag.')
    if (flags.includes('--broker') && (command !== 'mcp' || flags.includes('--device-code'))) throw new ToolError('INVALID_INPUT', 'Use mcp --broker without auth flags.')
    if (command === 'plan' && flags.length) throw new ToolError('INVALID_INPUT', 'plan accepts no auth flags.')
    const tokenless = command === 'plan' || flags.includes('--broker')
    const getAccessToken = tokenless ? null : flags.includes('--device-code') ? await deviceAuth() : environmentAuth()
    const store = tokenless ? null : oneDriveStore({ getAccessToken })
    if (command === 'mcp') {
      const handle = protocol(store, { brokerMode: flags.includes('--broker') })
      // Sequential dispatch prevents overlapping writes in this process.
      for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
        if (!line.trim()) continue
        let response
        try { response = await handle(JSON.parse(line)) }
        catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } } }
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
      }
    } else {
      const tools = createTools(store)
      if (command !== 'plan' && !Object.hasOwn(tools, command)) throw new ToolError('INVALID_INPUT', 'Unknown command.')
      let input = ''
      for await (const chunk of process.stdin) {
        input += chunk
        if (input.length > 1_000_000) throw new ToolError('INVALID_INPUT', 'Input exceeds 1 MB.')
      }
      const result = command === 'plan' ? await planTool(JSON.parse(input)) : await tools[command](JSON.parse(input))
      process.stdout.write(`${JSON.stringify(result)}\n`)
    }
  } catch (error) {
    const reported = error instanceof SyntaxError ? new ToolError('INVALID_INPUT', 'Input must be valid JSON.') : error
    process.stderr.write(`${JSON.stringify(safeError(reported))}\n`)
    process.exitCode = 1
  }
}
