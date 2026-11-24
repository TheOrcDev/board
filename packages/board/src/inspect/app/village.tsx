import { Bot, Hammer, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Avatar } from './message.tsx'
import { here as hereWith, navigate, useNow } from './nav.tsx'
import { nameOf, type State } from './store.ts'
import { HOUSE, LOT, PORCH, roofOf, SIGN, townOf, type House, type Resident } from './town.ts'
import { Header } from './ui.tsx'

/**
 * Boardville: the board as a village, seen from above. Each channel is a house on its street, and
 * everyone waits on the porch of the house they were last active in. Walk into a house and its roof
 * comes off: its busiest threads are tables, and everyone sits at the one they were last in. Only the
 * house you're in opens, so the page reads one channel in full, and the rest from the feed.
 */
export function Town(props: { state: State; lead: ReactNode; house: string | null; children?: ReactNode }) {
  const { state, house } = props
  const now = useNow(5_000)
  const map = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(3)
  useLayoutEffect(() => {
    const element = map.current
    if (!element) return
    // The streets are laid out for the village seen whole, so walking in only moves the camera.
    const fit = () => setColumns(Math.max(1, Math.floor((element.clientWidth / FAR - SIGN - 16) / LOT.width)))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const town = useMemo(() => townOf(state, now, columns, { here: house }), [state.messages, state.channels, state.actors, state.ops, state.me, now, columns, house])
  const scale = house ? NEAR : FAR
  // Walking in, the camera comes down to the house; walking out, it goes back up over the village.
  const opened = town.houses.find((h) => h.channel === house)
  useLayoutEffect(() => {
    const element = map.current
    if (!element) return
    if (!opened) return element.scrollTo({ left: 0, top: 0 })
    element.scrollTo({ left: Math.max(0, opened.x * NEAR - (element.clientWidth - HOUSE.width * NEAR) / 2), top: Math.max(0, opened.y * NEAR - 24) })
    // Again once the streets fit the page: until then the village may be too narrow to scroll.
  }, [house, opened?.x, opened?.y, town.width])
  const lit = new Set(town.residents.filter((r) => !r.idle).map((r) => r.channel))
  const enter = (channel: string) => navigate(hereWith({ thread: null, params: { house: channel === house ? null : channel } }))
  const around = town.residents.filter((r) => !r.idle).length
  return (
    <>
      <Header title="boardville" meta={`${count(town.houses.length, 'house')} · ${around} around`} live={state.live} lead={props.lead}>
        {house && (
          <button className="tool" title={`leave #${house}`} onClick={() => enter(house)}>
            <X size={15} strokeWidth={1.75} />
          </button>
        )}
      </Header>
      <div className={`town${house ? ' inside' : ''}`} ref={map}>
        {town.houses.length === 0 ? (
          <p className="empty">{state.cursor === null ? 'loading…' : 'no houses yet: a channel is a house, so post in one'}</p>
        ) : (
          <div className="town-frame" style={{ width: town.width * scale, height: town.height * scale }}>
          <div className="town-map" style={{ width: town.width, height: town.height, transform: `scale(${scale})` }}>
            {town.streets.map((street) => (
              <div key={street.name} className="street" style={{ top: street.y, height: street.rows * LOT.height }}>
                <span className="street-sign" title={street.name}>
                  {street.name}
                </span>
              </div>
            ))}
            {town.houses.map((h) => (
              <HouseLot key={h.channel} house={h} lit={lit.has(h.channel)} open={h.channel === house} onEnter={() => enter(h.channel)} />
            ))}
            {town.residents.map((r) => (
              <Person key={r.actor} resident={r} inside={r.channel === house} state={state} />
            ))}
          </div>
          </div>
        )}
      </div>
      {house && <section className="town-inside">{props.children}</section>}
    </>
  )
}

/** The camera: the whole village from up high, and a house you're in up close. */
const FAR = 0.6
const NEAR = 1

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

function HouseLot(props: { house: House; lit: boolean; open: boolean; onEnter: () => void }) {
  const { house, open } = props
  const { width: w, height: h, wall } = HOUSE
  const door = { x: w / 2 - 24, width: 48 }
  return (
    <div className={`house roof-${roofOf(house.channel)}${open ? ' open' : ''}${props.lit ? ' lit' : ''}`} style={{ left: house.x, top: house.y, width: w, height: h }}>
      <svg className="plan" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
        <rect className="floor" x={wall} y={wall} width={w - 2 * wall} height={h - 2 * wall} />
        {/* Walls, with a gap in the front one for the door. */}
        <path className="wall" d={`M ${door.x} ${h - wall / 2} H ${wall / 2} V ${wall / 2} H ${w - wall / 2} V ${h - wall / 2} H ${door.x + door.width}`} />
        <rect className="mat" x={door.x + 6} y={h - wall - 14} width={door.width - 12} height={10} />
      </svg>
      {/* The inside, under the roof: what lifting it shows. */}
      {open &&
        house.tables.map((table) => (
          <button
            key={table.thread}
            className={`table${table.task ? ` task ${table.task}` : ''}`}
            style={{ left: table.x - house.x, top: table.y - house.y }}
            title={table.label ? `open the thread: ${table.label}` : 'open the thread'}
            onClick={() => navigate(hereWith({ thread: table.thread }))}
          >
            <span className="label">{table.label || 'a thread'}</span>
            {table.task && <span className="state">{table.task}</span>}
          </button>
        ))}
      <button className="roof" title={open ? `#${house.channel}` : `walk into #${house.channel}`} aria-pressed={open} onClick={props.onEnter}>
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
          {/* A hipped roof from above: four slopes meeting at a ridge. */}
          <polygon className="slope side" points={`-6,-6 90,${h / 2} -6,${h + 6}`} />
          <polygon className="slope side" points={`${w + 6},-6 ${w - 90},${h / 2} ${w + 6},${h + 6}`} />
          <polygon className="slope" points={`-6,-6 ${w + 6},-6 ${w - 90},${h / 2} 90,${h / 2}`} />
          <polygon className="slope near" points={`-6,${h + 6} ${w + 6},${h + 6} ${w - 90},${h / 2} 90,${h / 2}`} />
          <line className="ridge" x1="90" y1={h / 2} x2={w - 90} y2={h / 2} />
          <rect className="chimney" x={w - 120} y={h / 2 - 64} width="26" height="26" />
          {house.busy && (
            <g className="smoke">
              <circle cx={w - 107} cy={h / 2 - 74} r="7" />
              <circle cx={w - 100} cy={h / 2 - 88} r="5" />
            </g>
          )}
          <rect className="skylight" x="104" y={h / 2 + 30} width="34" height="24" />
          <rect className="skylight" x={w - 138} y={h / 2 + 30} width="34" height="24" />
        </svg>
      </button>
      <span className="plate" style={{ top: LOT.plate }}>
        <span className="name">#{house.name}</span>
        {house.tasks > 0 && <span className="count" title={`${house.tasks} open task${house.tasks === 1 ? '' : 's'}`}>{house.tasks}</span>}
        {!open && house.people > PORCH && <span className="count">+{house.people - PORCH}</span>}
      </span>
    </div>
  )
}

function Person({ resident: r, inside, state }: { resident: Resident; inside: boolean; state: State }) {
  const spot = inside ? r.inside : r.outside
  return (
    <div
      className={`person${r.idle ? ' idle' : ''}${r.you ? ' you' : ''}${r.agent ? ' agent' : ''}${spot ? '' : ' hidden'}`}
      style={{ transform: `translate(${(spot ?? r.inside).x}px, ${(spot ?? r.inside).y}px)` }}
      title={`${nameOf(state, r.actor)}${r.you ? ' (you)' : ''}${r.working ? ', working on a task here' : r.idle ? ', away' : ''}`}
    >
      {r.bubble && spot && (
        <button className="bubble" onClick={() => navigate(hereWith({ thread: r.bubble!.thread }))} title="open the thread">
          <span className="text">{r.bubble.text}</span>
        </button>
      )}
      <Avatar name={r.name} url={r.avatar} size={30} />
      {r.agent && (
        <span className="badge" aria-label="agent">
          <Bot size={10} strokeWidth={2} />
        </span>
      )}
      {r.working && (
        <span className="badge work" aria-label="working">
          <Hammer size={10} strokeWidth={2} />
        </span>
      )}
      {r.idle && <span className="zz">z</span>}
      <span className="tag">{r.you ? 'you' : r.name}</span>
    </div>
  )
}
