import type { MessageView, TaskView } from '../../api/routes.ts'
import { isTask, nameOf, shown, stateNow, type State } from './store.ts'

// Boardville: the board as a village, seen from above. A channel is a house, the
// channels under one path prefix are a street, and a house's busiest threads are
// its tables. Everyone the board has heard from sits at the table of the thread
// they were last active in. A house keeps its roof on until you walk in: then the
// view lifts it, and what's inside shows. Pure, like the store: the view draws
// what this answers.

/** How long a message shows as a speech bubble over its author. */
export const BUBBLE_MS = 2 * 60_000
/** How long since someone was last active before they doze off where they are. */
export const IDLE_MS = 60 * 60_000
/** How long since someone was last active before they've gone home: off the map. */
export const GONE_MS = 24 * 60 * 60_000

/** A house, seen from above: its walls, and the floor inside them. */
export const HOUSE = { width: 340, height: 340, wall: 10 }
/** A house's lot: the house, its porch under it, and the sign under that. */
export const LOT = { width: 384, height: HOUSE.height + 104, porch: HOUSE.height + 10, plate: HOUSE.height + 56 }
/** A street's sign, on the left of its first row. */
export const SIGN = 132
/** The tables a house has room for: its threads with the latest activity. */
export const TABLES = 4
/** Seats at a table: three on each side. */
export const SEATS = 6
/** Who a porch shows, the most recent first; the rest are counted. */
export const PORCH = 8

const AVATAR = 30
const STEP = 38
const TABLE = { width: 140, height: 34 }
/** An avatar with its name under it. */
const FIGURE = AVATAR + 14

export type Table = {
  /** The thread's root, by ID. */
  thread: string
  /** Its root's first line, or nothing while its root isn't loaded. */
  label: string
  x: number
  y: number
  /** A task's state, for a thread that's a task. */
  task: TaskView['state'] | null
}

export type House = {
  channel: string
  /** The last part of its path: what the house's sign says. */
  name: string
  x: number
  y: number
  /** Whether someone said something in it within the last couple of minutes: its chimney smokes. */
  busy: boolean
  /** Its open tasks, as the loaded messages have them. */
  tasks: number
  tables: Table[]
  /** Everyone at it, the porch's overflow included. */
  people: number
}

export type Street = { name: string; y: number; rows: number }

export type Spot = { x: number; y: number }

export type Resident = {
  actor: string
  name: string
  avatar: string | null
  /** An agent: an actor with a profile, `claude via ada`. */
  agent: boolean
  /** The house they're at, and the thread there they were last in. */
  channel: string
  thread: string | null
  /** Where they stand while the house's roof is on: on its porch, or null when the porch is full. */
  outside: Spot | null
  /** Where they are once it's off: at their thread's table, or inside the door. */
  inside: Spot
  /** When they were last active. */
  at: string
  idle: boolean
  /** Holding a claim on a task in this house: at work. */
  working: boolean
  /** Their latest message while it's fresh, to show over their head. */
  bubble: { id: string; thread: string; text: string } | null
  you: boolean
}

export type Town = { streets: Street[]; houses: House[]; residents: Resident[]; width: number; height: number }

/** The street a channel is on: what's before its last `/`, or the main street. */
export const streetOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/**
 * The village for `state` at `now`, `columns` houses to a row. Streets go by name, the main street
 * first; a street with more houses than a row holds wraps onto rows of its own. `here` is the house
 * you've walked into, where you stand.
 */
