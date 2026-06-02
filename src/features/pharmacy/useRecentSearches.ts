import { useCallback, useState } from 'react'

const STORAGE_KEY = 'rx-recent-searches'
const MAX = 8

function readStorage(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function useRecentSearches() {
  const [recents, setRecents] = useState<string[]>(readStorage)

  const push = useCallback((query: string) => {
    const q = query.trim()
    if (q.length < 2) return
    setRecents((prev) => {
      const next = [q, ...prev.filter((s) => s !== q)].slice(0, MAX)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [])

  const remove = useCallback((query: string) => {
    setRecents((prev) => {
      const next = prev.filter((s) => s !== query)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [])

  return { recents, push, remove }
}
