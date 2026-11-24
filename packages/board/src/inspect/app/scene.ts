import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
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
import { HOUSE, LOT, ROOFS, roofOf, type Resident, type Town } from './town.ts'

// Boardville in three dimensions. The village's layout is town.ts's, in its pixels: x across, y down
// the page, which is z here, with y up. This only draws it: houses with roofs that lift off the one
// you're in, people who walk to where the layout puts them, and a camera that comes down to a house.
// Text stays HTML: each label is a page element this moves over the scene, every frame.

const WALL = 46
const TILT = (48 * Math.PI) / 180
/** People, to the scale of the houses. */
const FIGURE_SCALE = 1.5
/** The farthest the camera starts: a big village is seen a street or so at a time, and you move around it. */
const FAR_HOUSES = 6
const FOV = 32
/** How fast people walk, in the layout's pixels a second. */
const PACE = 260

type Palette = { sky: string; ground: string; street: string; walls: string; floor: string; table: string; ink: string; lit: string; window: string; smoke: string; bright: string; roofs: string[] }

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
    table: token('--table', '#f6efe2'),
    ink: token('--ink', '#4a4a4a'),
    lit: token('--lit', '#f3d27a'),
    window: token('--window', '#dfe6ec'),
    smoke: token('--smoke', '#b8b8b8'),
    bright: token('--bright', '#040404'),
    roofs: Array.from({ length: ROOFS }, (_, i) => token(`--roof-${i}`, '#b8604f')),
  }
}

type HouseThings = {
  group: Group
  roof: Group
  roofMaterials: MeshStandardMaterial[]
  skylights: MeshStandardMaterial
  smoke: Mesh[]
  tables: Map<string, Mesh>
  lift: number
  open: boolean
  busy: boolean
  lit: boolean
}

