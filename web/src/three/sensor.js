// A door or window contact sensor: a small door floating by the opening, swung open and lit orange when it is open.
import * as THREE from 'three';
import { box, mat, at } from './kit.js';

export const SENSOR_COLORS = {
  open: '#ffb23f',
  closed: '#a3aab8',
  unknown: '#6b7280',
  unavailable: '#6b7280',
};

const Y = 1.2;

export class SensorUnit {
  constructor(cfg) {
    this.cfg = cfg;
    this.id = cfg.id;

    this.group = new THREE.Group();
    this.group.position.set(cfg.pos[0], Y, cfg.pos[1]);
    this.group.rotation.y = THREE.MathUtils.degToRad(cfg.rot);
    this.group.scale.setScalar(1.7); // readable from the default camera

    this.body = new THREE.Group();
    const metal = mat('#c9ccd2', { rough: 0.3, metal: 0.8 });
    this.body.add(
      at(box(0.025, 0.36, 0.04, metal, { r: 0.008 }), -0.125, 0, 0),
      at(box(0.025, 0.36, 0.04, metal, { r: 0.008 }), 0.125, 0, 0),
      at(box(0.275, 0.025, 0.04, metal, { r: 0.008 }), 0, 0.17, 0),
    );
    // The leaf hangs from a hinge on the frame's left side.
    this.hinge = new THREE.Group();
    this.hinge.position.x = -0.11;
    this.glow = new THREE.MeshStandardMaterial({ color: '#1d2027', emissive: SENSOR_COLORS.unknown, emissiveIntensity: 1.4, roughness: 0.4 });
    this.hinge.add(at(box(0.22, 0.32, 0.025, this.glow, { r: 0.01 }), 0.11, -0.01, 0));
    this.body.add(this.hinge);
    this.body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(this.body);

    this.wash = new THREE.PointLight(0xffffff, 0.4, 1.6, 2);
    this.wash.position.set(0, 0, 0.25);
    this.group.add(this.wash);

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), new THREE.MeshBasicMaterial());
    this.hit.visible = false;
    this.hit.userData = { kind: 'sensor', id: cfg.id };
    this.group.add(this.hit);

    this.color = new THREE.Color(SENSOR_COLORS.unknown);
    this.goalColor = this.color.clone();
    this.open = 0; // 0 = leaf shut, 1 = swung open
    this.goalOpen = 0;
    this.hover = 0;
    this.hoverGoal = 0;
  }

  anchor(out) {
    return out.set(0, 0.25, 0).applyMatrix4(this.group.matrixWorld);
  }

  apply(state, { instant = false } = {}) {
    const s = state?.state || 'unknown';
    this.goalColor.set(SENSOR_COLORS[s] || SENSOR_COLORS.unknown);
    this.goalOpen = s === 'open' ? 1 : 0;
    if (instant) { this.color.copy(this.goalColor); this.open = this.goalOpen; }
  }

  update(dt) {
    this.color.lerp(this.goalColor, 1 - Math.exp(-dt * 6));
    this.open += (this.goalOpen - this.open) * (1 - Math.exp(-dt * 6));
    if (Math.abs(this.goalOpen - this.open) < 0.002) this.open = this.goalOpen;
    this.hover += (this.hoverGoal - this.hover) * (1 - Math.exp(-dt * 14));

    this.hinge.rotation.y = -this.open * Math.PI * 0.4;
    this.glow.emissive.copy(this.color);
    this.wash.color.copy(this.color);
    this.wash.intensity = 0.15 + this.open * 0.35;
    this.body.scale.setScalar(1 + this.hover * 0.12);
    return this.goalOpen !== this.open || Math.abs(this.hoverGoal - this.hover) > 0.004
      || Math.abs(this.color.r - this.goalColor.r) + Math.abs(this.color.g - this.goalColor.g) > 0.004;
  }
}
