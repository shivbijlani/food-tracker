import { describe, expect, it } from 'vitest'
import { parse, serialize, makeMdTableCodec } from './mdTable.js'

const PLAN = `## Today

| ID | 🎯 | Task | Priority | Added | Linked ID |
|---|---|------|----------|-------|----------|
| 70 | 🟡 | First task | Sydney | 2026-01-27 | |
| 71 | 🔴 | Second task | Vibe | 2026-01-28 | |

## Deferred

| ID | 🎯 | Task | Priority | Added | Linked ID |
|---|---|------|----------|-------|----------|
| 72 | ⚪ | Later task | - | 2026-01-29 | |

## Priorities

1. 70
2. 71
`

describe('mdTable codec', () => {
  it('parses rows into id-keyed records and keeps the frame', () => {
    const { records, frame } = parse(PLAN)
    expect(Object.keys(records).sort()).toEqual(['70', '71', '72'])
    expect(records['70'].section).toBe('Today')
    expect(records['72'].section).toBe('Deferred')
    expect(records['70'].raw).toContain('First task')
    expect(frame).toContain('## Priorities')
    expect(frame).toContain('1. 70')
    expect(frame).not.toContain('First task') // rows replaced by markers
  })

  it('round-trips unchanged content exactly', () => {
    const { records, frame } = parse(PLAN)
    expect(serialize({ records, frame })).toBe(PLAN)
  })

  it('drops a deleted row on serialize', () => {
    const { records, frame } = parse(PLAN)
    delete records['71']
    const out = serialize({ records, frame })
    expect(out).not.toContain('Second task')
    expect(out).toContain('First task')
    expect(out).toContain('Later task')
  })

  it('inserts a row added on another device under its section', () => {
    const { records, frame } = parse(PLAN)
    records['99'] = { section: 'Today', raw: '| 99 | 🟡 | New from mobile | - | 2026-02-01 | |' }
    const out = serialize({ records, frame })
    const lines = out.split('\n')
    const todoIdx = lines.findIndex(l => l.startsWith('## Today'))
    const defIdx = lines.findIndex(l => l.startsWith('## Deferred'))
    const newIdx = lines.findIndex(l => l.includes('New from mobile'))
    expect(newIdx).toBeGreaterThan(todoIdx)
    expect(newIdx).toBeLessThan(defIdx) // landed in Today, not Deferred
  })

  it('extracts id from a composite first cell (ADO link form)', () => {
    const md = `## Today

| ID | 🎯 | Task | Priority | Added | Linked ID |
|---|---|------|----------|-------|----------|
| 70,[1234](https://ado/1234) | 🟡 | Linked task | - | 2026-01-27 | |
`
    const { records } = parse(md)
    expect(records['70']).toBeDefined()
    expect(records['70'].raw).toContain('1234')
  })

  it('handles empty / missing content', () => {
    expect(parse('').records).toEqual({})
    expect(serialize({ records: {}, frame: '' })).toBe('')
  })
})

describe('mdTable codec — food-tracker entries shape (many rows per Date)', () => {
  // After disable-entry-merging, an entries-YYYY-MM.md file can hold many
  // rows that share a Date column. The default codec keys on column 0's
  // leading digits, so all such rows would collide to id "2026". The custom
  // idFn variant below uses the last column (an explicit per-row Id) to
  // disambiguate, which is what a real food-tracker codec registration would
  // pass in.
  const ENTRIES = `| Date | Meal | Food Description | Calories | Id |
|------|------|------------------|----------|----|
| 2026-06-08 | Breakfast | Oatmeal | 300 | r-aaa |
| 2026-06-08 | Breakfast | Eggs | 180 | r-bbb |
| 2026-06-08 | Lunch | Sandwich | 450 | r-ccc |
| 2026-06-07 | Dinner | Pasta | 600 | r-ddd |
`

  it('default codec COLLAPSES same-Date rows (documents the limitation)', () => {
    const { records } = parse(ENTRIES)
    // All four rows hash to id "2026" because that's the leading-digit prefix
    // of every Date. Only the first survives as a record; the rest are kept
    // as literal frame text and won't participate in per-row merge.
    expect(Object.keys(records)).toEqual(['2026'])
  })

  it('makeMdTableCodec({ idFn: last cell }) keeps every row distinct', () => {
    const codec = makeMdTableCodec({
      idFn: (cells) => cells[cells.length - 1],
    })
    const { records } = codec.parse(ENTRIES)
    expect(Object.keys(records).sort()).toEqual(['r-aaa', 'r-bbb', 'r-ccc', 'r-ddd'])
    expect(records['r-aaa'].raw).toContain('Oatmeal')
    expect(records['r-bbb'].raw).toContain('Eggs')   // same Date+Meal as Oatmeal — still distinct
    expect(records['r-ccc'].raw).toContain('Sandwich')
    expect(records['r-ddd'].raw).toContain('Pasta')
  })

  it('round-trips entries content exactly with the custom idFn', () => {
    const codec = makeMdTableCodec({
      idFn: (cells) => cells[cells.length - 1],
    })
    const { records, frame } = codec.parse(ENTRIES)
    expect(codec.serialize({ records, frame })).toBe(ENTRIES)
  })

  it('deletes a single row without touching its same-Date sibling', () => {
    const codec = makeMdTableCodec({
      idFn: (cells) => cells[cells.length - 1],
    })
    const { records, frame } = codec.parse(ENTRIES)
    delete records['r-bbb']        // remove just "Eggs"
    const out = codec.serialize({ records, frame })
    expect(out).toContain('Oatmeal')   // sibling Breakfast row survives
    expect(out).not.toContain('Eggs')  // tombstoned row removed
    expect(out).toContain('Sandwich')
    expect(out).toContain('Pasta')
  })

  it('inserts a new row appended on another device (no section anchor)', () => {
    const codec = makeMdTableCodec({
      idFn: (cells) => cells[cells.length - 1],
    })
    const { records, frame } = codec.parse(ENTRIES)
    records['r-eee'] = {
      section: null,
      raw: '| 2026-06-08 | Snack | Apple | 95 | r-eee |',
    }
    const out = codec.serialize({ records, frame })
    expect(out).toContain('Apple')
    expect(out).toContain('r-eee')
  })
})
