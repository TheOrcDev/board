import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { BLOCK, boardOf, PLATE, ROAD, ROOFS, roofOf, WALL as WALL_THICK, type House, type Resident, type Town } from './town.ts'

// Boardville in three dimensions. The village's layout is town.ts's, in its pixels: x across, y down
// the page, which is z here, with y up. This only draws it: houses with roofs that lift off the one
// you're in, people who sit at their threads' tables or walk from door to door, and a camera you can
// move. Text stays HTML: each label is a page element this moves over the scene, every frame.

/** How high walls stand. */
const WALL = 46
/**
 * How high each layer of the ground stands: the grass around the city, its roads, the blocks' slabs of grass
 * that houses and people stand on, and a house's floor. Far enough apart that the depth buffer always tells
 * them apart (see `clip`), or the camera sees them fight, and the ground flickers.
 */
export const LAYERS = { grass: -6, road: 3, slab: 8, floor: 10 }
const SLAB = LAYERS.slab

/**
 * The camera's near and far planes at `distance` from what it looks at: in proportion to it, so the depth
 * buffer's precision follows the camera, where a near plane fixed close by spends it all on the first few units.
 * The camera stands about 0.77 of its distance above the ground, so nothing comes nearer than a fifth of it.
 */
export function clip(distance: number): { near: number; far: number } {
  return { near: Math.max(5, distance * 0.2), far: distance * 8 + 2000 }
}
/** Where the sun is, from what it lights. */
export const SUN = new Vector3(-900, 1600, 900)
/** The sun's shadow map: its texels, and how far it reaches each way from what's in view. */
const SHADOW = { size: 2048, span: 2200 }
/** The camera over the village, and inside a house: lower and narrower there, for a room seen like a diorama. */
const VIEW = { village: { tilt: (48 * Math.PI) / 180, fov: 30 }, house: { tilt: (34 * Math.PI) / 180, fov: 22 } }
/** How fast people walk, in the layout's pixels a second. */
const PACE = 300
/** People, to the scale of the houses. */
const FIGURE_SCALE = 1.6
/** The farthest the camera starts: a big city is seen a couple of blocks at a time, and you move around it. */
const FAR_BLOCKS = 2.2
/** Farther than this, only the signs of houses with people or tasks show: the rest are too many to read. */
const QUIET_SIGNS = 4500

type Palette = { sky: string; ground: string; street: string; walls: string; floor: string; table: string; chair: string; ink: string; lit: string; window: string; smoke: string; bright: string; roofs: string[]; leaves: string; pine: string; trunk: string; flowers: string[]; rug: string; mat: string; pot: string }

/** The village's colors, from the page's own tokens, so it follows light and dark. */
export function paletteOf(element: Element): Palette {
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    sky: token('--sky', '#e9eef2'),
    ground: token('--ground', '#eef1ea'),
    street: token('--street', '#d9ded2'),
    walls: token('--walls', '#fbfaf6'),
    floor: token('--floor', '#e9dcc4'),
    table: token('--table', '#a77b52'),
    chair: token('--chair', '#5a6270'),
    ink: token('--ink', '#4a4a4a'),
    lit: token('--lit', '#f3d27a'),
    window: token('--window', '#dfe6ec'),
    smoke: token('--smoke', '#b8b8b8'),
    bright: token('--bright', '#040404'),
    roofs: Array.from({ length: ROOFS }, (_, i) => token(`--roof-${i}`, '#b8604f')),
    leaves: token('--leaves', '#6cc46a'),
    pine: token('--pine', '#4fa86a'),
    trunk: token('--trunk', '#a8754f'),
    flowers: ['--flower-0', '--flower-1', '--flower-2', '--flower-3'].map((name, i) => token(name, ['#ff8fa3', '#ffd166', '#ffffff', '#b39cff'][i]!)),
    rug: token('--rug', '#f2b8a2'),
    mat: token('--mat', '#e7a46a'),
    pot: token('--pot', '#d98b5f'),
  }
}

type HouseThings = {
  group: Group
  roof: Group
  roofMaterials: MeshStandardMaterial[]
  skylights: MeshStandardMaterial
  smoke: Mesh[]
  furniture: Group
  /** The tables it was furnished with, by thread and place: furnished again only when they change. */
  furnished: string
  size: string
  lift: number
  open: boolean
  busy: boolean
  /** How high its roof rises over its walls. */
  rise: number
  /** Whether it stands between the camera and the house you're in, and how faded it is for that. */
  inFront: boolean
  ghost: number
}

type PersonThings = {
  group: Group
  body: Group
  materials: MeshStandardMaterial[]
  ring: Mesh
  at: Vector3
  /** Where they walk to next, in order, each in a house or out on the street: the last is their place. */
  path: Waypoint[]
  /** Their place, and the door of its house, as the layout last gave them. */
  place: Vector3
  door: Vector3
  facing: number
  seated: boolean
  agent: boolean
  step: number
  channel: string
  thread: string | null
}

/** A point someone walks to: inside a house, seen only while its roof is off, or out on the street, seen always. */
type Waypoint = { to: Vector3; channel: string | null }

/** A page element kept over a point of the scene: its anchor says where, each frame, or null to hide it. */
export type Label = {
  element: HTMLElement
  anchor: () => Vector3 | null
  /** Of labels that would overlap, the higher shows; one with none set always shows. */
  rank?: number
}

export type Picked = { house: string } | { thread: string } | null

export class World {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(VIEW.village.fov, 1, 10, 30_000)
  private tilt = VIEW.village.tilt
  private view = VIEW.village
  private ground: Mesh
  private streets = new Group()
  /** The layout the city was last built for. */
  private cityKey = ''
  private houses = new Map<string, HouseThings>()
  private people = new Map<string, PersonThings>()
  private palette: Palette
  private look = new Vector3()
  private lookGoal = new Vector3()
  private distance = 1500
  private distanceGoal = 1500
  private frame = 0
  private last = 0
  private still: boolean
  private town: Town | null = null
  private observer: ResizeObserver
  private sun: DirectionalLight
  /** The house the camera was last aimed at (null for the village), so a refresh leaves where you've moved it. */
  private aimed: string | null | undefined = undefined
  /** Where the house the camera is on stood when it was aimed: if it moves or grows, the camera follows. */
  private aimedAt = ''
  private drag: { x: number; y: number; moved: number } | null = null
  /** Whether you've moved the camera yourself: until you do, it follows where people are. */
  private steered = false
  /** Each label's size, measured again only when its text changes: placing them reads no layout. */
  private sizes = new WeakMap<HTMLElement, { width: number; height: number; text: number }>()
  private host: HTMLElement
  private onPick: (picked: Picked) => void
  /** The page's labels, by key: each frame moves them over their points. */
  private labels: Map<string, Label>

