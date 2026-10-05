import { Scene, Group, Mesh, Geometry, InstancedMesh, PBRMaterial, NativeMaterial3D, PerspectiveCamera, PointLight, EnvironmentMap, GPUParticleEmitter3D, Vector3, type Game, type Texture, type Renderer } from 'xyz.js';
import { CONTRACT, EVENTS, seededRandom, type Vec3 } from '../show/contract.ts';
import { ShowClock } from '../show/clock.ts';
import { sampleShow, type ShowSample } from '../show/director.ts';
import { BATTLES, battleVisible } from '../show/battles.ts';
import { pose } from './geometry.ts';
import { createPlanetModel, type PlanetModel } from './planet-model.ts';
import { createShipModel, type ShipModel } from './ship-model.ts';
import { createCombatModel, type CombatModel } from './combat-model.ts';
import { createWeaponModel, type WeaponModel } from './weapon-model.ts';
import { createCataclysm, type Cataclysm } from './cataclysm.ts';
import { groundHeight } from './ground.ts';
import { createSurfaceSky } from './sky.ts';
import { cinematicCamera } from './cinema.ts';
import type { SurfaceSky } from './sky.ts';

const HERO = { from: 1, to: 17.5, startAngle: -55 * Math.PI / 180, angularSpeed: 9 * Math.PI / 180, radius: 12.8, scale: .36 };
const EYE_HEIGHT = .003;
const normalize = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

export class ShowScene extends Scene {
  readonly clock = new ShowClock();
  private readonly lens = new PerspectiveCamera();
  private readonly aim = new Vector3();
  private readonly planetGroup = new Group();
  private readonly woundLight = new PointLight({ position: [0, 0, 0], color: [1, .35, .08], intensity: 0, range: 40 });
  private readonly textures: Texture[] = [];
  private readonly geometries: Geometry[] = [];
  private readonly nativeMaterials: NativeMaterial3D[] = [];
  private readonly streams: GPUParticleEmitter3D[] = [];
  private readonly battles: { model: CombatModel; shown: boolean }[] = [];
  private readonly fleetShadowCasters: Mesh[] = [];
  private fleetShadows = true;
  private readonly focusTimes = EVENTS.filter(event => event.kind === 'fire').map(event => event.t);
  private readonly impactPoint: Vec3;
  private readonly woundPoint: Vec3;
  private readonly weaponDirection: Vec3;
  private readonly weaponDistance: number;
  private readonly environmentMap: EnvironmentMap;
  private renderer?: Renderer;
  private planet?: PlanetModel;
  private ship?: ShipModel;
  private weapon?: WeaponModel;
  private cataclysm?: Cataclysm;
  private sky?: SurfaceSky;
  private appliedCrack = -1;
  private rebuilding = Promise.resolve();
  private released = false;
  private prepared = false;
  hdr = false;

  constructor(private readonly onFrame: (sample: ShowSample) => void) {
    super();
    this.lens.near = CONTRACT.camera.near; this.lens.far = CONTRACT.camera.far;
    this.camera3D = this.lens;
    const sun = new Vector3(...CONTRACT.visual.lightDirection).normalize();
    this.directionalLight = { direction: sun, color: [1, .92, .81], intensity: 3.1 };
    this.environmentMap = EnvironmentMap.gradient({ width: CONTRACT.visual.environmentWidth,
      zenith: [.045, .065, .105], horizon: [.15, .2, .28], ground: [.013, .018, .028],
      sun: { direction: [sun.x, sun.y, sun.z], color: [10, 9.2, 8.1], radius: .045 } });
    this.environment = this.environmentMap; this.environmentIntensity = .45;
    this.ambientLight = .025;
    this.shadows.enabled = true; this.shadows.cascades = 1;
    this.shadows.mapSize = CONTRACT.visual.shadowMapSize; this.shadows.extent = 38;
    this.shadows.near = .1; this.shadows.far = 150; this.shadows.bias = .00035;
    this.pointLights.push(this.woundLight);
    this.planetGroup.rotation.setFromEuler(...CONTRACT.visual.planetRotation);
    this.add(this.planetGroup);
    // The wound and beam target follow the planet's fixed orientation exactly.
    const damage = normalize(CONTRACT.visual.damageDirection), radius = CONTRACT.planet.radius;
    this.impactPoint = this.rotate(damage[0] * radius, damage[1] * radius, damage[2] * radius);
    this.woundPoint = this.rotate(damage[0] * (radius - 1.2), damage[1] * (radius - 1.2), damage[2] * (radius - 1.2));
    const weapon = CONTRACT.scene.weaponPosition;
    const toTarget = [this.impactPoint[0] - weapon[0], this.impactPoint[1] - weapon[1], this.impactPoint[2] - weapon[2]] as const;
    this.weaponDistance = Math.hypot(...toTarget);
    this.weaponDirection = normalize(toTarget);
    this.applyCamera(sampleShow(0));
  }

