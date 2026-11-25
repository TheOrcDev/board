import { Bot, Hammer, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Vector3 } from 'three'
import { here as hereWith, navigate, useNow } from './nav.tsx'
import { isTask, stateNow, type State } from './store.ts'
import { LAYERS, World, type Label, type Picked } from './scene.ts'
import { boardOf, firstLine, fitted, PLATE, townOf, type House, type Resident, type Seen } from './town.ts'
import { Header } from './ui.tsx'
import { ago } from './words.ts'

/**
 * Boardville: the board as a village in three dimensions. Each channel is a house on its street, and
 * everyone waits on the porch of the house they were last active in. Walk into a house and the camera
 * comes down to it, its roof lifts off, its busiest threads are tables, and everyone sits at the one
 * they were last in. Only the house you're in opens, so the page reads one channel in full, and the
 * rest from the feed.
 */
export function Town(props: { state: State; lead: ReactNode; house: string | null; thread: string | null; children?: ReactNode }) {
  const { state, house, thread } = props
  const now = useNow(5_000)
  const host = useRef<HTMLDivElement>(null)
  const world = useRef<World | null>(null)
  const labels = useRef(new Map<string, Label>())
  const enter = (channel: string | null) => navigate(hereWith({ thread: null, params: { house: channel === house ? null : channel } }))
  const pick = useRef<(picked: Picked) => void>(() => {})
  pick.current = (picked) => {
    if (!picked) return
    if ('thread' in picked) navigate(hereWith({ thread: picked.thread }))
    else if (picked.house !== house) enter(picked.house)
  }

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const made = new World(element, (picked) => pick.current(picked), labels.current)
    world.current = made
    const dark = matchMedia('(prefers-color-scheme: dark)')
    const repaint = () => made.repaint()
    dark.addEventListener('change', repaint)
    return () => {
      dark.removeEventListener('change', repaint)
      made.dispose()
      world.current = null
    }
  }, [])

  const seen = useSeenThreads(state, thread)
  const town = useMemo(() => townOf(state, now, { here: house, looking: thread, seen }), [state.messages, state.channels, state.actors, state.ops, state.me, now, house, thread, seen])
  const lit = useMemo(() => new Set(town.residents.filter((r) => !r.idle).map((r) => r.channel)), [town])
  useEffect(() => world.current?.show(town, house, lit), [town, house, lit])

  /** A label kept over a point of the scene, by its key. */
  const over = (key: string, anchor: () => Vector3 | null, rank?: number) => (element: HTMLElement | null) => {
    if (element) labels.current.set(key, { element, anchor, ...(rank === undefined ? {} : { rank }) })
    else labels.current.delete(key)
  }
  /**
   * Of two labels that would overlap, the one that shows: inside the house you're in, its whiteboard (10); then what
   * you haven't seen (9), each table's label (8), and who sits at it and what they say (7); then the signs and roofs
   * of the houses around it, the busiest first.
   */
  const rankOf = (h: House) => (h.channel === house ? 5 : h.who.length > 0 ? 3 : h.tasks > 0 ? 1 : 0)
  // What the newest speaker in a house said, for a house whose roof is on: it shows over the roof.
  const said = new Map(town.residents.filter((r) => r.bubble).map((r) => [r.channel, r]))
  const around = town.residents.filter((r) => !r.idle).length
  const open = town.houses.find((h) => h.channel === house)
  return (
    <>
      <Header title="boardville" meta={`${town.houses.length} house${town.houses.length === 1 ? '' : 's'} · ${around} around`} live={state.live} lead={props.lead}>
        {house && (
          <button className="tool" title={`leave #${house}`} onClick={() => enter(null)}>
            <X size={15} strokeWidth={1.75} />
          </button>
        )}
      </Header>
      <div className={`town${house ? ' inside' : ''}`} ref={host}>
        {town.houses.length === 0 && <p className="empty">{state.cursor === null ? 'loading…' : 'no houses yet: a channel is a house, so post in one'}</p>}
        <div className="town-labels">
          {/* Each district's name, at the corner of its first block. */}
          {town.streets.map((street) => (
            // On the road above the block, clear of its houses.
            <div key={`street:${street.name}`} className="over" ref={over(`street:${street.name}`, () => new Vector3(street.x + 90, 0, street.y - 12), 4)}>
              <span className="street-sign">{street.name}</span>
            </div>
          ))}
          {town.houses.map((h) => (
            <div key={`house:${h.channel}`} className="over" ref={over(`house:${h.channel}`, () => new Vector3(h.x + h.width / 2, 0, h.y + h.depth + PLATE - 8), rankOf(h))}>
              <button className={`plate${h.channel === house ? ' open' : ''}`} onClick={() => enter(h.channel)} title={h.channel === house ? `#${h.channel}` : `walk into #${h.channel}`}>
                <span className="name">#{h.name}</span>
                {h.tasks > 0 && <span className="count" title={`${h.tasks} open task${h.tasks === 1 ? '' : 's'}`}>{h.tasks}</span>}
              </button>
            </div>
          ))}
          {/* A house with threads you haven't seen, from across the city: a marker over its roof, and how many. */}
          {town.houses
            .filter((h) => h.channel !== house && h.unseen.threads > 0)
            .map((h) => (
              <div key={`quest:${h.channel}`} className="over" ref={over(`quest:${h.channel}`, () => new Vector3(h.x + h.width / 2, 340, h.y + h.depth / 2), 9)}>
                <div className="stack">
                <button className={`quest${h.unseen.mentioned ? ' mention' : ''}`} onClick={() => enter(h.channel)} title={`${h.unseen.threads} thread${h.unseen.threads === 1 ? '' : 's'} you haven't seen in #${h.channel}${h.unseen.mentioned ? ', one mentioning you' : ''}`}>
                  <b>{h.unseen.mentioned ? '@' : '!'}</b>
                  {h.unseen.threads > 1 && <span>{h.unseen.threads}</span>}
                </button>
                </div>
              </div>
            ))}
          {/* Inside, over each table whose thread you haven't seen. */}
          {open && <Whiteboard house={open} state={state} now={now} attach={over(`board:${open.channel}`, () => {
            const board = boardOf(open)
            return new Vector3(open.x + open.width / 2, LAYERS.floor + board.bottom + board.height / 2, open.y + board.z + 3)
          // Over every sign and pill of the houses behind it: it's the room's own.
          }, 10)} />}
          {/* At an empty table on its own, just over it; at one with people, in their pill. */}
          {open?.tables
            .filter((table) => table.unseen !== null && table.seated === 0)
            .map((table) => (
              <div key={`quest:${table.thread}`} className="over" ref={over(`quest:${table.thread}`, () => new Vector3(table.x + 70, 60, table.y + 17), 9)}>
                <div className="stack">
                <button className={`quest${table.unseen === 'mention' ? ' mention' : ''}`} onClick={() => navigate(hereWith({ thread: table.thread }))} title={table.unseen === 'mention' ? 'you were mentioned here since you last looked' : "new since you last looked"}>
                  <b>{table.unseen === 'mention' ? '@' : '!'}</b>
                </button>
                </div>
              </div>
            ))}
          {/* Who's in a house with its roof on, over its roof, as a room's names show over it. */}
          {town.houses
            .filter((h) => h.channel !== house && h.who.length > 0)
            .map((h) => (
              <div key={`roof:${h.channel}`} className="over" ref={over(`roof:${h.channel}`, () => new Vector3(h.x + h.width / 2, 150, h.y + h.depth / 2), 4)}>
                <div className="stack">
                  {said.get(h.channel) && (
                    <button className="bubble" onClick={() => navigate(hereWith({ thread: said.get(h.channel)!.bubble!.thread }))} title="open the thread">
                      <span className="who">{said.get(h.channel)!.name}</span>
                      <span className="text">{said.get(h.channel)!.bubble!.text}</span>
                    </button>
                  )}
                  <button className="roof-pill" onClick={() => enter(h.channel)} title={`${h.who.map((w) => w.name).join(', ')} in #${h.channel}`}>
                    <i className={h.who.some((w) => !w.idle) ? 'on' : ''} />
                    <Faces urls={h.who.map((w) => w.avatar)} />
                    {fitted(h.who.map((w) => w.name), 26)}
                  </button>
                </div>
              </div>
            ))}
          {open?.tables.map((table) => (
            // What the thread is, on its tabletop: placed before who sits there and what they say, which move up out of its way.
            <div key={`table:${table.thread}`} className="over centered table-label" data-span="140" ref={over(`table:${table.thread}`, () => new Vector3(table.x + 70, 26, table.y + 17), 8)}>
              <button onClick={() => navigate(hereWith({ thread: table.thread }))} title="open the thread">
                <span className="label">{table.label || 'a thread'}</span>
                {table.task && <span className={`state ${table.task}`}>{table.task}</span>}
              </button>
            </div>
          ))}
          {open?.tables.map((table) => {
            const seated = town.residents.filter((r) => r.channel === house && r.seated && r.thread === table.thread)
            if (seated.length === 0) return null
            const speaker = seated.find((r) => r.bubble)
            return (
              // Who sits at a table, in one pill over their heads, as a room's names show over it.
              <div key={`seats:${table.thread}`} className="over" data-span="160" ref={over(`seats:${table.thread}`, () => new Vector3(table.x + 70, 86, table.y - 24), 7)}>
                <div className="stack">
                  {speaker && (
                    <button className="bubble" onClick={() => navigate(hereWith({ thread: speaker.bubble!.thread }))} title="open the thread">
                      {seated.length > 1 && <span className="who">{speaker.you ? 'you' : speaker.name}</span>}
                      <span className="text">{speaker.bubble!.text}</span>
                    </button>
                  )}
                  <span className="roof-pill" title={seated.map((r) => r.name).join(', ')}>
                    {table.unseen && (
                      <b className={`quest inline${table.unseen === 'mention' ? ' mention' : ''}`} title={table.unseen === 'mention' ? 'you were mentioned here since you last looked' : 'new since you last looked'}>
                        {table.unseen === 'mention' ? '@' : '!'}
                      </b>
                    )}
                    <i className={seated.some((r) => !r.idle) ? 'on' : ''} />
                    <Faces urls={seated.map((r) => r.avatar)} />
                    {!seated.some((r) => r.avatar) && seated.some((r) => r.agent) && <Bot size={11} strokeWidth={2} />}
                    {fitted(seated.map((r) => (r.you ? 'you' : r.name)))}
                    {seated.some((r) => r.working) && <Hammer size={11} strokeWidth={2} />}
                  </span>
                </div>
              </div>
            )
          })}
          {town.residents.map((r) => (
            // Everyone on their feet, standing or walking, has a pill of their own; who's seated is in their table's.
            <PersonLabel key={`person:${r.actor}`} resident={r} attach={over(`person:${r.actor}`, () => (world.current?.settled(r.actor) && r.channel === house ? null : (world.current?.personAt(r.actor) ?? null)), r.you ? 7 : 3)} />
          ))}
        </div>
      </div>
      {house && <section className="town-inside">{props.children}</section>}
    </>
  )
}

