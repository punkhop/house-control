// A door lock: a small padlock floating by the door, lit in the colour of its state.
import * as THREE from 'three';
import { box, mat, at } from './kit.js';

export const LOCK_COLORS = {
  locked: '#3fcf7a',
  unlocked: '#ffb23f',
  locking: '#9bd28a',
  unlocking: '#ffd08a',
  jammed: '#ff5a4f',
  unknown: '#6b7280',
  unavailable: '#6b7280',
};

const Y = 1.35;

export class LockUnit {
  constructor(cfg) {
    this.cfg = cfg;
    this.id = cfg.id;

    this.group = new THREE.Group();
    this.group.position.set(cfg.pos[0], Y, cfg.pos[1]);
    this.group.rotation.y = THREE.MathUtils.degToRad(cfg.rot);
    this.group.scale.setScalar(1.7); // readable from the default camera

    this.body = new THREE.Group();
    this.glow = new THREE.MeshStandardMaterial({ color: '#1d2027', emissive: LOCK_COLORS.unknown, emissiveIntensity: 1.6, roughness: 0.4 });
    const metal = mat('#c9ccd2', { rough: 0.3, metal: 0.8 });
    this.shackle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 12, 28, Math.PI), metal);
    this.shackle.position.y = 0.16;
    this.body.add(at(box(0.22, 0.17, 0.08, this.glow, { r: 0.03 }), 0, 0, 0), this.shackle);
    this.body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(this.body);

    this.wash = new THREE.PointLight(0xffffff, 0.5, 1.6, 2);
    this.wash.position.set(0, 0.05, 0.25);
    this.group.add(this.wash);

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), new THREE.MeshBasicMaterial());
    this.hit.position.y = 0.1;
    this.hit.visible = false;
    this.hit.userData = { kind: 'lock', id: cfg.id };
    this.group.add(this.hit);

    this.color = new THREE.Color(LOCK_COLORS.unknown);
    this.goalColor = this.color.clone();
    this.open = 0; // 0 = shackle down (locked), 1 = up
    this.goalOpen = 0;
    this.moving = false;
    this.clock = 0;
    this.hover = 0;
    this.hoverGoal = 0;
  }

  anchor(out) {
    return out.set(0, 0.3, 0).applyMatrix4(this.group.matrixWorld);
  }

  apply(state, { instant = false } = {}) {
    const s = state?.state || 'unknown';
    this.goalColor.set(LOCK_COLORS[s] || LOCK_COLORS.unknown);
    this.goalOpen = s === 'unlocked' || s === 'unlocking' ? 1 : 0;
    this.moving = s === 'locking' || s === 'unlocking';
    if (instant) { this.color.copy(this.goalColor); this.open = this.goalOpen; }
  }

  update(dt) {
    this.clock += dt;
    this.color.lerp(this.goalColor, 1 - Math.exp(-dt * 6));
    this.open += (this.goalOpen - this.open) * (1 - Math.exp(-dt * 6));
    if (Math.abs(this.goalOpen - this.open) < 0.002) this.open = this.goalOpen;
    this.hover += (this.hoverGoal - this.hover) * (1 - Math.exp(-dt * 14));

    // Unlocked: the shackle lifts and swings open, like a real padlock.
    this.shackle.position.y = 0.16 + this.open * 0.05;
    this.shackle.position.x = this.open * 0.075;
    this.shackle.rotation.y = this.open * Math.PI * 0.5;
    const pulse = this.moving ? 0.6 + 0.4 * Math.sin(this.clock * 7) : 1;
    this.glow.emissive.copy(this.color);
    this.glow.emissiveIntensity = 1.6 * pulse;
    this.wash.color.copy(this.color);
    this.wash.intensity = 0.5 * pulse;
    this.body.scale.setScalar(1 + this.hover * 0.12);
    return this.moving || this.goalOpen !== this.open || Math.abs(this.hoverGoal - this.hover) > 0.004
      || Math.abs(this.color.r - this.goalColor.r) + Math.abs(this.color.g - this.goalColor.g) > 0.004;
  }
}
