import { useSyncExternalStore } from 'react'
import type { ChannelView } from '../../api/routes.ts'
import type { State } from './store.ts'

// Stars are yours alone: this browser keeps them, per board, and the board never sees them.

const keyOf = (state: State) => `board.stars:${state.discovery?.url ?? location.host}`

const listeners = new Set<() => void>()
const cache = new Map<string, string[]>()

function read(key: string): string[] {
  const known = cache.get(key)
  if (known) return known
  let paths: string[] = []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (Array.isArray(value)) paths = value.filter((path): path is string => typeof path === 'string')
  } catch {}
  cache.set(key, paths)
  return paths
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab starring a channel shows here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith('board.stars:')) {
      cache.delete(event.key)
      listener()
    }
  }
  addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    removeEventListener('storage', onStorage)
  }
}

/** The channels you starred on this board. */
export const starsOf = (state: State): string[] => read(keyOf(state))

export const useStars = (state: State): string[] => useSyncExternalStore(subscribe, () => starsOf(state))

export function toggleStar(state: State, path: string) {
  const key = keyOf(state)
  const current = read(key)
  const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path]
  cache.set(key, next)
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {}
  for (const listener of listeners) listener()
}

/**
 * The sidebar's channels: the starred ones on top, then the rest grouped by the path before their
 * last `/`, each list by path. A star on a channel the board no longer has shows nothing.
 */
export function sections(channels: ChannelView[], stars: string[]): { starred: ChannelView[]; groups: [string, ChannelView[]][] } {
  const starred: ChannelView[] = []
  const groups = new Map<string, ChannelView[]>()
  for (const channel of [...channels].sort((a, b) => a.path.localeCompare(b.path))) {
    if (stars.includes(channel.path)) {
      starred.push(channel)
      continue
    }
    const at = channel.path.lastIndexOf('/')
    const group = at === -1 ? 'channels' : channel.path.slice(0, at)
    groups.set(group, [...(groups.get(group) ?? []), channel])
  }
  return { starred, groups: [...groups] }
}
