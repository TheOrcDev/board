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

/** A house's walls, and the room in front of them for its sign. */
export const WALL = 10
const FRONT = 70
/** One table's share of a floor: the table, its chairs, and room to walk between. */
export const CELL = { width: 170, depth: 132 }
/** Room between two houses on a street, and between a row of houses and the street in front of it. */
const GAP = { x: 70, y: 96 }
/** Where a house's sign hangs, under its front wall. */
export const PLATE = 44
/** A street's sign, on the left of its first row. */
export const SIGN = 132
/** A standard house's lot, which `columns` counts in. */
export const LOT = { width: 2 * WALL + 2 * CELL.width + GAP.x, height: 2 * WALL + 2 * CELL.depth + FRONT + GAP.y }
/** Seats at a table: three on each side. */
export const SEATS = 6

const AVATAR = 30
const STEP = 40
const TABLE = { width: 140, height: 34 }
/** A seated figure, with its name over it. */
const FIGURE = 46

/**
 * How big a house is for the threads it has: a cottage for a channel nothing has happened in, up to a
 * hall of sixteen tables. It grows in steps, so a new thread seldom moves its street.
 */
export function sizeOf(threads: number): { columns: number; rows: number; width: number; depth: number } {
  const [columns, rows] = threads === 0 ? [1, 1] : threads <= 2 ? [2, 1] : threads <= 4 ? [2, 2] : threads <= 6 ? [3, 2] : threads <= 9 ? [3, 3] : threads <= 12 ? [4, 3] : [4, 4]
  return { columns, rows, width: 2 * WALL + columns * CELL.width, depth: 2 * WALL + rows * CELL.depth + FRONT }
}

export type Table = {
  /** The thread's root, by ID. */
  thread: string
  /** Its root's first line, or nothing while its root isn't loaded. */
  label: string
  x: number
  y: number
  /** A task's state, for a thread that's a task. */
  task: TaskView['state'] | null
  /** How many sit at it. */
  seated: number
  /** Its chairs: three on its far side, then three on its near side. */
  chairs: Spot[]
}

export type House = {
  channel: string
  /** The last part of its path: what the house's sign says. */
  name: string
  x: number
  y: number
  width: number
  depth: number
  /** How many threads it has, as far as the page knows: what its size is for. */
  threads: number
  /** Whether someone said something in it within the last couple of minutes: its chimney smokes. */
  busy: boolean
  /** Its open tasks, as the loaded messages have them. */
  tasks: number
  /** As many of its threads as it has room for: those with someone at them first, then the latest. */
  tables: Table[]
  /** Who's in it, the most recent first: what its roof says while it's on. */
  who: { name: string; agent: boolean; idle: boolean }[]
}

export type Street = { name: string; y: number; depth: number }

export type Spot = { x: number; y: number }