type PersonThings = { group: Group; materials: MeshStandardMaterial[]; ring: Mesh; at: Vector3; goal: Vector3; agent: boolean; step: number; shown: boolean }

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
  private camera = new PerspectiveCamera(FOV, 1, 10, 20_000)
  private ground: Mesh
  private streets = new Group()
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
  /** The house the camera was last aimed at (null for the village), so a refresh leaves where you've moved it. */
  private aimed: string | null | undefined = undefined
  private drag: { x: number; y: number; moved: number } | null = null
  /** Each label's size, measured once: placing them reads no layout. */
  private sizes = new WeakMap<HTMLElement, { width: number; height: number }>()
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

    this.scene.add(new HemisphereLight(0xffffff, 0x9a9a8a, 1.4))
    this.scene.add(new AmbientLight(0xffffff, 0.35))
    const sun = new DirectionalLight(0xffffff, 1.6)
    sun.position.set(-900, 1600, 900)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -3000, right: 3000, top: 3000, bottom: -3000, near: 10, far: 6000 })
    sun.shadow.bias = -0.0005
    this.scene.add(sun, sun.target)
    this.sun = sun

    this.ground = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: this.palette.ground, roughness: 1 }))
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground, this.streets)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.scene.background = new Color(this.palette.sky)
    this.scene.fog = new Fog(this.palette.sky, 2000, 6000)
    const canvas = this.renderer.domElement
    canvas.addEventListener('click', this.click)
    canvas.addEventListener('pointerdown', this.press)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.release)
    canvas.addEventListener('pointercancel', this.release)
    canvas.addEventListener('wheel', this.wheel, { passive: false })
    this.loop(performance.now())
  }

  private sun: DirectionalLight

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

  /** Where a resident is now, mid-walk included, for their label. */
  personAt(actor: string): Vector3 | null {
    const person = this.people.get(actor)
    return person?.shown ? person.at.clone().setY(54 * FIGURE_SCALE) : null
  }

  /** Brings the scene to `town`, with `open` the house you're in and `lit` the houses with someone awake. */
  show(town: Town, open: string | null, lit: Set<string>) {
    this.town = town
    this.ground.scale.set(town.width + 4000, town.height + 4000, 1)
    this.ground.position.set(town.width / 2, 0, town.height / 2)
    this.drawStreets(town)
    const seen = new Set<string>()
    for (const house of town.houses) {
      seen.add(house.channel)
      let things = this.houses.get(house.channel)
      if (!things) this.houses.set(house.channel, (things = this.build(house.channel)))
      things.group.position.set(house.x, 0, house.y)
      things.open = house.channel === open
      things.busy = house.busy
      things.lit = lit.has(house.channel)
      things.skylights.color.set(things.lit ? this.palette.lit : this.palette.window)
      things.skylights.emissive.set(things.lit ? this.palette.lit : '#000000')
      this.furnish(things, things.open ? house.tables : [], house.x, house.y)
    }
    for (const [channel, things] of this.houses)
      if (!seen.has(channel)) {
        things.group.removeFromParent()
        dispose(things.group)
        this.houses.delete(channel)
      }

    const here = new Set<string>()
    for (const resident of town.residents) {
      here.add(resident.actor)
      const spot = resident.channel === open ? resident.inside : resident.outside
      let person = this.people.get(resident.actor)
      const goal = new Vector3((spot ?? resident.inside).x + 15, 0, (spot ?? resident.inside).y + 15)
      if (!person || person.agent !== resident.agent) {
        if (person) {
          person.group.removeFromParent()
          dispose(person.group)
        }
        this.people.set(resident.actor, (person = this.figure(resident, goal)))
      }
      person.goal.copy(goal)
      person.shown = spot !== null
      person.group.visible = person.shown
      person.ring.visible = resident.you
      for (const material of person.materials) {
        material.transparent = resident.idle
        material.opacity = resident.idle ? 0.45 : 1
      }
    }
    for (const [actor, person] of this.people)
      if (!here.has(actor)) {
        person.group.removeFromParent()
        dispose(person.group)
        this.people.delete(actor)
      }

    // Only walking in or out moves the camera: a refresh leaves it where you've panned it.
    if (open !== this.aimed) this.aim(town, open)
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
    this.renderer.domElement.remove()
  }

  // --- the camera ---------------------------------------------------------------------------

  private aim(town: Town, open: string | null) {
    const aspect = this.camera.aspect || 1
    // The ground's depth shows foreshortened by the camera's tilt.
    const fit = (width: number, depth: number) => (1.05 * Math.max(width / aspect, depth * Math.sin(TILT) + 120)) / (2 * Math.tan((FOV * Math.PI) / 360))
    const house = open ? town.houses.find((h) => h.channel === open) : undefined
    if (house) {
      this.lookGoal.set(house.x + HOUSE.width / 2, 0, house.y + HOUSE.height / 2 + 20)
      this.distanceGoal = fit(HOUSE.width + 140, HOUSE.height + 180)
    } else {
      const whole = fit(town.width + 80, town.height + 120)
      const near = fit(FAR_HOUSES * LOT.width, FAR_HOUSES * LOT.height * 0.6)
      if (whole <= near) this.lookGoal.set(town.width / 2 + 40, 0, town.height / 2)
      else {
        // Too big to read whole: start over where the most people are, and let them move around.
        const busiest = [...town.houses].sort((a, b) => b.people - a.people || Number(b.busy) - Number(a.busy))[0]!
        this.lookGoal.set(busiest.x + HOUSE.width / 2, 0, busiest.y + HOUSE.height / 2)
      }
      this.distanceGoal = Math.min(whole, near)
    }
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
    this.camera.position.set(this.look.x, this.look.y + Math.sin(TILT) * this.distance, this.look.z + Math.cos(TILT) * this.distance)
    this.camera.lookAt(this.look)
    // The sun's shadows cover what's in view, and the fog hides the village's far edge.
    this.sun.target.position.copy(this.look)
    this.sun.position.copy(this.look).add(new Vector3(-900, 1600, 900))
    const fog = this.scene.fog as Fog
    fog.near = this.distance * 1.3
    fog.far = this.distance * 3

    for (const house of this.houses.values()) {
      const target = house.open ? 1 : 0
      house.lift += (target - house.lift) * (this.still ? 1 : 1 - Math.exp(-dt * 5))
      house.roof.position.y = house.lift * 110
      house.roof.visible = house.lift < 0.98
      for (const material of house.roofMaterials) {
        material.transparent = house.lift > 0.01
        material.opacity = 1 - house.lift
      }
      house.smoke.forEach((puff, i) => {
        puff.visible = house.busy && !house.open
        const t = (now / 2400 + i / house.smoke.length) % 1
        puff.position.y = WALL + 120 + t * 60
        puff.scale.setScalar(0.6 + t)
        ;(puff.material as MeshStandardMaterial).opacity = 0.8 * (1 - t)
      })
    }

    for (const person of this.people.values()) {
      const away = person.goal.clone().sub(person.at).setY(0)
      const far = away.length()
      if (this.still || far < 0.5) {
        person.at.copy(person.goal)
        person.step = 0
      } else {
        person.at.add(away.multiplyScalar(Math.min(1, (PACE * dt) / far)))
        person.step += dt * 12
        person.group.rotation.y = Math.atan2(person.goal.x - person.at.x, person.goal.z - person.at.z)
      }
      if (far < 0.5) person.group.rotation.y += (0 - person.group.rotation.y) * 0.1
      person.group.position.set(person.at.x, Math.abs(Math.sin(person.step)) * 4, person.at.z)
    }

    this.renderer.render(this.scene, this.camera)
    this.place()
  }

  /** Moves each label over its point, or hides it when the point is off the scene. */
  private place() {
    const { clientWidth: width, clientHeight: height } = this.host
    const taken: { left: number; right: number; top: number; bottom: number }[] = []
    // Labels that always show go first, then signs, busiest first.
    const order = [...this.labels.values()].sort((a, b) => (b.rank ?? Infinity) - (a.rank ?? Infinity))
    for (const label of order) {
      const { element } = label
      const at = label.anchor()
      if (!at) {
        element.style.visibility = 'hidden'
        continue
      }
      const p = at.project(this.camera)
      const x = ((p.x + 1) / 2) * width
      const y = ((1 - p.y) / 2) * height
      let shown = !(p.z > 1 || p.x < -1.2 || p.x > 1.2 || p.y < -1.2 || p.y > 1.2)
      if (shown && label.rank !== undefined) {
        // A label hangs above its point, centered on it.
        const size = this.sizeOf(element)
        const box = { left: x - size.width / 2 - 4, right: x + size.width / 2 + 4, top: y - size.height - 2, bottom: y + 2 }
        shown = !taken.some((t) => box.left < t.right && box.right > t.left && box.top < t.bottom && box.bottom > t.top)
        if (shown) taken.push(box)
      }
      element.style.visibility = shown ? 'visible' : 'hidden'
      element.style.transform = `translate(${x}px, ${y}px)`
    }
  }

  private sizeOf(element: HTMLElement) {
    let size = this.sizes.get(element)
    if (!size || size.width === 0) {
      const content = element.firstElementChild as HTMLElement | null
      size = { width: content?.offsetWidth ?? 0, height: content?.offsetHeight ?? 0 }
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
    const perPixel = (2 * this.distance * Math.tan((FOV * Math.PI) / 360)) / this.host.clientHeight
    const shift = new Vector3(-dx * perPixel, 0, (-dy * perPixel) / Math.sin(TILT))
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
      if (!hit.object.visible) continue
      let at: Object3D | null = hit.object
      while (at && !at.userData.thread && !at.userData.house) at = at.parent
      if (at?.userData.thread) return this.onPick({ thread: at.userData.thread })
      if (at?.userData.house) return this.onPick({ house: at.userData.house })
    }
    this.onPick(null)
  }

  // --- building things ----------------------------------------------------------------------

  private drawStreets(town: Town) {
    for (const child of [...this.streets.children]) {
      child.removeFromParent()
      dispose(child)
    }
    const material = new MeshStandardMaterial({ color: this.palette.street, roughness: 1 })
    for (const street of town.streets) {
      const road = new Mesh(new BoxGeometry(town.width + 200, 1, 40), material)
      road.position.set(town.width / 2 - 60, 0.5, street.y + street.rows * LOT.height - 22)
      road.receiveShadow = true
      this.streets.add(road)
    }
  }

  private build(channel: string): HouseThings {
    const { width: w, height: h, wall } = HOUSE
    const p = this.palette
    const group = new Group()
    group.userData.house = channel
    const walls = new MeshStandardMaterial({ color: p.walls, roughness: 0.9 })
    const floor = new Mesh(new BoxGeometry(w - 2 * wall, 2, h - 2 * wall), new MeshStandardMaterial({ color: p.floor, roughness: 1 }))
    floor.position.set(w / 2, 1, h / 2)
    floor.receiveShadow = true
    group.add(floor)
    const door = 52
    const side = (w - door) / 2
    const pieces: [number, number, number, number][] = [
      [w / 2, wall / 2, w, wall], // back
      [wall / 2, h / 2, wall, h], // left
      [w - wall / 2, h / 2, wall, h], // right
      [side / 2, h - wall / 2, side, wall], // front, left of the door
      [w - side / 2, h - wall / 2, side, wall], // front, right of the door
    ]
    for (const [x, z, sx, sz] of pieces) {
      const piece = new Mesh(new BoxGeometry(sx, WALL, sz), walls)
      piece.position.set(x, WALL / 2, z)
      piece.castShadow = true
      piece.receiveShadow = true
      group.add(piece)
    }

    const roof = new Group()
    const color = new Color(p.roofs[roofOf(channel)])
    const slope = new MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, side: DoubleSide })
    const chimneyMaterial = new MeshStandardMaterial({ color: p.walls, roughness: 0.9 })
    const hip = new Mesh(hipRoof(w, h, 12, 96), slope)
    hip.position.y = WALL
    hip.castShadow = true
    roof.add(hip)
    const chimney = new Mesh(new BoxGeometry(26, 60, 26), chimneyMaterial)
    chimney.position.set(w - 110, WALL + 70, h / 2 - 50)
    chimney.castShadow = true
    roof.add(chimney)
    const skylights = new MeshStandardMaterial({ color: p.window, emissiveIntensity: 0.6, roughness: 0.4 })
    for (const x of [w / 2 - 70, w / 2 + 70]) {
      const light = new Mesh(new BoxGeometry(36, 4, 26), skylights)
      // On the near slope, tipped to lie on it.
      light.position.set(x, WALL + 50, h / 2 + 90)
      light.rotation.x = Math.atan2(96, h / 2 + 12)
      roof.add(light)
    }
    group.add(roof)

    const smoke = Array.from({ length: 3 }, () => {
      const puff = new Mesh(new SphereGeometry(9, 10, 8), new MeshStandardMaterial({ color: p.smoke, transparent: true, roughness: 1 }))
      puff.position.set(w - 110, WALL + 120, h / 2 - 50)
      group.add(puff)
      return puff
    })
    this.scene.add(group)
    return { group, roof, roofMaterials: [slope, chimneyMaterial, skylights], skylights, smoke, tables: new Map(), lift: 0, open: false, busy: false, lit: false }
  }

  /** The tables of the house you're in: one per thread the layout gives it. */
  private furnish(house: HouseThings, tables: Town['houses'][number]['tables'], hx: number, hy: number) {
    const keep = new Set(tables.map((t) => t.thread))
    for (const [thread, mesh] of house.tables)
      if (!keep.has(thread)) {
        mesh.removeFromParent()
        dispose(mesh)
        house.tables.delete(thread)
      }
    for (const table of tables) {
      let mesh = house.tables.get(table.thread)
      if (!mesh) {
        mesh = new Mesh(new BoxGeometry(140, 16, 34), new MeshStandardMaterial({ color: this.palette.table, roughness: 0.7 }))
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.userData.thread = table.thread
        house.group.add(mesh)
        house.tables.set(table.thread, mesh)
      }
      mesh.position.set(table.x - hx + 70, 10, table.y - hy + 17)
    }
  }

  /** A person, rounded, or an agent, boxy with an antenna, in a color of their own. */
  private figure(resident: Resident, at: Vector3): PersonThings {
    const group = new Group()
    const tint = new Color().setHSL(hue(resident.actor), 0.45, 0.55)
    const body = new MeshStandardMaterial({ color: tint, roughness: 0.6 })
    const head = new MeshStandardMaterial({ color: resident.agent ? tint.clone().offsetHSL(0, -0.1, 0.2) : new Color('#f1d3b6'), roughness: 0.6 })
    if (resident.agent) {
      const trunk = new Mesh(new BoxGeometry(18, 22, 14), body)
      trunk.position.y = 14
      const top = new Mesh(new BoxGeometry(16, 14, 14), head)
      top.position.y = 34
      const antenna = new Mesh(new BoxGeometry(2, 10, 2), body)
      antenna.position.y = 46
      group.add(trunk, top, antenna)
    } else {
      const trunk = new Mesh(new CapsuleGeometry(8, 14, 4, 12), body)
      trunk.position.y = 16
      const top = new Mesh(new SphereGeometry(8, 16, 12), head)
      top.position.y = 36
      group.add(trunk, top)
    }
    for (const part of group.children) part.castShadow = true
    const ring = new Mesh(new RingGeometry(14, 18, 32), new MeshStandardMaterial({ color: this.palette.bright }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 1
    group.add(ring)
    group.scale.setScalar(FIGURE_SCALE)
    group.position.copy(at)
    this.scene.add(group)
    return { group, materials: [body, head], ring, at: at.clone(), goal: at.clone(), agent: resident.agent, step: 0, shown: true }
  }
}

/** A hipped roof over a `w` by `h` house: four slopes from its eaves, `over` past the walls, up to a ridge `rise` high. */
function hipRoof(w: number, h: number, over: number, rise: number): BufferGeometry {
  const inset = Math.min(h / 2 + over, w / 2 - 20)
  const [a, b, c, d] = [
    [-over, 0, -over],
    [w + over, 0, -over],
    [w + over, 0, h + over],
    [-over, 0, h + over],
  ] as const
  const r1 = [inset - over, rise, h / 2] as const
  const r2 = [w - inset + over, rise, h / 2] as const
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