/**
 * What a room's whiteboard says of its channel: its tasks by where they stand, and its latest threads,
 * each a line that opens it. From what the page has loaded: the board keeps no summary of its own.
 */
function Whiteboard({ house, state, now, attach }: { house: House; state: State; now: number; attach: (element: HTMLElement | null) => void }) {
  const messages = Object.values(state.messages).filter((m) => m.channel === house.channel && !m.deleted)
  const tally = { ready: 0, claimed: 0, waiting: 0, done: 0 }
  for (const m of messages) {
    if (!isTask(m)) continue
    const standing = stateNow(m.task, now)
    if (standing === 'ready') tally.ready++
    else if (standing === 'claimed') tally.claimed++
    else if (standing === 'waiting' || standing === 'blocked') tally.waiting++
    else if (standing === 'completed') tally.done++
  }
  const latest = new Map<string, string>()
  for (const m of messages) {
    const thread = m.re ?? m.id
    if ((latest.get(thread) ?? '') < m.createdAt) latest.set(thread, m.createdAt)
  }
  const threads = [...latest].sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 3)
  const tasks = tally.ready + tally.claimed + tally.waiting + tally.done
  return (
    <div className="over centered" data-fixed data-span={boardOf(house).width - 14} ref={attach}>
      <div className="whiteboard">
        <h3>#{house.name}</h3>
        {tasks > 0 && (
          <div className="tally">
            {tally.ready > 0 && <span>{tally.ready} ready</span>}
            {tally.claimed > 0 && <span>{tally.claimed} in progress</span>}
            {tally.waiting > 0 && <span><b>{tally.waiting} blocked</b></span>}
            {tally.done > 0 && <span>{tally.done} done</span>}
          </div>
        )}
        {threads.map(([thread, at]) => (
          <button key={thread} onClick={() => navigate(hereWith({ thread }))} title="open the thread">
            · {firstLine(state.messages[thread]?.text ?? '', state) || 'a thread'} <span className="ago">{ago(at, now)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * When you last saw each thread, kept in this browser, as the sidebar keeps its unread dots: what's open is
 * seen, up to its newest message, as it comes in. The first visit sees everything there is, so the city doesn't
 * open covered in markers; after that, a marker means news.
 */
function useSeenThreads(state: State, open: string | null): Seen {
  const key = `board.town.seen:${state.discovery?.url ?? location.host}`
  const [seen, setSeen] = useState<Seen | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null')
    } catch {
      return null
    }
  })
  const save = (next: Seen) => {
    setSeen(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {}
  }
  const newest = (thread: string) =>
    Object.values(state.messages).reduce((at, m) => ((m.re ?? m.id) === thread && m.createdAt > at ? m.createdAt : at), '')
  useEffect(() => {
    // Once the feed has said where it is, or refused to: without a feed, what's loaded is all there is to see.
    if (seen !== null || (state.cursor === null && state.activityRefused === null)) return
    const first: Seen = {}
    for (const m of Object.values(state.messages)) {
      const thread = m.re ?? m.id
      if (!first[thread] || m.createdAt > first[thread]!) first[thread] = m.createdAt
    }
    save(first)
  }, [state.cursor, state.activityRefused, seen === null])
  useEffect(() => {
    if (!open || seen === null) return
    const at = newest(open)
    if (at && (!Object.hasOwn(seen, open) || seen[open]! < at)) save({ ...seen, [open]: at })
  }, [open, state.messages, seen])
  return seen ?? {}
}

/** Up to three people's pictures, overlapping a little, as a pill's faces; none for who has no picture. */
function Faces({ urls }: { urls: (string | null)[] }) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const shown = urls.filter((url): url is string => !!url && !broken.has(url)).slice(0, 3)
  if (shown.length === 0) return null
  return (
    <span className="faces">
      {shown.map((url) => (
        <img key={url} src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken((known) => new Set(known).add(url))} />
      ))}
    </span>
  )
}

/** Someone in sight: their name in a pill over their head, with what they just said over it. */
function PersonLabel({ resident: r, attach }: { resident: Resident; attach: (element: HTMLElement | null) => void }) {
  return (
    <div className={`over person-label${r.idle ? ' idle' : ''}${r.you ? ' you' : ''}`} ref={attach}>
      <div className="stack">
        {r.bubble && (
          <button className="bubble" onClick={() => navigate(hereWith({ thread: r.bubble!.thread }))} title="open the thread">
            <span className="text">{r.bubble.text}</span>
          </button>
        )}
        <span className="tag" title={r.working ? 'working on a task here' : r.idle ? 'away' : undefined}>
          <i className={r.idle ? '' : 'on'} />
          <Faces urls={[r.avatar]} />
          {!r.avatar && r.agent && <Bot size={11} strokeWidth={2} />}
          {r.you ? 'you' : r.name}
          {r.working && <Hammer size={11} strokeWidth={2} />}
        </span>
      </div>
    </div>
  )
}
