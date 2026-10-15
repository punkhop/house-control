// Light fixtures: a small model, the real three.js light(s) it drives and the
// animation that eases both towards the device state.
import * as THREE from 'three';
import { box, cyl, mat, at } from './kit.js';

const STOPS = [
  [2200, new THREE.Color('#ff9438')],
  [3000, new THREE.Color('#ffbd7a')],
  [4200, new THREE.Color('#ffe2c2')],
  [6500, new THREE.Color('#dfe9ff')],
];

export function tempToColor(kelvin, out = new THREE.Color()) {
  const k = Math.min(6500, Math.max(2200, kelvin));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [k0, c0] = STOPS[i];
    const [k1, c1] = STOPS[i + 1];
    if (k <= k1) return out.copy(c0).lerp(c1, (k - k0) / (k1 - k0));
  }
  return out.copy(STOPS[STOPS.length - 1][1]);
}

export function lightColor(state, out = new THREE.Color()) {
  return state.color ? out.set(state.color) : tempToColor(state.temp, out);
}

const DARK = '#23262e';

function glowMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#8d8f96', roughness: 0.6, emissive: '#000000', emissiveIntensity: 1 });
}

function spot(intensity, y) {
  const light = new THREE.SpotLight(0xffffff, 0, 0, 1.2, 0.75, 2);
  light.position.set(0, y, 0);
  light.target.position.set(0, y - 1, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.15;
  light.shadow.camera.far = 9;
  light.shadow.bias = -0.0006;
  light.shadow.normalBias = 0.03;
  light.shadow.radius = 5;
  light.userData.max = intensity;
  return light;
}

function point(intensity, y, { shadow = true, distance = 0, x = 0, z = 0 } = {}) {
  const light = new THREE.PointLight(0xffffff, 0, distance, 2);
  light.position.set(x, y, z);
  if (shadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.08;
    light.shadow.camera.far = 9;
    light.shadow.bias = -0.003;
    light.shadow.normalBias = 0.03;
    light.shadow.radius = 4;
  }
  light.userData.max = intensity;
  return light;
}

// Each fixture: { parts: Mesh[], glow: Mesh[] (emissive when on), lights: Light[], hit: [w, h, d, y] }
const fixtures = {
  ceiling(cfg, H) {
    const y = cfg.y ?? H - 0.14;
    return {
      parts: [at(cyl(0.012, 0.012, H - y - 0.05, mat(DARK), 8), 0, y + 0.05, 0)],
      glow: [at(cyl(0.27, 0.27, 0.055, glowMaterial(), 40), 0, y, 0)],
      lights: [spot(cfg.intensity ?? 20, y - 0.02)],
      hit: [0.75, 0.5, 0.75, y],
    };
  },

  // One switch can run several globes: `globes` lists each one's [x, z] offset.
  pendant(cfg, H) {
    const y = cfg.y ?? 1.8;
    const offsets = cfg.globes || [[0, 0]];
    const parts = [];
    const glow = [];
    const lights = [];
    for (const [x, z] of offsets) {
      const globe = new THREE.Mesh(new THREE.SphereGeometry(cfg.radius ?? 0.17, 32, 20), glowMaterial());
      globe.position.set(x, y, z);
      glow.push(globe);
      parts.push(
        at(cyl(0.006, 0.006, H - y - 0.15, mat(DARK), 6), x, y + 0.15, z),
        at(cyl(0.04, 0.05, 0.05, mat(DARK, { rough: 0.4, metal: 0.6 }), 16), x, y + 0.14, z),
      );
      const l = spot((cfg.intensity ?? 9) / offsets.length, y - 0.05);
      if (offsets.length > 2 && lights.length) l.castShadow = false; // a chandelier: one shadow
      l.position.x = x; l.position.z = z;
      l.target.position.set(x, y - 1.05, z);
      lights.push(l);
    }
    const xs = offsets.map((o) => o[0]);
    const zs = offsets.map((o) => o[1]);
    return {
      parts, glow, lights,
      hit: [0.6 + Math.max(...xs) - Math.min(...xs), 0.7, 0.6 + Math.max(...zs) - Math.min(...zs), y],
    };
  },

  spots(cfg, H) {
    const y = cfg.y ?? H - 0.16;
    const glow = [-0.32, 0, 0.32].map((x) => at(cyl(0.055, 0.045, 0.1, glowMaterial(), 20), x, y - 0.06, 0));
    return {
      parts: [at(box(0.95, 0.03, 0.05, mat(DARK, { rough: 0.5 }), { r: 0.01 }), 0, y + 0.05, 0)],
      glow,
      lights: [spot(cfg.intensity ?? 20, y - 0.08)],
      hit: [1.1, 0.45, 0.5, y],
    };
  },

  // Recessed downlights flush with the ceiling: `cans` lists each one's [x, z] offset.
  // `y` mounts them lower (puck lights under a cabinet), `radius` sizes the trim.
  cans(cfg, H) {
    const top = cfg.y ?? H;
    const y = top - 0.012;
    const r = cfg.radius ?? 0.085;
    const offsets = cfg.cans || [[0, 0]];
    const trim = mat('#e9e8e4', { rough: 0.5 });
    const parts = offsets.map(([x, z]) => at(cyl(r, r, 0.008, trim, 28), x, top - 0.008, z));
    const glow = offsets.map(([x, z]) => at(cyl(r * 0.76, r * 0.76, 0.006, glowMaterial(), 28), x, y - 0.003, z));
    const xs = offsets.map((o) => o[0]);
    const zs = offsets.map((o) => o[1]);
    // One beam per can, sharing the switch's brightness; only the first casts shadows.
    const lights = offsets.map(([x, z], i) => {
      const l = spot((cfg.intensity ?? 20) / Math.sqrt(offsets.length), y - 0.02);
      if (i) l.castShadow = false;
      l.position.x = x; l.position.z = z;
      l.target.position.set(x, y - 1.02, z);
      return l;
    });
    return {
      parts, glow, lights,
      hit: [0.4 + Math.max(...xs) - Math.min(...xs), 0.3, 0.4 + Math.max(...zs) - Math.min(...zs), y - 0.1],
    };
  },

  // A flush-mount dome: a shallow glowing bowl tight to the ceiling.
  dome(cfg, H) {
    const y = H - 0.02;
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glowMaterial());
    bowl.scale.y = 0.5;
    bowl.position.y = y;
    return {
      parts: [at(cyl(0.21, 0.21, 0.02, mat('#e9e8e4', { rough: 0.5 }), 32), 0, y, 0)],
      glow: [bowl],
      lights: [spot(cfg.intensity ?? 20, y - 0.12)],
      hit: [0.5, 0.3, 0.5, y - 0.1],
    };
  },

  // A switch that drives other fixtures (a vanity bar's bulbs): draws nothing itself;
  // its members point their hit areas at it.
  group() {
    return { parts: [], glow: [], lights: [], hit: [0.01, 0.01, 0.01, 1.9] };
  },

  floor(cfg) {
    const shade = cyl(0.14, 0.19, 0.3, glowMaterial(), 32);
    return {
      parts: [
        at(cyl(0.15, 0.16, 0.025, mat(DARK, { rough: 0.4, metal: 0.5 })), 0, 0, 0),
        at(cyl(0.011, 0.011, 1.3, mat(DARK, { rough: 0.4, metal: 0.5 }), 8), 0, 0.02, 0),
      ],
      glow: [at(shade, 0, 1.28, 0)],
      lights: [point(cfg.intensity ?? 3.4, 1.46)],
      hit: [0.6, 1.7, 0.6, 0.85],
    };
  },

  table(cfg) {
    const y = cfg.y ?? 0.5;
    return {
      parts: [
        at(cyl(0.065, 0.075, 0.02, mat(DARK, { rough: 0.4, metal: 0.5 })), 0, y, 0),
        at(cyl(0.01, 0.01, 0.18, mat(DARK, { rough: 0.4, metal: 0.5 }), 8), 0, y + 0.02, 0),
      ],
      glow: [at(cyl(0.085, 0.125, 0.17, glowMaterial(), 28), 0, y + 0.18, 0)],
      lights: [point(cfg.intensity ?? 1.5, y + 0.3)],
      hit: [0.5, 0.6, 0.5, y + 0.2],
    };
  },

  // A smart plug or switch that runs something other than a lamp (a fan, an air
  // conditioner): it shows it is on, but lights nothing.
  plug(cfg) {
    const y = cfg.y ?? 0.35;
    return {
      parts: [at(box(0.16, 0.2, 0.08, mat('#d9dce3', { rough: 0.5 }), { r: 0.02 }), 0, y, 0)],
      glow: [at(cyl(0.035, 0.035, 0.012, glowMaterial(), 20), 0, y + 0.13, 0)],
      lights: [],
      hit: [0.45, 0.55, 0.45, y + 0.1],
    };
  },

  // An LED strip: a straight run `length` long, or a bent one through `points` ([x, z]
  // offsets, e.g. an L under two counters); `runs` lists several such runs on one switch.
  strip(cfg) {
    const y = cfg.y ?? 1;
    const runs = cfg.runs || [cfg.points || [[-(cfg.length ?? 1) / 2, 0], [(cfg.length ?? 1) / 2, 0]]];
    const pts = runs.flat();
    const glow = [];
    const lights = [];
    let total = 0;
    for (const run of runs) for (let i = 0; i < run.length - 1; i++) {
      const [x0, z0] = run[i];
      const [x1, z1] = run[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      total += len;
      const bar = at(box(len, 0.022, 0.022, glowMaterial(), { r: 0.008 }), (x0 + x1) / 2, y - 0.011, (z0 + z1) / 2);
      bar.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      glow.push(bar);
      const n = Math.max(1, Math.round(len));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        lights.push(point(1, y, { shadow: false, distance: 3.2, x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t }));
      }
    }
    for (const l of lights) l.userData.max = (cfg.intensity ?? 1.6) / lights.length;
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    return {
      parts: [], glow, lights,
      hit: [Math.max(...xs) - Math.min(...xs) + 0.3, 0.4, Math.max(...zs) - Math.min(...zs) + 0.3, y],
    };
  },

  // A fan on a smart plug, standing on the floor or (with `y`) on a table top; `small`
  // draws a little desk fan. Shows it is on, lights nothing.
  fan(cfg) {
    const y = cfg.y ?? 0;
    const k = cfg.small ? 0.62 : 1;
    const black = mat(cfg.color ?? '#16171b', { rough: 0.6 });
    const hy = y + 0.2 * k;
    const rim = at(new THREE.Mesh(new THREE.TorusGeometry(0.13 * k, 0.012, 8, 28), black), 0, hy, 0.02);
    const hub = at(cyl(0.035 * k, 0.035 * k, 0.05, black, 16), 0, hy, 0);
    hub.rotation.x = Math.PI / 2;
    hub.position.y = hy;
    const blades = [0, 1, 2].map((i) => {
      const b = at(box(0.2 * k, 0.07 * k, 0.008, mat('#2a2c31', { rough: 0.5 }), { r: 0.02 }), 0, hy, 0.01);
      b.geometry.translate(0.1 * k, 0, 0);
      b.position.y = hy;
      b.rotation.z = (i * Math.PI * 2) / 3;
      return b;
    });
    const base = [at(cyl(0.1 * k, 0.12 * k, 0.04 * k, black, 20), 0, y, 0), at(cyl(0.018 * k, 0.018 * k, 0.14 * k, black, 8), 0, y + 0.04 * k, 0)];
    return {
      parts: [...base, hub, ...blades, rim],
      glow: [at(cyl(0.012, 0.012, 0.01, glowMaterial(), 12), 0, hy, 0.03)],
      lights: [],
      hit: [0.4 * k, 0.45 * k, 0.4 * k, hy],
    };
  },

  // A ceiling exhaust fan: a square white grille flush with the ceiling.
  exhaust(cfg, H) {
    const y = cfg.y ?? H - 0.01;
    const white = mat('#e8e6e1', { rough: 0.5 });
    const slats = [];
    for (let i = -3; i <= 3; i++) slats.push(at(box(0.22, 0.012, 0.008, mat('#9a9890', { rough: 0.6 }), { r: 0 }), 0, y - 0.022, i * 0.03));
    return {
      parts: [at(box(0.3, 0.02, 0.3, white, { r: 0.006 }), 0, y - 0.02, 0), ...slats],
      glow: [at(box(0.24, 0.004, 0.24, glowMaterial(), { r: 0 }), 0, y - 0.016, 0)],
      lights: [],
      hit: [0.45, 0.2, 0.45, y - 0.05],
    };
  },

  // A floor stick light (Govee H6076): a slim glowing bar on a small round base.
  stick(cfg) {
    const h = cfg.height ?? 1.4;
    return {
      parts: [at(cyl(0.11, 0.12, 0.025, mat(DARK, { rough: 0.4, metal: 0.4 }), 24), 0, 0, 0)],
      glow: [at(box(0.045, h, 0.045, glowMaterial(), { r: 0.018 }), 0, 0.025, 0)],
      lights: [point(cfg.intensity ?? 2.4, h * 0.6, { x: 0, z: 0.08 })],
      hit: [0.4, h + 0.1, 0.4, h / 2],
    };
  },

  // A studio softbox on a tripod: a big glowing octagon facing +z.
  softbox(cfg) {
    const y = cfg.y ?? 1.55;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 8), glowMaterial());
    face.rotation.x = Math.PI / 2;
    face.position.set(0, y, 0.12);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.1, 0.24, 8), mat('#1b1c21', { rough: 0.7 }));
    shell.rotation.x = -Math.PI / 2;
    shell.position.set(0, y, 0);
    const legsOut = [0, 1, 2].map((i) => {
      const leg = at(cyl(0.008, 0.008, y - 0.1, mat(DARK, { metal: 0.5 }), 6), 0, 0, 0);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25);
      leg.lookAt(0, y, 0);
      leg.rotateX(Math.PI / 2);
      return leg;
    });
    return {
      parts: [shell, at(cyl(0.012, 0.012, y - 0.1, mat(DARK, { metal: 0.5 }), 8), 0, 0.1, 0), ...legsOut],
      glow: [face],
      lights: [spot(cfg.intensity ?? 8, y)],
      hit: [0.9, y + 0.5, 0.6, y / 2 + 0.2],
    };
  },

  // One bulb of a vanity bar: a small globe on a wall plate, backing onto the wall at -z.
  bulb(cfg) {
    const y = cfg.y ?? 1.83;
    return {
      parts: [at(box(0.07, 0.07, 0.02, mat('#b9b4aa', { rough: 0.3, metal: 0.8 }), { r: 0.006 }), 0, y - 0.035, 0.01)],
      glow: [at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), glowMaterial()), 0, y, 0.07)],
      lights: [point(cfg.intensity ?? 0.5, y, { shadow: false, distance: 2.5, z: 0.12 })],
      hit: [0.2, 0.25, 0.25, y],
    };
  },

  // A wall lantern (a porch light): a backplate on the wall and a glowing box facing +z.
  // `globe` draws a glass ball on a brass arm instead.
  sconce(cfg) {
    const y = cfg.y ?? 1.9;
    const frame = mat(DARK, { rough: 0.4, metal: 0.5 });
    if (cfg.globe) {
      const brass = mat('#b08d57', { rough: 0.35, metal: 0.8 });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 20), glowMaterial());
      ball.position.set(0, y, 0.2);
      return {
        parts: [
          at(box(0.03, 0.14, 0.02, brass, { r: 0.005 }), 0, y - 0.07, 0.01),
          at(box(0.015, 0.015, 0.2, brass, { r: 0.004 }), 0, y - 0.0075, 0.1),
        ],
        glow: [ball],
        lights: [point(cfg.intensity ?? 1.6, y, { distance: 6, z: 0.2 })],
        hit: [0.35, 0.35, 0.45, y],
      };
    }
    return {
      parts: [
        at(box(0.12, 0.2, 0.02, frame, { r: 0.006 }), 0, y - 0.1, 0.01),
        at(box(0.17, 0.02, 0.17, frame, { r: 0.004 }), 0, y + 0.13, 0.08),
        at(box(0.13, 0.015, 0.13, frame, { r: 0.004 }), 0, y - 0.135, 0.08),
      ],
      glow: [at(box(0.12, 0.25, 0.12, glowMaterial(), { r: 0.01 }), 0, y - 0.125, 0.08)],
      lights: [point(cfg.intensity ?? 1.2, y, { distance: 5, z: 0.2 })],
      hit: [0.3, 0.45, 0.35, y],
    };
  },

  // A star projector (Govee H6093): a round foot, two side arms, a ball head tipped up with its lens glowing.
  starProjector(cfg) {
    const y = cfg.y ?? 0;
    const black = mat(DARK, { rough: 0.5 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 28, 18), black);
    head.position.set(0, y + 0.13, 0);
    const lens = cyl(0.04, 0.04, 0.012, glowMaterial(), 24);
    lens.rotation.x = Math.PI / 2 - 0.6;
    lens.position.set(0, y + 0.13 + 0.07 * Math.sin(0.6), 0.07 * Math.cos(0.6));
    return {
      parts: [
        at(cyl(0.09, 0.09, 0.012, black, 28), 0, y, 0),
        at(box(0.012, 0.13, 0.04, black, { r: 0.004 }), -0.082, y + 0.012, 0),
        at(box(0.012, 0.13, 0.04, black, { r: 0.004 }), 0.082, y + 0.012, 0),
        head,
      ],
      glow: [lens],
      lights: [point(cfg.intensity ?? 1.2, y + 0.3, { z: 0.1 })],
      hit: [0.3, 0.3, 0.3, y + 0.12],
    };
  },

  // A star-shaped lamp: a five-point star standing up, glowing.
  star(cfg) {
    const y = cfg.y ?? 0.5;
    const r = cfg.size ?? 0.22;
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const k = i % 2 ? r * 0.45 : r;
      if (i) shape.lineTo(Math.cos(a) * k, Math.sin(a) * k); else shape.moveTo(Math.cos(a) * k, Math.sin(a) * k);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    geo.translate(0, 0, -0.03);
    const star = new THREE.Mesh(geo, glowMaterial());
    star.position.set(0, y + r, 0);
    return {
      parts: [],
      glow: [star],
      lights: [point(cfg.intensity ?? 1.5, y + r, { z: 0.15 })],
      hit: [r * 2 + 0.1, r * 2 + 0.1, 0.3, y + r],
    };
  },
};