  /** Planet-group orientation applied to a local point. */
  private rotate(x: number, y: number, z: number): Vec3 {
    const q = this.planetGroup.rotation;
    const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
    return [x + q.w * tx + q.y * tz - q.z * ty, y + q.w * ty + q.z * tx - q.x * tz, z + q.w * tz + q.x * ty - q.y * tx];
  }

  /** Radius at which the ground camera clears the actual displaced terrain beneath it. */
  private measureGround(position: Vec3): number {
    const q = this.planetGroup.rotation;
    const [x, y, z] = normalize(position);
    // Inverse rotation of the world-space ground direction into the planet's local frame.
    const tx = -2 * (q.y * z - q.z * y), ty = -2 * (q.z * x - q.x * z), tz = -2 * (q.x * y - q.y * x);
    const lx = x + q.w * tx - q.y * tz + q.z * ty, ly = y + q.w * ty - q.z * tx + q.x * tz, lz = z + q.w * tz - q.x * ty + q.y * tx;
    const height = groundHeight(lx, ly, lz);
    return CONTRACT.planet.radius + height + EYE_HEIGHT;
  }

  override async preload(game: Game, signal: AbortSignal): Promise<void> {
    if (this.prepared) return;
    this.renderer = game.graphics;
    if (!game.graphics.capabilities.threeD || game.graphics.backend === 'canvas2d') throw new Error('此瀏覽器無法演出 3D');
    this.hdr = game.graphics.backend === 'webgpu' || !!game.canvas.getContext('webgl2')?.getExtension('EXT_color_buffer_float');
    const post = this.postProcessing;
    post.enabled = this.hdr; post.toneMapping = 'aces'; post.exposure = .86;
    post.bloomStrength = .12; post.bloomThreshold = 1.5; post.bloomRadius = 3;
    post.fxaa = this.hdr; this.transparency = 'sorted';
    const [planet, ship] = await Promise.all([createPlanetModel(), createShipModel()]);
    this.planet = planet; this.ship = ship;
    this.planetGroup.add(planet.root); this.add(ship.root);
    this.textures.push(...planet.textures, ...ship.textures);
    this.geometries.push(...planet.geometries, ...ship.geometries);
    for (const node of planet.root.children) if (node instanceof Mesh && node.material instanceof NativeMaterial3D) this.nativeMaterials.push(node.material);
    for (const battle of BATTLES) {
      const model = await createCombatModel(ship, battle.script);
      this.add(model.root);
      for (const light of model.lights) this.pointLights.push(light);
      this.geometries.push(...model.geometries); this.nativeMaterials.push(...model.nativeMaterials);
      this.battles.push({ model, shown: true });
      const pending = [...model.root.children];
      while (pending.length) {
        const node = pending.pop()!;
        if (node instanceof Mesh && node.castShadow) this.fleetShadowCasters.push(node);
        pending.push(...node.children);
      }
    }
    const weapon = await createWeaponModel(ship);
    this.weapon = weapon; this.add(weapon.root);
    for (const light of weapon.lights) this.pointLights.push(light);
    this.textures.push(...weapon.textures); this.geometries.push(...weapon.geometries); this.nativeMaterials.push(...weapon.nativeMaterials);
    weapon.root.position.set(...CONTRACT.scene.weaponPosition);
    {
      // Local +Z fires: rotate it onto the beam direction.
      const [dx, dy, dz] = this.weaponDirection;
      weapon.root.rotation.set(-dy, dx, 0, 1 + dz).normalize();
    }
    const white = ship.textures[4]!;
    const sky = createSurfaceSky(white); this.sky = sky; this.add(sky.mesh);
    this.geometries.push(sky.geometry); this.nativeMaterials.push(sky.material);
    const cataclysm = await createCataclysm(game.graphics, white, CONTRACT.scene.peakTime - CONTRACT.scene.breakupTime);
    this.cataclysm = cataclysm; this.add(cataclysm.root); this.pointLights.push(cataclysm.light);
    this.textures.push(...cataclysm.textures); this.geometries.push(...cataclysm.geometries); this.nativeMaterials.push(...cataclysm.nativeMaterials);
    const starsGeometry = Geometry.sphere(1, 6, 4); this.geometries.push(starsGeometry);
    const stars = this.add(new InstancedMesh({ geometry: starsGeometry, material: new PBRMaterial({ texture: white, color: [.4, .5, .7], emissive: [.6, .8, 1.2] }), count: CONTRACT.visual.stars }));
    const random = seededRandom(CONTRACT.seed);
    for (let i = 0; i < stars.count; i++) {
      const y = random() * 2 - 1, angle = random() * Math.PI * 2, r = Math.sqrt(1 - y * y), size = .018 + random() * .025;
      stars.setMatrixAt(i, pose(Math.cos(angle) * r * 180, y * 180, Math.sin(angle) * r * 180, size, size, size));
    }
    if (signal.aborted || this.released) { this.releaseResources(); throw new DOMException('Aborted', 'AbortError'); }
    await Promise.all([game.graphics.prepareTextures(this.textures), ...this.geometries.map(geometry => game.graphics.prepareGeometry(geometry)),
      ...this.nativeMaterials.map(material => game.graphics.prepareMaterial(material))]);
    await this.buildStreams();
    if (signal.aborted || this.released) throw new DOMException('Aborted', 'AbortError');
    this.planet?.reset(); this.weapon?.reset();
    this.apply(sampleShow(0));
    this.prepared = true;
  }

