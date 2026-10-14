// A media player: a small speaker with a screen strip, lit while it is on; three level bars rise while it plays.
// The bars hold still, so a player left playing for hours never keeps the scene redrawing.
import * as THREE from 'three';
import { box, cyl, mat, at } from './kit.js';

export const MEDIA_COLORS = {
  playing: '#8b5cff',
  paused: '#6fb0ff',
  on: '#6fb0ff',
  idle: '#6fb0ff',
  off: '#3a3f4b',
  standby: '#3a3f4b',
  unknown: '#6b7280',
  unavailable: '#6b7280',
};

/** Is it switched on, in the panel's sense (lit tile, lit marker)? */
export const mediaIsOn = (s) => Boolean(s?.on) && s.state !== 'unknown' && s.state !== 'unavailable';

const Y = 1.1;

// The bodies, standing on y = 0 and facing +z. Each returns the height of its top.
const BODIES = {
  // A generic speaker: a box with a cone and a screen strip.
  speaker(g, glow) {
    const cone = cyl(0.055, 0.055, 0.012, mat('#3b3f49', { rough: 0.9 }));
    cone.rotation.x = Math.PI / 2;
    g.add(
      at(box(0.2, 0.26, 0.12, mat('#23262e', { rough: 0.55, metal: 0.2 }), { r: 0.03 }), 0, 0, 0),
      at(box(0.14, 0.035, 0.01, glow, { r: 0.008 }), 0, 0.2, 0.061),
      at(cone, 0, 0.1, 0.06),
    );
    return 0.26;
  },
  // Google Home: a fabric-wrapped base under a white cylinder with a slanted top.
  googleHome(g, glow) {
    const body = cyl(0.048, 0.048, 0.12, mat('#f2f2ef', { rough: 0.35 }), 32);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.001, 32), glow);
    cap.position.y = 0.155;
    cap.rotation.x = -0.25;
    g.add(at(cyl(0.05, 0.05, 0.05, mat('#7d8086', { rough: 1 }), 32), 0, 0, 0), at(body, 0, 0.04, 0), cap);
    return 0.17;
  },
  // NVIDIA Shield TV Pro: a flat black wedge-ish box with a green light.
  shield(g, glow) {
    g.add(
      at(box(0.16, 0.026, 0.1, mat('#15161a', { rough: 0.3, metal: 0.3 }), { r: 0.006 }), 0, 0, 0),
      at(box(0.04, 0.004, 0.004, glow, { r: 0 }), 0, 0.013, 0.051),
    );
    return 0.03;
  },
  // A soundbar: a long low fabric bar.
  soundbar(g, glow) {
    g.add(
      at(box(0.9, 0.06, 0.1, mat('#1d1f24', { rough: 0.9 }), { r: 0.02 }), 0, 0, 0),
      at(box(0.06, 0.006, 0.004, glow, { r: 0 }), 0, 0.03, 0.051),
    );
    return 0.06;
  },
  // An AV receiver: a black box with a lit display.
  receiver(g, glow) {
    g.add(
      at(box(0.43, 0.15, 0.33, mat('#17181c', { rough: 0.45, metal: 0.4 }), { r: 0.01 }), 0, 0, 0),
      at(box(0.16, 0.03, 0.004, glow, { r: 0 }), 0, 0.09, 0.166),
      at(cyl(0.035, 0.035, 0.02, mat('#2c2e34', { metal: 0.6, rough: 0.3 }), 24), 0.15, 0.075, 0.17),
    );
    return 0.15;
  },
};

export class MediaUnit {
  constructor(cfg) {
    this.cfg = cfg;
    this.id = cfg.id;

    this.group = new THREE.Group();
    this.group.position.set(cfg.pos[0], cfg.y ?? Y, cfg.pos[1]);
    this.group.rotation.y = THREE.MathUtils.degToRad(cfg.rot);
    this.group.scale.setScalar(cfg.kind && cfg.kind !== 'speaker' ? 1.3 : 1.7); // readable from the default camera

    this.body = new THREE.Group();
    this.glow = new THREE.MeshStandardMaterial({ color: '#1d2027', emissive: MEDIA_COLORS.off, emissiveIntensity: 1.4, roughness: 0.4 });
    // Each kind is drawn like the real thing; `top` is the height its level bars stand on.
    const top = BODIES[cfg.kind || 'speaker'](this.body, this.glow);
    // Level bars on top: low when quiet, raised in a stagger while playing.
    this.bars = [-0.05, 0, 0.05].map((x) => {
      const bar = box(0.03, 0.08, 0.03, this.glow, { r: 0.006 });
      bar.position.set(x, top, 0);
      this.body.add(bar);
      return bar;
    });
    this.body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(this.body);

    this.wash = new THREE.PointLight(0xffffff, 0.4, 1.6, 2);
    this.wash.position.set(0, 0.2, 0.25);
    this.group.add(this.wash);

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.45), new THREE.MeshBasicMaterial());
    this.hit.position.y = 0.15;
    this.hit.visible = false;
    this.hit.userData = { kind: 'media', id: cfg.id };
    this.group.add(this.hit);

    this.color = new THREE.Color(MEDIA_COLORS.off);
    this.goalColor = this.color.clone();
    this.level = 0; // 0 = dark, 1 = lit
    this.goalLevel = 0;
    this.bar = 0; // 0 = low, 1 = raised
    this.goalBar = 0;
    this.hover = 0;
    this.hoverGoal = 0;
  }

  anchor(out) {
    return out.set(0, 0.4, 0).applyMatrix4(this.group.matrixWorld);
  }

  apply(state, { instant = false } = {}) {
    const s = state?.state || 'unknown';
    this.goalColor.set(MEDIA_COLORS[s] || MEDIA_COLORS.on);
    this.goalLevel = mediaIsOn(state) ? 1 : 0;
    this.goalBar = s === 'playing' ? 1 : 0;
    if (instant) { this.color.copy(this.goalColor); this.level = this.goalLevel; this.bar = this.goalBar; }
  }

  update(dt) {
    this.color.lerp(this.goalColor, 1 - Math.exp(-dt * 6));
    this.level += (this.goalLevel - this.level) * (1 - Math.exp(-dt * 6));
    if (Math.abs(this.goalLevel - this.level) < 0.002) this.level = this.goalLevel;
    this.hover += (this.hoverGoal - this.hover) * (1 - Math.exp(-dt * 14));

    this.bar += (this.goalBar - this.bar) * (1 - Math.exp(-dt * 8));
    if (Math.abs(this.goalBar - this.bar) < 0.002) this.bar = this.goalBar;
    this.bars.forEach((bar, i) => { bar.scale.y = 0.3 + this.bar * [0.5, 0.9, 0.65][i]; });
    this.glow.emissive.copy(this.color);
    this.glow.emissiveIntensity = 0.25 + 1.35 * this.level;
    this.wash.color.copy(this.color);
    this.wash.intensity = 0.4 * this.level;
    this.body.scale.setScalar(1 + this.hover * 0.12);
    return this.goalBar !== this.bar || this.goalLevel !== this.level || Math.abs(this.hoverGoal - this.hover) > 0.004
      || Math.abs(this.color.r - this.goalColor.r) + Math.abs(this.color.g - this.goalColor.g) > 0.004;
  }
}