export function townOf(state: State, now: number, columns: number, options: { here?: string | null } = {}): Town {
  const cols = Math.max(1, Math.floor(columns))
  const channels = Object.keys(state.channels)
  // A channel the stream showed before the list did is a house all the same.
  for (const message of Object.values(state.messages)) if (!channels.includes(message.channel)) channels.push(message.channel)
  const byStreet = new Map<string, string[]>()
  for (const path of channels.sort()) byStreet.set(streetOf(path), [...(byStreet.get(streetOf(path)) ?? []), path])
  const names = [...byStreet.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))

  const live = (message: MessageView) => !message.deleted
  const messages = Object.values(state.messages).filter(live)
  const threads = threadsBy(state, messages, now)
  const open = new Map<string, number>()
  for (const message of messages)
    if (isTask(message) && ['ready', 'claimed', 'waiting', 'blocked'].includes(stateNow(message.task, now))) open.set(message.channel, (open.get(message.channel) ?? 0) + 1)

  const streets: Street[] = []
  const houses: House[] = []
  let y = 0
  for (const name of names) {
    const paths = byStreet.get(name)!
    const rows = Math.ceil(paths.length / cols)
    streets.push({ name: name === '' ? 'main street' : name, y, rows })
    paths.forEach((channel, i) => {
      const hx = SIGN + (i % cols) * LOT.width
      const hy = y + Math.floor(i / cols) * LOT.height
      const latest = threads.get(channel) ?? []
      houses.push({
        channel,
        name: channel.slice(channel.lastIndexOf('/') + 1),
        x: hx,
        y: hy,
        busy: latest.some((t) => now - Date.parse(t.at) < BUBBLE_MS),
        tasks: open.get(channel) ?? 0,
        tables: latest.slice(0, TABLES).map((t, n) => ({ thread: t.thread, label: t.label, task: t.task, ...tableAt(hx, hy, n) })),
        people: 0,
      })
    })
    y += rows * LOT.height
  }

  const houseOf = new Map(houses.map((house) => [house.channel, house]))
  const porch = new Map<string, number>()
  const seated = new Map<string, number>()
  const lobby = new Map<string, number>()
  const residents: Resident[] = []
  const me = state.me?.actor
  // Most recent first, so a full porch or table shows who's there now.
  const placed = [...whereabouts(state, messages, now, options.here ?? null)].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const spoke = new Set<string>()
  for (const one of placed) {
    const house = houseOf.get(one.channel)
    if (!house) continue
    house.people++
    const onPorch = porch.get(one.channel) ?? 0
    porch.set(one.channel, onPorch + 1)
    const table = one.thread === null ? -1 : house.tables.findIndex((t) => t.thread === one.thread)
    let inside: Spot
    const seat = table === -1 ? SEATS : (seated.get(`${one.channel} ${table}`) ?? 0)
    if (table !== -1 && seat < SEATS) {
      seated.set(`${one.channel} ${table}`, seat + 1)
      inside = seatAt(house.tables[table]!, seat)
    } else {
      // No table for their thread, or no seat left at it: they stand inside the door.
      const n = lobby.get(one.channel) ?? 0
      lobby.set(one.channel, n + 1)
      inside = { x: house.x + HOUSE.width / 2 - AVATAR / 2 + ((n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * STEP), y: house.y + HOUSE.height - HOUSE.wall - 52 - Math.floor(n / 6) * STEP }
    }
    const actor = state.actors[one.actor]
    // One bubble to a house, the newest speaker's, so a crowd's don't pile up.
    const bubble = one.bubble && !spoke.has(one.channel) ? one.bubble : null
    if (bubble) spoke.add(one.channel)
    residents.push({
      ...one,
      bubble,
      name: actor ? actor.name : nameOf(state, one.actor),
      avatar: actor?.avatar ?? null,
      agent: one.actor.includes('+'),
      outside: onPorch < PORCH ? { x: house.x + 8 + onPorch * STEP, y: house.y + LOT.porch } : null,
      inside,
      idle: now - Date.parse(one.at) > IDLE_MS,
      you: one.actor === me,
    })
  }
  // Drawn in a steady order, so no one jumps in front of another when they move.
  residents.sort((a, b) => a.actor.localeCompare(b.actor))
  return { streets, houses, residents, width: SIGN + cols * LOT.width, height: Math.max(y, LOT.height) }
}

/** Where a house's `n`th table stands: two by two on its floor. */
function tableAt(hx: number, hy: number, n: number): Spot {
  const floor = { width: HOUSE.width - 2 * HOUSE.wall, height: HOUSE.height - 2 * HOUSE.wall - 70 }
  const cell = { width: floor.width / 2, height: floor.height / 2 }
  return {
    x: hx + HOUSE.wall + (n % 2) * cell.width + (cell.width - TABLE.width) / 2,
    // Its far side's seats between it and the wall, or the table above.
    y: hy + HOUSE.wall + Math.floor(n / 2) * cell.height + FIGURE + 4,
  }
}

