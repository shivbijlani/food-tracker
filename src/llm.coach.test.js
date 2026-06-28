import { describe, test, expect } from 'vitest'
import { __testing } from './llm.js'

const { looksLikePromptLeak } = __testing

describe('looksLikePromptLeak', () => {
  // The exact text the user saw in-app (task #339): the model paraphrased our
  // COACH_GUIDANCE steps and spilled its scratch arithmetic instead of coaching.
  test('catches the reported reasoning/instruction leak', () => {
    const leak =
      'We need to respond with 2-3 plain text sentences, max 60 words. ' +
      'Assess progress: It\'s early morning, only one meal logged: 3oz pork ' +
      'taco 11g protein. Daily goal 120g. So remaining gap: 120-11 = 109g ' +
      'protein left to eat. Since it\'s early, it\'s normal. No praise. State ' +
      'most important remaining gap: need 109g protein for rest of day. Name ' +
      '1-2 foods from their history that would efficiently close the gap'
    expect(looksLikePromptLeak(leak)).toBe(true)
  })

  test('catches en-dash variants of the guidance (1–2 foods, 2–3 sentences)', () => {
    const leak =
      'Write 2–3 plain-text sentences. Assess progress, then name 1–2 foods ' +
      'from their history to close the gap.'
    expect(looksLikePromptLeak(leak)).toBe(true)
  })

  test('catches a verbatim system-prompt echo', () => {
    expect(
      looksLikePromptLeak('Reply with the coaching message only — no preamble.'),
    ).toBe(true)
  })

  test('catches a "You are a ... nutrition coach" persona echo', () => {
    expect(
      looksLikePromptLeak('You are a friendly nutrition coach. Reply briefly.'),
    ).toBe(true)
  })

  // Real coaching must pass straight through — these are second-person,
  // user-facing messages with no meta/instruction language.
  test('lets genuine coaching through', () => {
    const good = [
      "You're off to a solid start with that pork taco. You've got room for about 109g more protein today — a couple of eggs at lunch and grilled chicken at dinner would get you there comfortably.",
      "Nice early protein hit. Aim to fold in some Greek yogurt this afternoon and salmon tonight to stay on pace.",
      "Good momentum so far today. Keep an eye on your veg servings — a big salad with dinner would round things out.",
      "You're tracking well against your calcium goal. A glass of milk later would close the small gap that's left.",
    ]
    for (const msg of good) {
      expect(looksLikePromptLeak(msg)).toBe(false)
    }
  })

  test('handles empty / nullish input safely', () => {
    expect(looksLikePromptLeak('')).toBe(false)
    expect(looksLikePromptLeak(null)).toBe(false)
    expect(looksLikePromptLeak(undefined)).toBe(false)
  })
})