  /** Three exhaust plumes follow the hero hull in its own frame. */
  private async buildStreams(): Promise<void> {
    const renderer = this.renderer, ship = this.ship;
    if (!renderer?.prepareGpuParticles || !ship) throw new Error('渲染器不支援 GPU 粒子預載');
    for (const stream of this.streams) { ship.root.remove(stream); stream.destroy(); }
    this.streams.length = 0;
    for (let nozzle = 0; nozzle < 3; nozzle++) {
      const warm = nozzle === 1;
      const stream = new GPUParticleEmitter3D({ capacity: CONTRACT.visual.engineParticles.capacity, rate: CONTRACT.visual.engineParticles.rate,
        lifetime: CONTRACT.visual.engineParticles.lifetime, seed: CONTRACT.seed + nozzle * 101, space: 'local',
        velocityMin: [-.025, -.025, 4.8], velocityMax: [.025, .025, 7.6], gravity: [0, 0, 0],
        startColor: warm ? [1, .62, .24, .12] : [.32, .68, 1, .1], endColor: warm ? [.65, .18, .04, 0] : [.04, .2, .5, 0],
        startSize: .035, endSize: .006 });
      stream.position.set((nozzle - 1) * .81, -.02, 4.95);
      try { await renderer.prepareGpuParticles(stream); } catch (error) { stream.destroy(); throw error; }
      if (this.released) { stream.destroy(); return; }
      ship.root.add(stream); this.streams.push(stream);
    }
  }

  override update(delta: number): void {
    if (!this.prepared) return;
    const t = this.clock.advance(delta, document.hidden);
    const sample = sampleShow(t); this.apply(sample); this.onFrame(sample);
  }

  private applyCamera(sample: ShowSample): void {
    let [x, y, z] = sample.camera.position;
    const { surfaceStart, surfaceEnd } = CONTRACT.scene;
    this.lens.near = sample.t >= surfaceStart && sample.t < surfaceEnd ? .0003 : CONTRACT.camera.near;
    if (sample.t >= surfaceStart && sample.t < surfaceEnd) {
      // The ground camera rides the true terrain surface, not a flat sphere.
      const scale = this.measureGround(sample.camera.position) / (Math.hypot(x, y, z) || 1); x *= scale; y *= scale; z *= scale;
    }
    const shot = cinematicCamera(sample.t, [x, y, z], sample.camera.target, sample.camera.fov, sample.t >= surfaceStart && sample.t < surfaceEnd);
    this.lens.position.set(...shot.position); this.aim.set(...shot.target);
    this.lens.fov = shot.fov * Math.PI / 180; this.lens.lookAt(this.aim);
    // Roll about the view axis, applied after lookAt: q * (0, 0, sin(r/2), cos(r/2)).
    const q = this.lens.rotation, s = Math.sin(shot.roll / 2), c = Math.cos(shot.roll / 2);
    q.set(q.x * c + q.y * s, q.y * c - q.x * s, q.z * c + q.w * s, q.w * c - q.z * s);
  }

