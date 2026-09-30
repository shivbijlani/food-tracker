import { describe, it, expect } from 'vitest'
import { readOAuthRedirectParams } from './engine.js'

describe('readOAuthRedirectParams', () => {
  it('reads auth-code returns from the query string', () => {
    const p = readOAuthRedirectParams({ search: '?code=c&state=s', hash: '' })
    expect(p.get('code')).toBe('c')
    expect(p.get('state')).toBe('s')
  })

  it('reads token-flow returns from the fragment', () => {
    const p = readOAuthRedirectParams({ search: '', hash: '#state=s&access_token=t&expires_in=3599&scope=x' })
    expect(p.get('access_token')).toBe('t')
    expect(p.get('state')).toBe('s')
  })

  it('reads error returns', () => {
    expect(readOAuthRedirectParams({ search: '', hash: '#state=s&error=access_denied' }).get('error')).toBe('access_denied')
  })

  it('ignores ordinary URLs', () => {
    expect(readOAuthRedirectParams({ search: '', hash: '' })).toBeNull()
    expect(readOAuthRedirectParams({ search: '?tab=log', hash: '#today' })).toBeNull()
    expect(readOAuthRedirectParams({ search: '?state=s', hash: '' })).toBeNull()
  })
})
