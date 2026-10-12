import { mockGraph } from './fixtures.mjs'
globalThis.fetch = mockGraph({ forceConflict: process.env.MEALJOT_TEST_CONFLICT === '1' }).fetchImpl