export type Resident = {
  actor: string
  name: string
  avatar: string | null
  /** An agent: an actor with a profile, `claude via ada`. */
  agent: boolean
  /** The house they're in, and the thread there they were last in. */
  channel: string
  thread: string | null
  /** The house's door: where they go in and come out, walking from one house to another. */
  door: Spot
  /** Where they are inside: at their thread's table, or inside the door. */
  inside: Spot
  /** Sitting at a table, or standing. */
  seated: boolean
  /** Which way they face, in radians around the vertical: a seat faces its table, and standing faces the street. */
  facing: number
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
 * The village for `state` at `now`, a row about `columns` standard houses wide. Streets go by name,
 * the main street first, and a street wraps onto rows of its own. Each row's houses stand with their
 * fronts on one line, facing its street. `here` is the house you've walked into, where you stand.
 */
export function townOf(state: State, now: number, columns: number, options: { here?: string | null } = {}): Town {
  const rowWidth = Math.max(1, Math.floor(columns)) * LOT.width
  const channels = Object.keys(state.channels)
  // A channel the stream showed before the list did is a house all the same.
  for (const message of Object.values(state.messages)) if (!channels.includes(message.channel)) channels.push(message.channel)
  const byStreet = new Map<string, string[]>()
  for (const path of channels.sort()) byStreet.set(streetOf(path), [...(byStreet.get(streetOf(path)) ?? []), path])
  const names = [...byStreet.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))

  const messages = Object.values(state.messages).filter((message) => !message.deleted)
  const threads = threadsBy(state, messages, now)
  const open = new Map<string, number>()
  for (const message of messages)
    if (isTask(message) && ['ready', 'claimed', 'waiting', 'blocked'].includes(stateNow(message.task, now))) open.set(message.channel, (open.get(message.channel) ?? 0) + 1)
  const me = state.me?.actor
  // Most recent first, so a full table, or a roof's list, shows who's there now.
  const placed = [...whereabouts(state, messages, now, options.here ?? null)].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const occupied = new Map<string, number>()
  for (const one of placed) if (one.thread !== null) occupied.set(one.thread, (occupied.get(one.thread) ?? 0) + 1)

  const streets: Street[] = []
  const houses: House[] = []
  let y = 0
  for (const name of names) {
    const top = y
    // A row at a time: as many houses as fit, standing on the row's front line.
    let row: House[] = []
    let x = SIGN
    const close = () => {
      const deepest = Math.max(...row.map((h) => h.depth))
      for (const house of row) house.y = y + deepest - house.depth
      houses.push(...row)
      y += deepest + PLATE + GAP.y
      row = []
      x = SIGN
    }
    for (const channel of byStreet.get(name)!) {
      // Sized by its threads the page knows: a board's own count of a channel's threads includes messages no one
      // answered, which get no table.
      const known = threads.get(channel) ?? []
      const count = known.length
      const size = sizeOf(count)
      if (row.length > 0 && x + size.width > SIGN + rowWidth) close()
      // Threads with someone at them get a table first, then the latest.
      const ranked = [...known].sort((a, b) => (occupied.get(b.thread) ?? 0) - (occupied.get(a.thread) ?? 0) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      row.push({
        channel,
        name: channel.slice(channel.lastIndexOf('/') + 1),
        x,
        y: 0,
        width: size.width,
        depth: size.depth,
        threads: count,
        busy: messages.some((m) => m.channel === channel && now - Date.parse(m.createdAt) < BUBBLE_MS),
        tasks: open.get(channel) ?? 0,
        tables: ranked.slice(0, size.columns * size.rows).map((t) => ({ thread: t.thread, label: t.label, task: t.task, x: 0, y: 0, seated: 0, chairs: [] })),
        who: [],
      })
      x += size.width + GAP.x
    }
    if (row.length > 0) close()
    streets.push({ name: name === '' ? 'main street' : name, y: top, depth: y - top })
  }
  // Each table's place, now its house's is known: in the house's grid, the latest first.
  for (const house of houses) {
    const { columns } = sizeOf(house.threads)
    house.tables.forEach((table, n) => {
      Object.assign(table, tableAt(house, columns, n))
      table.chairs = Array.from({ length: SEATS }, (_, seat) => seatAt(table, seat))
    })
  }

  const houseOf = new Map(houses.map((house) => [house.channel, house]))
  const lobby = new Map<string, number>()
  const residents: Resident[] = []
  const spoke = new Set<string>()
  for (const one of placed) {
    const house = houseOf.get(one.channel)
    if (!house) continue
    const actor = state.actors[one.actor]
    const name = actor ? actor.name : nameOf(state, one.actor)
    const idle = now - Date.parse(one.at) > IDLE_MS
    house.who.push({ name: one.actor === me ? 'you' : name, agent: one.actor.includes('+'), idle })
    const table = one.thread === null ? undefined : house.tables.find((t) => t.thread === one.thread)
    let inside: Spot
    let sitting = false
    let facing = 0
    if (table && table.seated < SEATS) {
      // The far side's chairs fill first: they face the street, so you see faces, not backs.
      const seat = table.seated
      table.seated++
      inside = table.chairs[seat]!
      sitting = true
      facing = seat < 3 ? 0 : Math.PI
    } else {
      // No table for their thread, or no seat left at it: they stand inside the door.
      const n = lobby.get(one.channel) ?? 0
      lobby.set(one.channel, n + 1)
      inside = { x: house.x + house.width / 2 - AVATAR / 2 + (n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * STEP, y: house.y + house.depth - WALL - 50 }
    }
    // One bubble to a house, the newest speaker's, so a crowd's don't pile up.
    const bubble = one.bubble && !spoke.has(one.channel) ? one.bubble : null
    if (bubble) spoke.add(one.channel)
    residents.push({
      ...one,
      bubble,
      name,
      avatar: actor?.avatar ?? null,
      agent: one.actor.includes('+'),
      door: { x: house.x + house.width / 2 - AVATAR / 2, y: house.y + house.depth + 6 },
      inside,
      seated: sitting,
      facing,
      idle,
      you: one.actor === me,
    })
  }
  // Drawn in a steady order, so no one jumps in front of another when they move.
  residents.sort((a, b) => a.actor.localeCompare(b.actor))
  const width = Math.max(SIGN + rowWidth, ...houses.map((h) => h.x + h.width))
  return { streets, houses, residents, width, height: Math.max(y, LOT.height) }
}

/** Where a house's `n`th table stands, in its grid of `columns`, a cell to each. */
function tableAt(house: House, columns: number, n: number): Spot {
  return {
    x: house.x + WALL + (n % columns) * CELL.width + (CELL.width - TABLE.width) / 2,
    // Its far side's chairs between it and the wall, or the row of tables behind it.
    y: house.y + WALL + Math.floor(n / columns) * CELL.depth + FIGURE + 4,
  }
}

/** A table's `seat`th seat: three along its far side, then three along its near side. */
function seatAt(table: Table, seat: number): Spot {
  const along = seat % 3
  return {
    x: table.x + (TABLE.width - 3 * STEP) / 2 + along * STEP + (STEP - AVATAR) / 2,
    y: seat < 3 ? table.y - FIGURE + 6 : table.y + TABLE.height + 2,
  }
}

type Busiest = { thread: string; at: string; label: string; task: TaskView['state'] | null }

/**
 * Each channel's threads, the latest active first: when each last heard anything, and what its root says. A
 * thread is a root with replies, or a task: a message no one has answered is only a message, and gets no table.
 */
function threadsBy(state: State, messages: MessageView[], now: number): Map<string, Busiest[]> {
  const latest = new Map<string, Busiest & { channel: string }>()
  const answered = new Set<string>()
  for (const message of messages) {
    const thread = message.re ?? message.id
    if (message.re !== null) answered.add(message.re)
    const known = latest.get(thread)
    if (!known || message.createdAt > known.at) latest.set(thread, { thread, channel: message.channel, at: message.createdAt, label: '', task: null })
  }
  // A channel's listing knows replies the page hasn't loaded.
  for (const [channel, listing] of Object.entries(state.listings))
    for (const [root, row] of Object.entries(listing?.rows ?? {})) if (row.replies > 0 && latest.get(root)?.channel === channel) answered.add(root)
  const out = new Map<string, Busiest[]>()
  for (const t of latest.values()) {
    const root = state.messages[t.thread]
    const view = root && !root.deleted ? shown(state, t.thread) : undefined
    if (!answered.has(t.thread) && !view?.task) continue
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
