import { describe, expect, it } from 'vitest'
import type { MessageView, TaskView } from '../src/api/routes.ts'
import * as store from '../src/inspect/app/store.ts'
import { BUBBLE_MS, GONE_MS, IDLE_MS, PORCH, TABLES, townOf } from '../src/inspect/app/town.ts'

const ME = 'vercel:user:u_julian'
const ADA = 'vercel:user:u_ada'
const FX = 'vercel:user:u_ada+fx'
const NOW = Date.parse('2026-10-01T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

function message(id: number, by: string, channel: string, overrides: Partial<MessageView> = {}): MessageView {
  const principal = by.split('+')[0]!
  return {
    id: String(id),
    version: id,
    revision: id,
    channel,
    text: `message ${id}`,
    re: null,
    replyTo: null,
    thread: `t${id}`,
    labels: {},
    reactions: {},
    by: { actor: by, principal, profile: by.includes('+') ? by.split('+')[1]! : null },
    noSync: false,
    origin: null,
    from: null,
    blocks: [],
    createdAt: ago(10 * 60_000),
    editedAt: null,
    deleted: false,
    undelivered: {},
    attachments: [],
    links: [],
    author: null,
    ...overrides,
  } as MessageView
}

const task = (overrides: Partial<TaskView>): TaskView => ({ state: 'ready', owner: ADA, by: ADA, for: null, needs: [], epoch: 0, claim: null, blocked: null, result: null, reason: null, ...overrides }) as TaskView

function stateOf(channels: string[], messages: MessageView[]): store.State {
  return {
    ...store.initialState,
    me: { actor: ME } as store.State['me'],
    channels: Object.fromEntries(channels.map((path) => [path, { path }])),
    messages: Object.fromEntries(messages.map((m) => [m.id, m])),
  }
}

const where = (town: ReturnType<typeof townOf>, actor: string) => town.residents.find((r) => r.actor === actor)

describe('boardville', () => {
  it('puts each channel in a house on its street: the main street first, then each path prefix, wrapping at the columns', () => {
    const town = townOf(stateOf(['www/production', 'dev', 'www/errors', 'deploys', 'www/preview'], []), NOW, 2)
    expect(town.streets.map((s) => [s.name, s.rows])).toEqual([
      ['main street', 1],
      ['www', 2],
    ])
    const house = (channel: string) => town.houses.find((h) => h.channel === channel)!
    expect(house('deploys').y).toBe(house('dev').y)
    expect(house('www/errors').y).toBeGreaterThan(house('dev').y)
    // A third house on a street of two columns goes on the street's next row, under the first.
    expect(house('www/production').x).toBe(house('www/errors').x)
    expect(house('www/production').y).toBeGreaterThan(house('www/errors').y)
    expect(house('www/errors').name).toBe('errors')
  })

  it('makes a house of a channel only the stream has shown', () => {
    const town = townOf(stateOf([], [message(1, ADA, 'incidents')]), NOW, 4)
    expect(town.houses.map((h) => h.channel)).toEqual(['incidents'])
  })

  it('stands everyone at the house of their newest message, and moves them when they post elsewhere', () => {
    const before = stateOf(['dev', 'prs'], [message(1, ADA, 'dev', { createdAt: ago(5 * 60_000) })])
    expect(where(townOf(before, NOW, 4), ADA)?.channel).toBe('dev')
    const after = store.merge(before, [message(2, ADA, 'prs', { createdAt: ago(60_000) })])
    expect(where(townOf(after, NOW, 4), ADA)?.channel).toBe('prs')
  })

  it('tells agents from people', () => {
    const town = townOf(stateOf(['dev'], [message(1, ADA, 'dev'), message(2, FX, 'dev')]), NOW, 4)
    expect(where(town, FX)?.agent).toBe(true)
    expect(where(town, ADA)?.agent).toBe(false)
  })

  it('keeps an agent at work in the house of the task it holds a live claim on', () => {
    const claimed = message(1, ADA, 'work', { task: task({ state: 'claimed', epoch: 1, claim: { actor: FX, until: new Date(NOW + 10 * 60_000).toISOString() } }) } as Partial<MessageView>)
    const town = townOf(stateOf(['work', 'dev'], [claimed, message(2, FX, 'dev', { createdAt: ago(60_000) })]), NOW, 4)
    expect(where(town, FX)).toMatchObject({ channel: 'work', working: true })
    expect(town.houses.find((h) => h.channel === 'work')?.tasks).toBe(1)
    // Once the lease runs out, the agent is back where it last posted.
    const lapsed = townOf(stateOf(['work', 'dev'], [claimed, message(2, FX, 'dev', { createdAt: ago(60_000) })]), NOW + 20 * 60_000, 4)
    expect(where(lapsed, FX)).toMatchObject({ channel: 'dev', working: false })
  })

  it('shows a message over its author while it is fresh, and one bubble to a house, the newest speaker’s', () => {
    const state = stateOf(['dev'], [
      message(1, ADA, 'dev', { text: 'first', createdAt: ago(60_000) }),
      message(2, FX, 'dev', { text: 'over to @[vercel:user:u_ada]', createdAt: ago(30_000) }),
    ])
    const town = townOf(state, NOW, 4)
    expect(where(town, FX)?.bubble).toMatchObject({ id: '2', thread: '2' })
    expect(where(town, ADA)?.bubble).toBeNull()
    expect(where(townOf(state, NOW + BUBBLE_MS, 4), FX)?.bubble).toBeNull()
  })

  it('opens the thread a reply bubble belongs to', () => {
    const town = townOf(stateOf(['dev'], [message(1, ADA, 'dev'), message(2, FX, 'dev', { re: '1', createdAt: ago(10_000) })]), NOW, 4)
    expect(where(town, FX)?.bubble?.thread).toBe('1')
  })

  it('dozes off whoever has been quiet an hour, and sends home whoever has been quiet a day', () => {
    const state = stateOf(['dev'], [message(1, ADA, 'dev', { createdAt: ago(0) })])
    expect(where(townOf(state, NOW + IDLE_MS - 1, 4), ADA)?.idle).toBe(false)
    expect(where(townOf(state, NOW + IDLE_MS + 1, 4), ADA)?.idle).toBe(true)
    expect(where(townOf(state, NOW + GONE_MS + 1, 4), ADA)).toBeUndefined()
  })

  it('stands you at the house you opened', () => {
    const state = stateOf(['dev', 'prs'], [message(1, ME, 'dev')])
    expect(where(townOf(state, NOW, 4), ME)?.channel).toBe('dev')
    expect(where(townOf(state, NOW, 4, { here: 'prs' }), ME)).toMatchObject({ channel: 'prs', you: true })
  })

  it('counts a crowd its porch has no room for, the most recent on it', () => {
    const crowd = Array.from({ length: PORCH + 2 }, (_, i) => message(i + 1, `vercel:user:u_${i}`, 'dev', { createdAt: ago((PORCH + 2 - i) * 1000) }))
    const town = townOf(stateOf(['dev'], crowd), NOW, 4)
    expect(town.houses[0]!.people).toBe(PORCH + 2)
    const offPorch = town.residents.filter((r) => r.outside === null).map((r) => r.actor)
    // The two who spoke first are the ones left off it.
    expect(offPorch.sort()).toEqual(['vercel:user:u_0', 'vercel:user:u_1'])
  })

  it('makes a house’s threads with the latest activity its tables, each saying its root’s first line', () => {
    const threads = Array.from({ length: TABLES + 1 }, (_, i) => message(i + 1, ADA, 'dev', { text: `thread ${i + 1}\nmore`, createdAt: ago((TABLES + 1 - i) * 60_000) }))
    // A reply moves the oldest thread up to the newest.
    const reply = message(99, FX, 'dev', { re: '1', createdAt: ago(1000) })
    const house = townOf(stateOf(['dev'], [...threads, reply]), NOW, 4).houses[0]!
    expect(house.tables.map((t) => t.thread)).toEqual(['1', '5', '4', '3'])
    expect(house.tables[0]!.label).toBe('thread 1')
  })

  it('seats each resident at the table of the thread they were last in, and the rest inside the door', () => {
    const state = stateOf(['dev'], [message(1, ADA, 'dev', { createdAt: ago(60_000) }), message(2, FX, 'dev', { re: '1', createdAt: ago(30_000) })])
    const town = townOf(state, NOW, 4, { here: 'dev' })
    const table = town.houses[0]!.tables[0]!
    for (const actor of [ADA, FX]) {
      const seat = where(town, actor)!.inside
      expect(Math.abs(seat.x - table.x)).toBeLessThan(120)
      expect(Math.abs(seat.y - table.y)).toBeLessThan(50)
    }
    // Two at one table don't sit in one seat.
    expect(where(town, ADA)!.inside).not.toEqual(where(town, FX)!.inside)
    // You came in by the door: at no table.
    expect(where(town, ME)).toMatchObject({ thread: null })
    expect(where(town, ME)!.inside.y).toBeGreaterThan(table.y + 50)
  })

  it('sits an agent at work at its task’s table, and shows the task’s state on it', () => {
    const claimed = message(1, ADA, 'work', { task: task({ state: 'claimed', epoch: 1, claim: { actor: FX, until: new Date(NOW + 10 * 60_000).toISOString() } }) } as Partial<MessageView>)
    const town = townOf(stateOf(['work'], [claimed, message(2, ADA, 'work', { createdAt: ago(1000) })]), NOW, 4)
    expect(where(town, FX)?.thread).toBe('1')
    expect(town.houses[0]!.tables.find((t) => t.thread === '1')?.task).toBe('claimed')
  })
})