  constructor(host: HTMLElement, onPick: (picked: Picked) => void, labels: Map<string, Label>) {
    this.host = host
    this.onPick = onPick
    this.labels = labels
    this.palette = paletteOf(host)
    this.still = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.renderer = new WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.domElement.className = 'town-canvas'
    host.prepend(this.renderer.domElement)

    this.scene.background = new Color(this.palette.sky)
    this.scene.fog = new Fog(this.palette.sky, 2000, 6000)
    this.scene.add(new HemisphereLight(0xdff2ff, 0x9cc77c, 1.25))
    this.scene.add(new AmbientLight(0xfff4e6, 0.4))
    const sun = new DirectionalLight(0xfff0d6, 2.1)
    sun.castShadow = true
    sun.shadow.mapSize.set(SHADOW.size, SHADOW.size)
    Object.assign(sun.shadow.camera, { left: -SHADOW.span, right: SHADOW.span, top: SHADOW.span, bottom: -SHADOW.span, near: 10, far: 6000 })
    sun.shadow.bias = -0.0002
    // Flat ground shadows itself in stripes that crawl as the sun moves; leaning each lookup off the surface stops it.
    sun.shadow.normalBias = 2
    this.scene.add(sun, sun.target)
    this.sun = sun

    this.ground = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: this.palette.ground, roughness: 1 }))
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground, this.streets)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    const canvas = this.renderer.domElement
    canvas.addEventListener('click', this.click)
    canvas.addEventListener('pointerdown', this.press)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.release)
    canvas.addEventListener('pointercancel', this.release)
    canvas.addEventListener('wheel', this.wheel, { passive: false })
    this.loop(performance.now())
  }

  /** The page's colors changed (light or dark): repaint with them. */
  repaint() {
    this.palette = paletteOf(this.host)
    ;(this.ground.material as MeshStandardMaterial).color.set(this.palette.ground)
    ;(this.scene.background as Color).set(this.palette.sky)
    this.scene.fog!.color.set(this.palette.sky)
    for (const [channel, house] of this.houses) {
      house.group.removeFromParent()
      dispose(house.group)
      this.houses.delete(channel)
    }
    if (this.town) this.show(this.town, this.aimed ?? null, new Set())
  }

  /** Whether a resident is sitting in their seat, in sight: their table's pill names them, so they need none of their own. */
  settled(actor: string): boolean {
    const person = this.people.get(actor)
    return !!person && person.group.visible && person.path.length === 0 && person.seated
  }

  /** Where a resident's head is now, mid-walk included, for their label; null while they're out of sight. */
  personAt(actor: string): Vector3 | null {
    const person = this.people.get(actor)
    if (!person || !person.group.visible) return null
    return person.at.clone().setY((person.seated ? 46 : 56) * FIGURE_SCALE)
  }

  /** Brings the scene to `town`, with `open` the house you're in and `lit` the houses with someone awake. */
  show(town: Town, open: string | null, lit: Set<string>) {
    this.town = town
    this.ground.scale.set(town.width + 8000, town.height + 8000, 1)
    this.ground.position.set(town.left + town.width / 2, LAYERS.grass, town.top + town.height / 2)
    this.drawCity(town)
    const seen = new Set<string>()
    for (const house of town.houses) {
      seen.add(house.channel)
      const size = `${house.width}x${house.depth}`
      let things = this.houses.get(house.channel)
      // A house that grew is built again, its roof as lifted as it was.
      if (things && things.size !== size) {
        const lift = things.lift
        things.group.removeFromParent()
        dispose(things.group)
        things = this.build(house)
        things.lift = lift
        this.houses.set(house.channel, things)
      }
      if (!things) this.houses.set(house.channel, (things = this.build(house)))
      // On its block's slab of grass, not in it.
      things.group.position.set(house.x, SLAB, house.y)
      things.open = house.channel === open
      things.busy = house.busy
      const on = lit.has(house.channel)
      things.skylights.color.set(on ? this.palette.lit : this.palette.window)
      things.skylights.emissive.set(on ? this.palette.lit : '#000000')
      this.furnish(things, house, things.open)
    }
    for (const [channel, things] of this.houses)
      if (!seen.has(channel)) {
        things.group.removeFromParent()
        dispose(things.group)
        this.houses.delete(channel)
      }
    // In front of the house you're in: nearer the camera, which looks from the street side, and across from it.
    const inside = open ? town.houses.find((h) => h.channel === open) : undefined
    for (const house of town.houses) {
      const things = this.houses.get(house.channel)!
      things.inFront = !!inside && house !== inside && house.y > inside.y + inside.depth - 40 && house.x < inside.x + inside.width + 160 && house.x + house.width > inside.x - 160
    }

    const here = new Set<string>()
    for (const resident of town.residents) {
      here.add(resident.actor)
      // Everyone has one place, whether or not you're looking: a roof only hides it.
      const place = new Vector3(resident.inside.x + 15, 0, resident.inside.y + 15)
      const door = new Vector3(resident.door.x + 15, 0, resident.door.y + 15)
      let person = this.people.get(resident.actor)
      if (person && person.agent !== resident.agent) {
        person.group.removeFromParent()
        dispose(person.group)
        person = undefined
      }
      if (!person) {
        // Someone new to the page is already where they are: no one walks in from nowhere.
        person = this.figure(resident, place, door)
        this.people.set(resident.actor, person)
      } else if (person.channel !== resident.channel) {
        // Off to another house: out of the door of the one they're in, down the street, and in at the other's.
        person.path = [
          { to: person.door.clone(), channel: person.channel },
          { to: door.clone(), channel: null },
          { to: place.clone(), channel: resident.channel },
        ]
      } else if (!person.place.equals(place)) {
        // To another table in the same house.
        person.path = [{ to: place.clone(), channel: resident.channel }]
      }
      person.channel = resident.channel
      person.thread = resident.thread
      person.place.copy(place)
      person.door.copy(door)
      person.facing = resident.facing
      person.seated = resident.seated
      person.ring.visible = resident.you
      for (const material of person.materials) {
        material.transparent = resident.idle
        material.opacity = resident.idle ? 0.5 : 1
      }
    }
    for (const [actor, person] of this.people)
      if (!here.has(actor)) {
        person.group.removeFromParent()
        dispose(person.group)
        this.people.delete(actor)
      }

    // Walking in or out moves the camera, and so does the village filling in until you've moved it yourself;
    // otherwise a refresh leaves it where you put it.
    const spot = open ? town.houses.find((h) => h.channel === open) : undefined
    const at = spot ? `${spot.x},${spot.y},${spot.width},${spot.depth}` : ''
    if (open !== this.aimed || (open === null && !this.steered) || (spot && at !== this.aimedAt)) this.aim(town, open)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('click', this.click)
    canvas.removeEventListener('pointerdown', this.press)
    canvas.removeEventListener('pointermove', this.move)
    canvas.removeEventListener('pointerup', this.release)
    canvas.removeEventListener('pointercancel', this.release)
    canvas.removeEventListener('wheel', this.wheel)
    dispose(this.scene)
    this.renderer.dispose()
    canvas.remove()
  }

  // --- the camera ---------------------------------------------------------------------------

  /** How far back the camera stands to see `width` across, and `depth` of ground with things `tall` standing on it. */
  private fit(width: number, depth: number, tall = 0) {
    const aspect = this.camera.aspect || 1
    // The ground's depth shows foreshortened by the camera's tilt, and what stands on it shows its height.
    const { tilt, fov } = this.view
    return (1.05 * Math.max(width / aspect, depth * Math.sin(tilt) + tall * Math.cos(tilt) + 120)) / (2 * Math.tan((fov * Math.PI) / 360))
  }

  private aim(town: Town, open: string | null) {
    const house = open ? town.houses.find((h) => h.channel === open) : undefined
    this.aimedAt = house ? `${house.x},${house.y},${house.width},${house.depth}` : ''
    this.view = house ? VIEW.house : VIEW.village
    if (house) {
      // A little above the floor: the room, and its whiteboard and the pills over it, all in view.
      this.lookGoal.set(house.x + house.width / 2, 70, house.y + house.depth / 2 + 10)
      // With room around it for the pills over the back row and the sign under its door.
      this.distanceGoal = this.fit(house.width + 80, house.depth + 120, 240)
    } else {
      const whole = this.fit(town.width + 80, town.height + 120)
      const near = this.fit(FAR_BLOCKS * BLOCK.width, FAR_BLOCKS * BLOCK.depth)
      if (whole <= near) this.lookGoal.set(town.left + town.width / 2, 0, town.top + town.height / 2)
      else {
        // Too big to read whole: start over the house with the most people in it, and let them move around.
        const busiest = [...town.houses].sort((a, b) => b.who.length - a.who.length || Number(b.busy) - Number(a.busy))[0]!
        this.lookGoal.set(busiest.x + busiest.width / 2, 0, busiest.y + busiest.depth / 2)
      }
      this.distanceGoal = Math.min(whole, near)
    }
    // Walking into a house and out again hands the camera back to the village.
    if (open !== this.aimed) this.steered = false
    this.aimed = open
    if (this.last === 0 || this.still) {
      this.look.copy(this.lookGoal)
      this.distance = this.distanceGoal
    }
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.host
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    if (this.town) this.aim(this.town, this.aimed ?? null)
  }

  // --- each frame ---------------------------------------------------------------------------

  private loop = (now: number) => {
    this.frame = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, this.last === 0 ? 0 : (now - this.last) / 1000)
    this.last = now
    const ease = this.still ? 1 : 1 - Math.exp(-dt * 4)
    this.look.lerp(this.lookGoal, ease)
    this.distance += (this.distanceGoal - this.distance) * ease
    this.tilt += (this.view.tilt - this.tilt) * ease
    const fov = this.camera.fov + (this.view.fov - this.camera.fov) * ease
    if (Math.abs(fov - this.camera.fov) > 1e-4) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.camera.position.set(this.look.x, this.look.y + Math.sin(this.tilt) * this.distance, this.look.z + Math.cos(this.tilt) * this.distance)
    this.camera.lookAt(this.look)
    const planes = clip(this.distance)
    if (this.camera.near !== planes.near || this.camera.far !== planes.far) {
      Object.assign(this.camera, planes)
      this.camera.updateProjectionMatrix()
    }
    // The sun's shadows cover what's in view, and the fog hides the village's far edge.
    this.follow(this.look)
    const fog = this.scene.fog as Fog
    fog.near = this.distance * 1.3
    fog.far = this.distance * 3

    for (const house of this.houses.values()) {
      const target = house.open ? 1 : 0
      house.lift += (target - house.lift) * (this.still ? 1 : 1 - Math.exp(-dt * 5))
      // A house between the camera and the one you're in fades to a ghost of itself, so nothing hides the room.
      house.ghost += ((house.inFront ? 0.78 : 0) - house.ghost) * (this.still ? 1 : 1 - Math.exp(-dt * 5))
      house.roof.position.y = house.lift * 120
      house.roof.visible = house.lift < 0.98
      house.furniture.visible = house.lift > 0.02
      for (const material of house.roofMaterials) {
        const fade = Math.max(house.lift, house.ghost)
        material.transparent = fade > 0.01
        material.opacity = 1 - fade
        material.depthWrite = fade < 0.5
      }
      house.smoke.forEach((puff, i) => {
        puff.visible = house.busy && !house.open
        const t = (now / 2400 + i / house.smoke.length) % 1
        puff.position.y = WALL + house.rise + 20 + t * 70
        puff.scale.setScalar(0.6 + t)
        ;(puff.material as MeshStandardMaterial).opacity = 0.8 * (1 - t)
      })
    }

    for (const person of this.people.values()) {
      // Walk the path a leg at a time; with motion reduced, they're at its end at once.
      if (this.still && person.path.length > 0) {
        person.at.copy(person.path.at(-1)!.to)
        person.path = []
      }
      const leg = person.path[0]
      let walking = false
      if (leg) {
        const away = leg.to.clone().sub(person.at).setY(0)
        const far = away.length()
        if (far < 1) {
          person.at.copy(leg.to)
          person.path.shift()
        } else {
          walking = true
          person.at.add(away.multiplyScalar(Math.min(1, (PACE * dt) / far)))
          person.step += dt * 12
          person.group.rotation.y = Math.atan2(leg.to.x - person.at.x, leg.to.z - person.at.z)
        }
      }
      if (!walking) {
        person.step = 0
        person.group.rotation.y += (person.facing - person.group.rotation.y) * 0.15
      }
      // Out on the street they're seen; in a house, only while its roof is off.
      const within = person.path.length > 0 ? person.path[0]!.channel : person.channel
      person.group.visible = within === null || this.houses.get(within)?.open === true
      person.body.position.y = !walking && person.path.length === 0 && person.seated ? -9 : Math.abs(Math.sin(person.step)) * 4
      person.group.position.set(person.at.x, SLAB, person.at.z)
    }

    this.renderer.render(this.scene, this.camera)
    this.place()
  }

  /**
   * The sun over `at`, moved only in whole texels of its shadow map. A shadow map that slides by less than a
   * texel as the camera moves draws every shadow's edge a little differently each frame, and they shimmer.
   */
  private follow(at: Vector3) {
    // The map reaches as far as the camera sees, in doublings: a reach that changed every frame would shimmer too.
    const span = SHADOW.span * 2 ** Math.max(0, Math.ceil(Math.log2((this.distance * 0.9) / SHADOW.span)))
    const shadow = this.sun.shadow.camera
    if (shadow.right !== span) {
      Object.assign(shadow, { left: -span, right: span, top: span, bottom: -span, far: 6000 + span })
      shadow.updateProjectionMatrix()
    }
    const target = onTexels(at, SUN, (span * 2) / SHADOW.size)
    this.sun.target.position.copy(target)
    this.sun.position.copy(target).add(SUN)
  }

  /** Moves each label over its point; one off the scene hides, and so does a ranked one that would overlap another. */
  private place() {
    const { clientWidth: width, clientHeight: height } = this.host
    const taken: { left: number; right: number; top: number; bottom: number }[] = []
    // Labels that always show go first, then the ranked ones, highest first.
    const order = [...this.labels.values()].sort((a, b) => (b.rank ?? Infinity) - (a.rank ?? Infinity))
    for (const label of order) {
      const { element } = label
      const at = label.anchor()
      if (!at) {
        element.style.visibility = 'hidden'
        continue
      }
      // `project` changes the point it's given: a copy, so `at` stays where it is in the scene.
      const p = at.clone().project(this.camera)
      const x = ((p.x + 1) / 2) * width
      const y = ((1 - p.y) / 2) * height
      let shown = !(p.z > 1 || p.x < -1.2 || p.x > 1.2 || p.y < -1.2 || p.y > 1.2) && !(label.rank === 0 && this.distance > QUIET_SIGNS)
      // A label as wide as a stretch of the scene, a table's: as many pixels as that stretch spans at its point.
      const span = Number(element.dataset.span)
      let fit = Infinity
      if (shown && span) {
        const end = at.clone().add(new Vector3(span, 0, 0)).project(this.camera)
        fit = Math.floor(((Math.abs(end.x - p.x) / 2) * width) * 0.94)
        // The page caps what's in the label at it: a table's label, its pill, and what's said there.
        if (element.style.getPropertyValue('--fit') !== `${fit}px`) element.style.setProperty('--fit', `${fit}px`)
        // Too narrow to say anything: no label at all.
        if (fit < 36) shown = false
      }
      if (shown) {
        // A label hangs above its point, centered on it, or below it.
        const natural = this.sizeOf(element)
        const size = { width: Math.min(natural.width, fit), height: natural.height }
        const below = element.classList.contains('below')
        const centered = element.classList.contains('centered')
        const top = centered ? y - size.height / 2 : below ? y : y - size.height
        const box = { left: x - size.width / 2 - 3, right: x + size.width / 2 + 3, top: top - 2, bottom: top + size.height + 2 }
        if (label.rank !== undefined) shown = !taken.some((t) => box.left < t.right && box.right > t.left && box.top < t.bottom && box.bottom > t.top)
        if (shown) taken.push(box)
      }
      element.style.visibility = shown ? 'visible' : 'hidden'
      element.style.transform = `translate(${x}px, ${y}px)`
    }
  }

  private sizeOf(element: HTMLElement) {
    const content = element.firstElementChild as HTMLElement | null
    const text = content?.textContent?.length ?? 0
    let size = this.sizes.get(element)
    if (!size || size.width === 0 || size.text !== text) {
      size = { width: content?.offsetWidth ?? 0, height: content?.offsetHeight ?? 0, text }
      this.sizes.set(element, size)
    }
    return size
  }

  // --- moving around: drag to pan, the wheel to zoom ---------------------------------------

  private press = (event: PointerEvent) => {
    if (event.button !== 0) return
    this.drag = { x: event.clientX, y: event.clientY, moved: 0 }
    this.renderer.domElement.setPointerCapture(event.pointerId)
  }

  private move = (event: PointerEvent) => {
    if (!this.drag) return
    const dx = event.clientX - this.drag.x
    const dy = event.clientY - this.drag.y
    this.drag = { x: event.clientX, y: event.clientY, moved: this.drag.moved + Math.abs(dx) + Math.abs(dy) }
    // The ground under the pointer follows it: as far across as a pixel spans at the camera's distance.
    const perPixel = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / this.host.clientHeight
    const shift = new Vector3(-dx * perPixel, 0, (-dy * perPixel) / Math.sin(this.tilt))
    if (Math.abs(dx) + Math.abs(dy) > 0) this.steered = true
    this.look.add(shift)
    this.lookGoal.add(shift)
  }

  private release = (event: PointerEvent) => {
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId)
    // A drag that moved isn't a click: the click that follows it is ignored.
    if (this.drag && this.drag.moved < 5) this.drag = null
    else setTimeout(() => (this.drag = null))
  }

  private wheel = (event: WheelEvent) => {
    event.preventDefault()
    this.steered = true
    const town = this.town
    const most = town ? Math.max(1500, Math.max(town.width, town.height) * 1.6) : 6000
    this.distanceGoal = Math.min(most, Math.max(320, this.distanceGoal * Math.exp(event.deltaY * 0.0015)))
  }

  // --- picking ------------------------------------------------------------------------------

  private click = (event: MouseEvent) => {
    if (this.drag) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    const ray = new Raycaster()
    ray.setFromCamera(pointer, this.camera)
    const targets = [...this.houses.values()].map((h) => h.group)
    for (const hit of ray.intersectObjects(targets, true)) {
      // The raycaster hits what's hidden too: a lifted roof is hidden by its group, so look up the whole way.
      if (!shown(hit.object)) continue
      let at: Object3D | null = hit.object
      while (at && !at.userData.thread && !at.userData.house) at = at.parent
      if (at?.userData.thread) return this.onPick({ thread: at.userData.thread })
      if (at?.userData.house) return this.onPick({ house: at.userData.house })
    }
    this.onPick(null)
  }

  // --- building things ----------------------------------------------------------------------

  /**
   * The city: its paths, and on them each block, a slab of grass its houses stand on, with trees and flowers
   * where no house, sign, or door is. Built again only when the city's layout changes.
   */
  private drawCity(town: Town) {
    const key = `${town.left},${town.top},${town.width},${town.height}|${town.houses.map((h) => `${h.x},${h.y},${h.width},${h.depth}`).join(';')}`
    if (key === this.cityKey) return
    this.cityKey = key
    for (const child of [...this.streets.children]) {
      child.removeFromParent()
      dispose(child)
    }
    const thick = LAYERS.road - LAYERS.grass
    const road = new Mesh(new BoxGeometry(town.width + 2 * ROAD, thick, town.height + 2 * ROAD), new MeshStandardMaterial({ color: this.palette.street, roughness: 1 }))
    road.position.set(town.left + town.width / 2, LAYERS.grass + thick / 2, town.top + town.height / 2)
    road.receiveShadow = true
    this.streets.add(road)
    const grass = new MeshStandardMaterial({ color: this.palette.ground, roughness: 1 })
    for (const block of town.blocks) {
      const slab = new Mesh(new RoundedBoxGeometry(BLOCK.width, SLAB - LAYERS.road, block.depth, 3, 6), grass)
      slab.position.set(block.x + BLOCK.width / 2, (SLAB + LAYERS.road) / 2, block.y + block.depth / 2)
      slab.receiveShadow = true
      this.streets.add(slab)
    }
    this.plant(town)
  }

  /**
   * Trees and flowers on each block, wherever there's room: each spot of a block's grid gets one or none by a
   * hash of where it is, so a block is planted the same way on every visit. Drawn as instances, a mesh a kind.
   */
  private plant(town: Town) {
    // Where nothing grows: each house, with room around it, and its sign and the walk to its door in front.
    const clear = town.houses.map((h) => ({ left: h.x - 26, right: h.x + h.width + 26, top: h.y - 26, bottom: h.y + h.depth + PLATE + 30 }))
    const free = (x: number, z: number) => !clear.some((c) => x > c.left && x < c.right && z > c.top && z < c.bottom)
    type Spot = { x: number; z: number; size: number; kind: 'round' | 'pine' | 'flowers'; hue: number }
    const spots: Spot[] = []
    const step = 74
    for (const block of town.blocks) {
      for (let x = block.x + 30; x < block.x + BLOCK.width - 30; x += step)
        for (let z = block.y + 30; z < block.y + block.depth - 30; z += step) {
          // A little off the grid, so nothing grows in rows.
          const jx = x + (hashOf(`${x},${z}:x`) - 0.5) * 40
          const jz = z + (hashOf(`${x},${z}:z`) - 0.5) * 40
          if (!free(jx, jz)) continue
          const roll = hashOf(`${x},${z}`)
          if (roll < 0.16) spots.push({ x: jx, z: jz, size: 0.8 + hashOf(`${x},${z}:s`) * 0.5, kind: 'round', hue: roll })
          else if (roll < 0.24) spots.push({ x: jx, z: jz, size: 0.8 + hashOf(`${x},${z}:s`) * 0.4, kind: 'pine', hue: roll })
          else if (roll < 0.4) spots.push({ x: jx, z: jz, size: 1, kind: 'flowers', hue: hashOf(`${x},${z}:h`) })
        }
    }
    const matrix = new Matrix4()
    const place = (mesh: InstancedMesh, i: number, x: number, y: number, z: number, scale: number, squash = 1) => {
      matrix.makeScale(scale, scale * squash, scale).setPosition(x, y, z)
      mesh.setMatrixAt(i, matrix)
    }
    const instanced = (geometry: BufferGeometry, color: string, count: number, shadows = true) => {
      const mesh = new InstancedMesh(geometry, new MeshStandardMaterial({ color, roughness: 0.95 }), Math.max(1, count))
      mesh.count = count
      mesh.castShadow = shadows
      mesh.receiveShadow = true
      this.streets.add(mesh)
      return mesh
    }
    const round = spots.filter((s) => s.kind === 'round')
    const pines = spots.filter((s) => s.kind === 'pine')
    const flowers = spots.filter((s) => s.kind === 'flowers')
    const trunks = instanced(new CylinderGeometry(4, 6, 30, 8), this.palette.trunk, round.length + pines.length)
    const crowns = instanced(new SphereGeometry(26, 14, 10), this.palette.leaves, round.length)
    const tops = instanced(new SphereGeometry(18, 12, 8), this.palette.leaves, round.length)
    const cones = instanced(new ConeGeometry(24, 70, 9), this.palette.pine, pines.length)
    round.forEach((tree, i) => {
      place(trunks, i, tree.x, SLAB + 15 * tree.size, tree.z, tree.size)
      place(crowns, i, tree.x, SLAB + 48 * tree.size, tree.z, tree.size, 0.9)
      place(tops, i, tree.x + 6 * tree.size, SLAB + 68 * tree.size, tree.z - 4 * tree.size, tree.size)
    })
    pines.forEach((tree, i) => {
      place(trunks, round.length + i, tree.x, SLAB + 12 * tree.size, tree.z, tree.size * 0.8)
      place(cones, i, tree.x, SLAB + 55 * tree.size, tree.z, tree.size)
    })
    // Flowers in clumps of five, each clump one color of a few.
    const petals = this.palette.flowers
    for (let c = 0; c < petals.length; c++) {
      const mine = flowers.filter((f) => Math.floor(f.hue * petals.length) === c)
      const blooms = instanced(new SphereGeometry(4.5, 8, 6), petals[c]!, mine.length * 5, false)
      mine.forEach((clump, i) => {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + clump.hue * 6
          place(blooms, i * 5 + k, clump.x + Math.cos(a) * 9, SLAB + 5, clump.z + Math.sin(a) * 9, 1)
        }
      })
    }
    for (const child of this.streets.children) if (child instanceof InstancedMesh) child.instanceMatrix.needsUpdate = true
  }

  private build(house: House): HouseThings {
    const { width: w, depth: h } = house
    const wall = WALL_THICK
    const p = this.palette
    const group = new Group()
    group.userData.house = house.channel
    const walls = new MeshStandardMaterial({ color: p.walls, roughness: 0.85 })
    const lift = LAYERS.floor - LAYERS.slab
    const floor = new Mesh(new BoxGeometry(w - 2 * wall, lift, h - 2 * wall), new MeshStandardMaterial({ color: p.floor, roughness: 0.9 }))
    floor.position.set(w / 2, lift / 2, h / 2)
    floor.receiveShadow = true
    group.add(floor)
    // Planks, as lines across the floor.
    const seam = new MeshStandardMaterial({ color: new Color(p.floor).offsetHSL(0, 0, -0.08), roughness: 1 })
    for (let z = wall + 24; z < h - wall; z += 24) {
      const line = new Mesh(new BoxGeometry(w - 2 * wall, 0.4, 1.2), seam)
      line.position.set(w / 2, lift + 0.2, z)
      group.add(line)
    }
    const door = 56
    const side = (w - door) / 2
    const pieces: [number, number, number, number][] = [
      [w / 2, wall / 2, w, wall], // back
      [wall / 2, h / 2, wall, h], // left
      [w - wall / 2, h / 2, wall, h], // right
      [side / 2, h - wall / 2, side, wall], // front, left of the door
      [w - side / 2, h - wall / 2, side, wall], // front, right of the door
    ]
    for (const [x, z, sx, sz] of pieces) {
      const piece = new Mesh(new RoundedBoxGeometry(sx, WALL, sz, 2, Math.min(4, sx / 2.5, sz / 2.5)), walls)
      piece.position.set(x, WALL / 2, z)
      piece.castShadow = true
      piece.receiveShadow = true
      group.add(piece)
    }
    const mat = new Mesh(new RoundedBoxGeometry(door - 6, 2, 22, 2, 1), new MeshStandardMaterial({ color: p.mat, roughness: 1 }))
    mat.position.set(w / 2, 1, h + 12)
    mat.receiveShadow = true
    group.add(mat)

    const roof = new Group()
    const slope = new MeshStandardMaterial({ color: new Color(p.roofs[roofOf(house.channel)]), roughness: 0.75, flatShading: true, side: DoubleSide })
    const chimneyMaterial = new MeshStandardMaterial({ color: p.walls, roughness: 0.85 })
    // A tall, friendly roof, with deep eaves.
    const rise = Math.min(170, 90 + Math.min(w, h) * 0.16)
    const hip = new Mesh(hipRoof(w, h, 20, rise), slope)
    hip.position.y = WALL
    hip.castShadow = true
    roof.add(hip)
    const chimney = new Mesh(new RoundedBoxGeometry(28, rise * 0.7, 28, 2, 5), chimneyMaterial)
    chimney.position.set(w - Math.min(110, w / 3), WALL + rise * 0.65, h / 2 - h / 7)
    chimney.castShadow = true
    roof.add(chimney)
    const skylights = new MeshStandardMaterial({ color: p.window, emissiveIntensity: 0.6, roughness: 0.4 })
    const run = h / 2 + 20
    for (let x = 70; x < w - 50; x += 120) {
      const light = new Mesh(new RoundedBoxGeometry(36, 4, 26, 2, 1.5), skylights)
      // On the near slope, halfway down, tipped to lie on it.
      light.position.set(x, WALL + rise / 2 + 2, h / 2 + run / 2)
      light.rotation.x = Math.atan2(rise, run)
      roof.add(light)
    }
    group.add(roof)

    const smoke = Array.from({ length: 3 }, () => {
      const puff = new Mesh(new SphereGeometry(9, 10, 8), new MeshStandardMaterial({ color: p.smoke, transparent: true, roughness: 1 }))
      puff.position.set(chimney.position.x, WALL + rise + 40, chimney.position.z)
      group.add(puff)
      return puff
    })
    const furniture = new Group()
    furniture.visible = false
    group.add(furniture)
    this.scene.add(group)
    return { group, roof, roofMaterials: [slope, chimneyMaterial, skylights], skylights, smoke, furniture, furnished: '', size: `${w}x${h}`, lift: 0, open: false, busy: false, rise, inFront: false, ghost: 0 }
  }

  /**
   * The inside of the house you're in: a rug, its tables with their chairs, a laptop on each task's desk, a plant
   * in each corner, and the whiteboard along the back wall. Only the house you're in has any of it.
   */
  private furnish(things: HouseThings, house: House, open: boolean) {
    const key = open ? `${house.width}x${house.depth}|${house.tables.map((t) => `${t.thread}@${t.x},${t.y}:${t.task ?? ''}:${t.seated}`).join(' ')}` : ''
    if (key === things.furnished) return
    things.furnished = key
    for (const child of [...things.furniture.children]) {
      child.removeFromParent()
      dispose(child)
    }
    if (!open) return
    const p = this.palette
    const { width: w, depth: h } = house
    const lift = LAYERS.floor - LAYERS.slab
    const wood = new MeshStandardMaterial({ color: p.table, roughness: 0.7 })
    // A rug under the tables.
    const rows = house.tables.length > 0 ? house.tables : []
    if (rows.length > 0) {
      const left = Math.min(...rows.map((t) => t.x)) - house.x - 20
      const right = Math.max(...rows.map((t) => t.x + 140)) - house.x + 20
      const top = Math.min(...rows.map((t) => t.y)) - house.y - 56
      const bottom = Math.max(...rows.map((t) => t.y)) - house.y + 90
      const rug = new Mesh(new RoundedBoxGeometry(right - left, 1, bottom - top, 2, 8), new MeshStandardMaterial({ color: p.rug, roughness: 1 }))
      rug.position.set((left + right) / 2, lift + 0.5, (top + bottom) / 2)
      rug.receiveShadow = true
      things.furniture.add(rug)
    }
    for (const table of house.tables) {
      const desk = new Group()
      desk.userData.thread = table.thread
      const top = new Mesh(new RoundedBoxGeometry(140, 7, 36, 2, 3), wood)
      top.position.y = 24
      top.castShadow = true
      top.receiveShadow = true
      desk.add(top)
      for (const [lx, lz] of [[-60, -12], [60, -12], [-60, 12], [60, 12]] as const) {
        const leg = new Mesh(new CylinderGeometry(2.4, 2.4, 22, 8), wood)
        leg.position.set(lx, 11, lz)
        desk.add(leg)
      }
      // A task's desk has a laptop on it, its screen lit while someone works the task.
      if (table.task) {
        const shell = new MeshStandardMaterial({ color: '#e9edf2', roughness: 0.5 })
        const base = new Mesh(new RoundedBoxGeometry(34, 2, 22, 2, 1), shell)
        base.position.set(0, 29, 2)
        const lid = new Mesh(new RoundedBoxGeometry(34, 22, 2, 2, 1), shell)
        lid.position.set(0, 40, -9)
        lid.rotation.x = -0.25
        const glass = new Mesh(new BoxGeometry(30, 17, 0.6), new MeshStandardMaterial({ color: '#1d2430', emissive: table.task === 'claimed' ? '#5fb8ff' : '#000000', emissiveIntensity: 0.6 }))
        glass.position.set(0, 40, -7.8)
        glass.rotation.x = -0.25
        desk.add(base, lid, glass)
      }
      desk.position.set(table.x - house.x + 70, lift, table.y - house.y + 17)
      things.furniture.add(desk)
      // Chairs in a color of the table's own; a task's desk has one, any other table one more than sit at it.
      const seat = new MeshStandardMaterial({ color: new Color().setHSL(hashOf(table.thread), 0.45, 0.68), roughness: 0.8 })
      const chairs = table.task ? 1 : Math.min(table.chairs.length, Math.max(2, table.seated + 1))
      table.chairs.slice(0, chairs).forEach((chair, i) => {
        const piece = new Group()
        piece.userData.thread = table.thread
        const cushion = new Mesh(new RoundedBoxGeometry(22, 6, 20, 2, 2.5), seat)
        cushion.position.y = 13
        const back = new Mesh(new RoundedBoxGeometry(22, 20, 5, 2, 2.2), seat)
        // Its back away from the table.
        back.position.set(0, 25, i < 3 ? -9 : 9)
        piece.add(cushion, back)
        for (const child of piece.children) child.castShadow = true
        piece.position.set(chair.x - house.x + 15, lift, chair.y - house.y + 15)
        things.furniture.add(piece)
      })
    }
    // A plant in each corner of the room.
    const pot = new MeshStandardMaterial({ color: p.pot, roughness: 0.8 })
    const leaves = new MeshStandardMaterial({ color: p.leaves, roughness: 0.9 })
    for (const [x, z] of [[WALL_THICK + 18, WALL_THICK + 18], [w - WALL_THICK - 18, WALL_THICK + 18], [WALL_THICK + 18, h - WALL_THICK - 30], [w - WALL_THICK - 18, h - WALL_THICK - 30]] as const) {
      const plant = new Group()
      const base = new Mesh(new CylinderGeometry(9, 7, 14, 12), pot)
      base.position.y = 7
      const bush = new Mesh(new SphereGeometry(13, 12, 10), leaves)
      bush.position.y = 24
      plant.add(base, bush)
      for (const part of plant.children) part.castShadow = true
      plant.position.set(x, lift, z)
      things.furniture.add(plant)
    }
    // The whiteboard: a frame on two legs, along the back wall, facing the room. Its words are the page's.
    const board = boardOf(house)
    const frame = new MeshStandardMaterial({ color: p.table, roughness: 0.7 })
    const panel = new Mesh(new RoundedBoxGeometry(board.width, board.height, 3, 2, 2), new MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.4 }))
    panel.position.set(w / 2, lift + board.bottom + board.height / 2, board.z)
    const rim = new Mesh(new RoundedBoxGeometry(board.width + 10, board.height + 10, 2, 2, 3), frame)
    rim.position.set(w / 2, lift + board.bottom + board.height / 2, board.z - 1.5)
    const tray = new Mesh(new RoundedBoxGeometry(board.width * 0.5, 3, 8, 2, 1), frame)
    tray.position.set(w / 2, lift + board.bottom - 2, board.z + 5)
    things.furniture.add(panel, rim, tray)
    for (const lx of [w / 2 - board.width / 2 + 8, w / 2 + board.width / 2 - 8]) {
      const leg = new Mesh(new CylinderGeometry(2.4, 2.4, board.bottom + 4, 8), frame)
      leg.position.set(lx, lift + (board.bottom + 4) / 2, board.z - 2)
      things.furniture.add(leg)
    }
    for (const part of [panel, rim]) part.castShadow = true
  }

  /**
   * Someone, small and round. A person: a big round head with hair, dot eyes, and rosy cheeks, on a little
   * body with feet. An agent: a rounded robot with a screen for a face and a light on its antenna. Each in a
   * color of their own.
   */
  private figure(resident: Resident, at: Vector3, door: Vector3): PersonThings {
    const group = new Group()
    const body = new Group()
    group.add(body)
    const tint = new Color().setHSL(hue(resident.actor), 0.55, 0.62)
    const shirt = new MeshStandardMaterial({ color: tint, roughness: 0.7 })
    const dark = new MeshStandardMaterial({ color: '#2a2320', roughness: 0.5 })
    const materials = [shirt, dark]
    if (resident.agent) {
      const shell = new MeshStandardMaterial({ color: tint.clone().offsetHSL(0, -0.2, 0.18), roughness: 0.45 })
      const trunk = new Mesh(new RoundedBoxGeometry(18, 18, 14, 3, 5), shirt)
      trunk.position.y = 14
      const head = new Mesh(new RoundedBoxGeometry(24, 20, 20, 3, 7), shell)
      head.position.y = 35
      const face = new Mesh(new RoundedBoxGeometry(18, 12, 1.5, 2, 2), dark)
      face.position.set(0, 35, 10)
      const glow = new MeshStandardMaterial({ color: '#8ff0ff', emissive: '#8ff0ff', emissiveIntensity: 0.9 })
      for (const ex of [-4.5, 4.5]) {
        const eye = new Mesh(new SphereGeometry(2, 8, 6), glow)
        eye.position.set(ex, 36, 10.8)
        body.add(eye)
      }
      const antenna = new Mesh(new CylinderGeometry(0.9, 0.9, 9), shell)
      antenna.position.y = 49
      const tip = new Mesh(new SphereGeometry(2.8, 10, 8), glow)
      tip.position.y = 55
      for (const fx of [-5, 5]) {
        const foot = new Mesh(new SphereGeometry(4, 10, 8), shell)
        foot.scale.set(1, 0.6, 1.3)
        foot.position.set(fx, 3, 1)
        body.add(foot)
      }
      body.add(trunk, head, face, antenna, tip)
      materials.push(shell, glow)
    } else {
      const skin = new MeshStandardMaterial({ color: new Color().setHSL(0.07, 0.5, 0.7 + (hue(`${resident.actor}:skin`) - 0.5) * 0.22), roughness: 0.8 })
      const hair = new MeshStandardMaterial({ color: new Color().setHSL(hue(`${resident.actor}:hair`) * 0.1, 0.5, 0.2 + hue(`${resident.actor}:shade`) * 0.32), roughness: 0.85 })
      const blush = new MeshStandardMaterial({ color: '#f59a9a', roughness: 1 })
      const trunk = new Mesh(new CapsuleGeometry(7.5, 8, 4, 12), shirt)
      trunk.position.y = 13
      const head = new Mesh(new SphereGeometry(12.5, 20, 16), skin)
      head.position.y = 34
      const cap = new Mesh(new SphereGeometry(13.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair)
      cap.position.set(0, 35.5, -1)
      cap.rotation.x = -0.35
      for (const ex of [-4.3, 4.3]) {
        const eye = new Mesh(new SphereGeometry(1.7, 8, 6), dark)
        eye.scale.set(1, 1.35, 1)
        eye.position.set(ex, 34, 11.8)
        const cheek = new Mesh(new SphereGeometry(2.3, 8, 6), blush)
        cheek.scale.set(1.2, 0.7, 0.5)
        cheek.position.set(ex * 1.65, 30.5, 10.4)
        body.add(eye, cheek)
      }
      for (const fx of [-3.5, 3.5]) {
        const foot = new Mesh(new SphereGeometry(3.4, 10, 8), dark)
        foot.scale.set(1, 0.6, 1.4)
        foot.position.set(fx, 2.5, 1.5)
        body.add(foot)
      }
      body.add(trunk, head, cap)
      materials.push(skin, hair, blush)
    }
    for (const part of body.children) part.castShadow = true
    const ring = new Mesh(new RingGeometry(14, 18, 32), new MeshStandardMaterial({ color: this.palette.bright }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 1
    group.add(ring)
    group.scale.setScalar(FIGURE_SCALE)
    group.position.copy(at)
    this.scene.add(group)
    return { group, body, materials, ring, at: at.clone(), path: [], place: at.clone(), door: door.clone(), facing: resident.facing, seated: resident.seated, agent: resident.agent, step: 0, channel: resident.channel, thread: resident.thread }
  }
}

/**
 * The point nearest `at` that falls on whole texels of a shadow map `texel` wide, cast by a light at `sun` from
 * what it lights: measured along the map's own axes, across and up as the light sees the ground.
 */
export function onTexels(at: Vector3, sun: Vector3, texel: number): Vector3 {
  const along = sun.clone().negate().normalize()
  const right = new Vector3().crossVectors(along, new Vector3(0, 1, 0)).normalize()
  const up = new Vector3().crossVectors(right, along).normalize()
  const snap = (axis: Vector3) => {
    const d = at.dot(axis)
    return axis.clone().multiplyScalar(Math.round(d / texel) * texel - d)
  }
  return at.clone().add(snap(right)).add(snap(up))
}

/** A hipped roof over a `w` by `h` house: four slopes from its eaves, `over` past the walls, up to a ridge `rise` high. */
function hipRoof(w: number, h: number, over: number, rise: number): BufferGeometry {
  // The ridge runs along the house's length, as far in from each end as the slopes are deep.
  const inset = Math.min(h / 2 + over, w / 2 + over - 4)
  const a = [-over, 0, -over]
  const b = [w + over, 0, -over]
  const c = [w + over, 0, h + over]
  const d = [-over, 0, h + over]
  const r1 = [inset - over, rise, h / 2]
  const r2 = [w - inset + over, rise, h / 2]
  const faces = [
    [a, r1, r2], [a, r2, b], // the far slope
    [d, c, r2], [d, r2, r1], // the near slope
    [a, d, r1], // the left hip
    [b, r2, c], // the right hip
  ]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(faces.flat(2), 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Whether an object is drawn: it and every group it's in are visible. */
function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at; at = at.parent) if (!at.visible) return false
  return true
}

/** A number in [0, 1) for a text, the same every time: where a tree grows, and what kind. */
function hashOf(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return ((hash >>> 0) % 100_000) / 100_000
}

function hue(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return (Math.abs(hash) % 360) / 360
}

function dispose(root: Object3D) {
  root.traverse((child) => {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as Material | Material[] | undefined
    for (const one of Array.isArray(material) ? material : material ? [material] : []) one.dispose()
  })
}