  private apply(sample: ShowSample): void {
    this.applyCamera(sample);
    const planet = this.planet, ship = this.ship, weapon = this.weapon, cataclysm = this.cataclysm;
    if (!planet || !ship || !weapon || !cataclysm) return;
    const t = sample.t, scene = CONTRACT.scene, releaseAge = t - scene.breakupTime;
    // Distant orbital hulls have no readable projected shadow in the planet-close shot.
    const fleetShadows = t < scene.impactTime;
    if (fleetShadows !== this.fleetShadows) {
      for (const mesh of this.fleetShadowCasters) mesh.castShadow = fleetShadows;
      this.fleetShadows = fleetShadows;
    }
    const air = this.sky?.update(this.lens.position, t < scene.breakupTime) ?? 0;
    this.fog.enabled = air > 0; this.fog.mode = 'exp2'; this.fog.density = air * .003; this.fog.color = [.43, .55, .66];
    this.environmentIntensity = .45 + air * .2;
    this.postProcessing.exposure = .72 + Math.min(sample.brightness, 2.5) * .14;
    // Planet: wounded crust until release, then the authored breakup.
    if (releaseAge < 0) {
      if (sample.crack !== this.appliedCrack) { planet.setDamage(sample.crack); this.appliedCrack = sample.crack; }
    } else planet.setBreakup(releaseAge);
    planet.setSurfaceView(air > .5);
    const wound = t >= scene.impactTime && t < scene.breakupTime;
    this.woundLight.position.set(...this.woundPoint);
    this.woundLight.intensity = wound ? 4.5 * Math.min(1, (t - scene.impactTime) / 3) + 14 * Math.exp(-(t - scene.impactTime) / .35) : 0;
    cataclysm.update(releaseAge);
    // Hero hull: a close orbital pass in front of the planet during the opening.
    const hero = t >= HERO.from && t < HERO.to;
    ship.root.visible = hero;
    if (hero) {
      const span = (t - HERO.from) / (HERO.to - HERO.from);
      const phi = HERO.startAngle + HERO.angularSpeed * (t - HERO.from);
      ship.root.position.set(Math.sin(phi) * HERO.radius, 3.2 + Math.sin(span * Math.PI) * .8, Math.cos(phi) * HERO.radius);
      ship.root.scale.set(HERO.scale, HERO.scale, HERO.scale);
      ship.root.rotation.setFromEuler(.06 * Math.sin(span * 5), Math.atan2(-Math.cos(phi), Math.sin(phi)), -.1 + .06 * Math.sin(span * 7));
    }
    for (let i = 0; i < BATTLES.length; i++) {
      const battle = BATTLES[i]!, entry = this.battles[i]!, shown = battleVisible(battle, t);
      if (shown) entry.model.update(t - battle.start, Math.max(0, releaseAge));
      else if (entry.shown) { entry.model.root.visible = false; for (const light of entry.model.lights) light.intensity = 0; }
      entry.model.root.visible = shown; entry.shown = shown;
    }
    const armed = t >= scene.countdownStart;
    weapon.root.visible = armed;
    if (armed) {
      let pulse = 0;
      for (const focus of this.focusTimes) if (t >= focus && t < focus + 2) pulse = Math.max(pulse, Math.exp(-(t - focus) * 2.2));
      weapon.update({ charge: sample.weaponCharge, pulse, beam: t >= scene.impactTime ? t - scene.impactTime : 0,
        beamLength: this.weaponDistance - weapon.apertureDistance });
    }
  }

  /** Rewinds every authored state; seeded dust and plume emitters are rebuilt before they are next needed. */
  reset(): void {
    this.clock.reset();
    this.appliedCrack = -1;
    this.planet?.reset(); this.weapon?.reset();
    for (const entry of this.battles) entry.shown = true;
    const sample = sampleShow(0);
    this.apply(sample);
    if (this.prepared) {
      this.rebuilding = this.rebuilding.then(async () => { await this.cataclysm?.reset(); await this.buildStreams(); });
    } else {
      this.rebuilding = this.rebuilding.then(() => this.buildStreams());
    }
  }

  dispose(): void { if (this.released) return; this.released = true; this.destroy(); }
  protected override onDestroy(): void { this.released = true; this.releaseResources(); }

  private releaseResources(): void {
    for (const stream of this.streams) stream.destroy();
    this.streams.length = 0;
    for (const entry of this.battles) entry.model.dispose();
    this.weapon?.dispose(); this.cataclysm?.dispose();
    for (const material of this.nativeMaterials) material.destroy();
    for (const geometry of this.geometries) this.renderer?.unloadGeometry(geometry);
    for (const texture of this.textures) { this.renderer?.unloadTexture(texture); if (!texture.destroyed) texture.destroy(); }
    this.textures.length = 0; this.geometries.length = 0; this.nativeMaterials.length = 0;
    this.environmentMap.destroy();
  }
}
