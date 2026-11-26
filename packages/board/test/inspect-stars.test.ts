import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { State } from '../src/inspect/app/store.ts'

// Starred channels: what the sidebar lists on top, and that a star stays in this browser, per board.

const storage = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
}
const boardAt = (url: string) => ({ discovery: { url } }) as unknown as State

/** The page as a fresh load finds it: nothing kept in memory, only what the browser stored. */
async function load() {
  vi.resetModules()
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('location', { host: 'localhost:4000' })
  vi.stubGlobal('addEventListener', () => {})
  vi.stubGlobal('removeEventListener', () => {})
  return import('../src/inspect/app/stars.ts')
}

const channels = ['general', 'incidents', 'team/api', 'team/web', 'random'].map((path) => ({ path }))
const paths = (list: { path: string }[]) => list.map((c) => c.path)

beforeEach(() => storage.clear())

describe('sections', () => {
  it('lists starred channels on top and takes them out of their groups', async () => {
    const { sections } = await load()
    const { starred, groups } = sections(channels, ['team/web', 'random'])
    expect(paths(starred)).toEqual(['random', 'team/web'])
    expect(groups.map(([group, list]) => [group, paths(list)])).toEqual([
      ['channels', ['general', 'incidents']],
      ['team', ['team/api']],
    ])
  })

  it('shows nothing for a star on a channel the board no longer has', async () => {
    const { sections } = await load()
    expect(paths(sections(channels, ['gone']).starred)).toEqual([])
  })
})

describe('toggleStar', () => {
  it('keeps a star across a reload, and takes it back on a second toggle', async () => {
    const one = boardAt('https://one.example')
    let stars = await load()
    stars.toggleStar(one, 'incidents')
    stars = await load()
    expect(stars.starsOf(one)).toEqual(['incidents'])
    stars.toggleStar(one, 'incidents')
    stars = await load()
    expect(stars.starsOf(one)).toEqual([])
  })

  it('keeps each board’s stars apart', async () => {
    const stars = await load()
    stars.toggleStar(boardAt('https://one.example'), 'incidents')
    stars.toggleStar(boardAt('https://two.example'), 'general')
    const reloaded = await load()
    expect(reloaded.starsOf(boardAt('https://one.example'))).toEqual(['incidents'])
    expect(reloaded.starsOf(boardAt('https://two.example'))).toEqual(['general'])
  })
})