const tmp = new THREE.Color();

export class LightUnit {
  constructor(cfg, H) {
    this.cfg = cfg;
    this.id = cfg.id;
    const f = fixtures[cfg.type](cfg, H);

    this.group = new THREE.Group();
    this.group.position.set(cfg.pos[0], 0, cfg.pos[1]);
    this.group.rotation.y = THREE.MathUtils.degToRad(cfg.rot || 0);

    this.model = new THREE.Group();
    this.pivotY = f.hit[3];
    this.model.position.y = this.pivotY;
    for (const m of [...f.parts, ...f.glow]) {
      m.position.y -= this.pivotY;
      m.castShadow = false;
      m.receiveShadow = false;
      this.model.add(m);
    }
    this.group.add(this.model);

    this.glow = f.glow.map((m) => m.material);
    this.lights = f.lights;
    for (const l of this.lights) {
      this.group.add(l);
      if (l.target) this.group.add(l.target);
    }

    const [hw, hh, hd, hy] = f.hit;
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), new THREE.MeshBasicMaterial());
    this.hit.position.y = hy;
    this.hit.visible = false;
    this.hit.userData = { kind: 'light', id: cfg.group || cfg.id };
    this.group.add(this.hit);

    this.level = 0;        // eased 0..1 output
    this.goal = 0;
    this.color = new THREE.Color('#ffbd7a');
    this.goalColor = this.color.clone();
    this.hover = 0;
    this.hoverGoal = 0;
    this.pulse = 0;
    this.delay = 0;
    this.write();
  }

  // Anchor used for tooltips.
  anchor(out) {
    return out.set(0, this.pivotY + 0.25, 0).applyMatrix4(this.group.matrixWorld);
  }

  apply(state, { instant = false, delay = 0 } = {}) {
    const dimmable = this.cfg.capabilities.includes('brightness');
    this.goal = state.on ? (dimmable ? state.brightness : 1) : 0;
    lightColor(state, this.goalColor);
    this.delay = delay;
    if (instant) {
      this.level = this.goal;
      this.color.copy(this.goalColor);
      this.write();
    } else if (this.level < 0.01) {
      this.color.copy(this.goalColor); // nothing visible yet: no need to fade the hue
    }
  }

  bump() { this.pulse = 1; }

  update(dt) {
    if (this.delay > 0) { this.delay -= dt; return true; }
    const k = 1 - Math.exp(-dt * (this.goal > this.level ? 7 : 5));
    const dl = this.goal - this.level;
    const dh = this.hoverGoal - this.hover;
    const dc = Math.abs(this.color.r - this.goalColor.r) + Math.abs(this.color.g - this.goalColor.g)
      + Math.abs(this.color.b - this.goalColor.b);
    const moving = Math.abs(dl) > 0.002 || Math.abs(dh) > 0.004 || dc > 0.004 || this.pulse > 0.004;
    if (!moving) {
      if (this.level !== this.goal || this.hover !== this.hoverGoal || this.pulse !== 0) {
        this.level = this.goal; this.hover = this.hoverGoal; this.pulse = 0;
        this.color.copy(this.goalColor);
        this.write();
        return true;
      }
      return false;
    }
    this.level += dl * k;
    this.hover += dh * (1 - Math.exp(-dt * 14));
    this.pulse *= Math.exp(-dt * 7);
    this.color.lerp(this.goalColor, 1 - Math.exp(-dt * 6));
    this.write();
    return true;
  }

  write() {
    const out = Math.pow(this.level, 1.5);
    for (const l of this.lights) {
      l.intensity = l.userData.max * out;
      l.color.copy(this.color);
    }
    // Lamp bodies stay faintly readable when off and hot enough to bloom when on.
    const e = this.level > 0.001 ? 0.8 + 1.7 * Math.pow(this.level, 0.7) : 0;
    for (const m of this.glow) {
      m.emissive.copy(this.color);
      m.emissiveIntensity = e + this.hover * 0.5;
      if (this.level < 0.001) m.emissive.copy(tmp.set('#5b6b93'));
      m.color.copy(tmp.set('#8d8f96')).lerp(this.color, Math.min(1, this.level * 2));
    }
    const s = 1 + this.hover * 0.14 + Math.sin(this.pulse * Math.PI) * 0.22;
    this.model.scale.setScalar(s);
  }
}
