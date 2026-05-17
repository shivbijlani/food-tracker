/**
 * Trailing-edge debounce. The returned function delays invocation of `fn`
 * until `wait` ms have elapsed since the last call. Subsequent calls during
 * the wait window are coalesced into a single later invocation using the
 * *last* set of arguments. A `.cancel()` method clears any pending call.
 *
 * Pure JS so it's safe to call from React effects, sync engine listeners,
 * etc. Not tied to React state.
 */
export function debounce(fn, wait = 100) {
  let timer = null
  let lastArgs = null
  const debounced = (...args) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const a = lastArgs
      lastArgs = null
      fn(...a)
    }, wait)
  }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
  }
  return debounced
}