/** A table's `seat`th seat: three along its far side, then three along its near side. */
function seatAt(table: Table, seat: number): Spot {
  const along = seat % 3
  return {
    x: table.x + (TABLE.width - 3 * STEP) / 2 + along * STEP + (STEP - AVATAR) / 2,
    y: seat < 3 ? table.y - FIGURE - 2 : table.y + TABLE.height + 4,
  }
}

type Busiest = { thread: string; at: string; label: string; task: TaskView['state'] | null }

/** Each channel's threads, the latest active first: when each last heard anything, and what its root says. */
function threadsBy(state: State, messages: MessageView[], now: number): Map<string, Busiest[]> {
  const latest = new Map<string, Busiest & { channel: string }>()
  for (const message of messages) {
    const thread = message.re ?? message.id
    const known = latest.get(thread)
    if (!known || message.createdAt > known.at) latest.set(thread, { thread, channel: message.channel, at: message.createdAt, label: '', task: null })
  }
  const out = new Map<string, Busiest[]>()
  for (const t of latest.values()) {
    const root = state.messages[t.thread]
    const view = root && !root.deleted ? shown(state, t.thread) : undefined
    const entry = { thread: t.thread, at: t.at, label: view ? firstLine(view.text, state) : '', task: view?.task ? stateNow(view.task, now) : null }
    out.set(t.channel, [...(out.get(t.channel) ?? []), entry])
  }
  for (const list of out.values()) list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return out
}

/** A message's first line, with mentions as names: what a bubble or a table says. */
export const firstLine = (text: string, state: State) =>
  (text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '').replace(/@\[([^\]]+)\]/g, (_, id: string) => `@${nameOf(state, id)}`)

type Whereabouts = Pick<Resident, 'actor' | 'channel' | 'thread' | 'at' | 'working' | 'bubble'>

/**
 * Where each actor is: at the thread of their newest message, or of a task they hold a live claim
 * on, which keeps an agent at work where its task is. You stand where you're looking (`here`), once
 * you've walked into a house.
 */
function* whereabouts(state: State, messages: MessageView[], now: number, here: string | null): Generator<Whereabouts> {
  const newest = new Map<string, MessageView>()
  const working = new Map<string, MessageView>()
  for (const message of messages) {
    const seen = newest.get(message.by.actor)
    if (!seen || newer(message, seen)) newest.set(message.by.actor, message)
    if (isTask(message) && message.task.claim && stateNow(message.task, now) === 'claimed') working.set(message.task.claim.actor, message)
  }
  const me = state.me?.actor
  const everyone = new Set([...newest.keys(), ...working.keys(), ...(me && here ? [me] : [])])
  for (const actor of everyone) {
    const said = newest.get(actor)
    const task = working.get(actor)
    const at = said?.createdAt ?? task?.createdAt ?? new Date(now).toISOString()
    if (actor !== me && !task && now - Date.parse(at) > GONE_MS) continue
    const mine = actor === me && here !== null
    const channel = mine ? here : (task?.channel ?? said?.channel)
    if (!channel) continue
    // You come in by the door; an agent at work sits at its task's table; anyone else at their newest thread's.
    const thread = mine ? null : task ? task.id : (said!.re ?? said!.id)
    // What they said shows over them only where they said it.
    const fresh = said && said.channel === channel && now - Date.parse(said.createdAt) < BUBBLE_MS ? shown(state, said.id) : undefined
    const bubble = fresh && fresh.text.trim() ? { id: fresh.id, thread: fresh.re ?? fresh.id, text: firstLine(fresh.text, state) } : null
    yield { actor, channel, thread, at: mine ? new Date(now).toISOString() : at, working: !!task && task.channel === channel, bubble }
  }
}

const newer = (a: MessageView, b: MessageView) => a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id.localeCompare(b.id, undefined, { numeric: true }) > 0)

/** A house's roof color, the same for a channel every time: one of a few, by its name. */
export function roofOf(channel: string): number {
  let hash = 0
  for (const char of channel) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash) % ROOFS
}
export const ROOFS = 6
