import { Bot, Hammer, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Vector3 } from 'three'
import { here as hereWith, navigate, useNow } from './nav.tsx'
import { type State } from './store.ts'
import { World, type Label, type Picked } from './scene.ts'
import { LOT, PLATE, townOf, type House, type Resident } from './town.ts'
import { Header } from './ui.tsx'

/**
 * Boardville: the board as a village in three dimensions. Each channel is a house on its street, and
 * everyone waits on the porch of the house they were last active in. Walk into a house and the camera
 * comes down to it, its roof lifts off, its busiest threads are tables, and everyone sits at the one
 * they were last in. Only the house you're in opens, so the page reads one channel in full, and the
 * rest from the feed.
 */
export function Town(props: { state: State; lead: ReactNode; house: string | null; children?: ReactNode }) {
  const { state, house } = props
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

  const count = Object.keys(state.channels).length
  // Rows a set number of standard houses wide, for a village a little wider than deep. It's set by the
  // houses alone, never the page: a pane opening or the window resizing moves no house, and the camera
  // pans and zooms to show what doesn't fit.
  const columns = Math.max(2, Math.min(count || 1, Math.round(Math.sqrt(((count || 1) * 1.6 * LOT.height) / LOT.width))))
  const town = useMemo(() => townOf(state, now, columns, { here: house }), [state.messages, state.channels, state.actors, state.ops, state.me, now, columns, house])
  const lit = useMemo(() => new Set(town.residents.filter((r) => !r.idle).map((r) => r.channel)), [town])
  useEffect(() => world.current?.show(town, house, lit), [town, house, lit])

  /** A label kept over a point of the scene, by its key. */
  const over = (key: string, anchor: () => Vector3 | null, rank?: number) => (element: HTMLElement | null) => {
    if (element) labels.current.set(key, { element, anchor, ...(rank === undefined ? {} : { rank }) })
    else labels.current.delete(key)
  }
  /** Of two labels that would overlap, the one that shows: who's in a house first, then the busiest houses' signs. */
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
          {town.houses.map((h) => (
            <div key={`house:${h.channel}`} className="over" ref={over(`house:${h.channel}`, () => new Vector3(h.x + h.width / 2, 0, h.y + h.depth + PLATE - 8), rankOf(h))}>
              <button className={`plate${h.channel === house ? ' open' : ''}`} onClick={() => enter(h.channel)} title={h.channel === house ? `#${h.channel}` : `walk into #${h.channel}`}>
                <span className="name">#{h.name}</span>
                {h.tasks > 0 && <span className="count" title={`${h.tasks} open task${h.tasks === 1 ? '' : 's'}`}>{h.tasks}</span>}
              </button>
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
                    {h.who.slice(0, 3).map((w) => w.name).join(', ')}
                    {h.who.length > 3 && <span className="more">+{h.who.length - 3}</span>}
                  </button>
                </div>
              </div>
            ))}
          {open?.tables.map((table) => (
            <div key={`table:${table.thread}`} className="over table-label" ref={over(`table:${table.thread}`, () => new Vector3(table.x + 70, 26, table.y + 2), table.seated > 0 ? 2 : 0)}>
              <button onClick={() => navigate(hereWith({ thread: table.thread }))} title="open the thread">
                <span className="label">{table.label || 'a thread'}</span>
                {table.task && <span className={`state ${table.task}`}>{table.task}</span>}
              </button>
            </div>
          ))}
          {town.residents.map((r) => (
            <PersonLabel key={`person:${r.actor}`} resident={r} attach={over(`person:${r.actor}`, () => world.current?.personAt(r.actor) ?? null)} />
          ))}
        </div>
      </div>
      {house && <section className="town-inside">{props.children}</section>}
    </>
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
          {r.agent && <Bot size={11} strokeWidth={2} />}
          {r.you ? 'you' : r.name}
          {r.working && <Hammer size={11} strokeWidth={2} />}
        </span>
      </div>
    </div>
  )
}
