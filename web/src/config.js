import { setUnits } from './units.js';

// Loads and normalises a floor plan ("home.json"). Everything the 3D scene and the UI
// know about the apartment comes from this one document, so swapping the file swaps the home.

const LIGHT_TYPES = ['ceiling', 'pendant', 'spots', 'floor', 'table', 'strip', 'plug', 'fan', 'stick', 'softbox', 'star', 'bulb', 'exhaust', 'cans', 'dome', 'group'];
const WALLS = ['north', 'south', 'east', 'west'];

export class ConfigError extends Error {}

export const LIGHT_KINDS = LIGHT_TYPES;

// A lamp or an AC is real when it is linked to a device of a connected platform:
// `link: { service, id }` (Home Assistant, Philips Hue, Apple Home) or, for Smart Life,
// `tuya: { deviceId }`. An AC's `sensor: { service, id }` is a thermometer for its room.
export const LINK_FIELDS = ['tuya', 'link', 'sensor'];

export function linkOf(d) {
  if (d?.link?.service && d.link.id) return { service: d.link.service, id: d.link.id };
  if (d?.tuya?.deviceId) return { service: 'smartlife', id: d.tuya.deviceId };
  return null;
}

export const isLinked = (d) => Boolean(linkOf(d));

/** The platforms House Control can link to, in the order the editor lists them. */
export const SERVICES = {
  smartlife: { name: 'Smart Life', short: 'Smart Life' },
  homeassistant: { name: 'Home Assistant', short: 'Home Assistant' },
  hue: { name: 'Philips Hue', short: 'Hue' },
  govee: { name: 'Govee', short: 'Govee' },
  homekit: { name: 'Apple Home', short: 'Apple Home' },
};
export const FLOOR_KINDS = ['oak', 'walnut', 'tile', 'stone'];

// The plan exactly as written on disk (the editor works on this form).
export async function loadRawConfig() {
  const boot = window.__HOUSE_BOOT__;
  if (boot?.config) return boot.config;
  const plan = (boot?.plan !== 'custom' && boot?.plan) || new URLSearchParams(location.search).get('plan') || 'home';
  const res = await fetch(`./plans/${plan}.json`);
  if (!res.ok) throw new ConfigError(`Plan "${plan}" not found (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch (e) {
    throw new ConfigError(`Plan "${plan}" is not valid JSON: ${e.message}`);
  }
}

export async function loadConfig() {
  return normalize(await loadRawConfig());
}

function need(cond, msg) {
  if (!cond) throw new ConfigError(msg);
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

export function normalize(raw) {
  need(raw && typeof raw === 'object', 'Plan must be a JSON object');
  need(Array.isArray(raw.rooms) && raw.rooms.length > 0, 'Plan needs at least one room in "rooms"');
  setUnits(raw.units);

  const ids = new Set();
  const unique = (id, what) => {
    need(typeof id === 'string' && id, `${what} is missing an "id"`);
    need(!ids.has(id), `Duplicate id "${id}"`);
    ids.add(id);
  };

  // A plan with several floors lists them in `levels`; every room, opening and piece of
  // furniture then says which one it stands on with `level` (an index, 0 = the first).
  const levels = (Array.isArray(raw.levels) && raw.levels.length ? raw.levels : [{ name: raw.name || 'Home' }])
    .map((l, i) => ({ id: l.id || `level-${i}`, name: l.name || `Floor ${i + 1}` }));
  const levelOf = (o, what) => {
    const n = o.level ?? 0;
    need(Number.isInteger(n) && n >= 0 && n < levels.length, `${what} is on unknown level ${n}`);
    return n;
  };

  const rooms = raw.rooms.map((r) => {
    unique(r.id, 'A room');
    need(Array.isArray(r.rect) && r.rect.length === 4 && r.rect.every(Number.isFinite),
      `Room "${r.id}" needs "rect": [x, z, width, depth]`);
    const [x, z, w, d] = r.rect;
    need(w > 0 && d > 0, `Room "${r.id}" has an empty rect`);
    return { id: r.id, name: r.name || r.id, x, z, w, d, floor: r.floor || 'oak', level: levelOf(r, `Room "${r.id}"`),
      // A room that is not a rectangle is drawn as several: the extra rects name the room they belong to.
      partOf: r.partOf || null,
      // A flight of stairs in the room: climb = '-z' | '+z' | '-x' | '+x' (the way you walk up);
      // from 'below' = the flight coming up from the floor underneath, seen through the stairwell.
      stairs: r.stairs ? { climb: r.stairs.climb || '-z', from: r.stairs.from || 'floor', landing: r.stairs.landing || 0 } : null };
  });
  for (const r of rooms) need(!r.partOf || rooms.some((o) => o.id === r.partOf && !o.partOf), `Room "${r.id}" is part of unknown room "${r.partOf}"`);
  const roomIds = new Set(rooms.map((r) => r.id));
  const roomLevel = new Map(rooms.map((r) => [r.id, r.level]));

  const openings = (raw.openings || []).map((o, i) => {
    need(isPoint(o.from) && isPoint(o.to), `Opening #${i + 1} needs "from" and "to" points`);
    need(o.from[0] === o.to[0] || o.from[1] === o.to[1], `Opening #${i + 1} must be axis-aligned`);
    return { type: o.type || 'door', from: o.from, to: o.to, sill: o.sill ?? 0.85, head: o.head ?? 2.1, level: levelOf(o, `Opening #${i + 1}`) };
  });

  const lights = (raw.lights || []).map((l) => {
    unique(l.id, 'A light');
    need(roomIds.has(l.room), `Light "${l.id}" refers to unknown room "${l.room}"`);
    need(LIGHT_TYPES.includes(l.type), `Light "${l.id}" has unknown type "${l.type}" (use ${LIGHT_TYPES.join(', ')})`);
    need(isPoint(l.pos), `Light "${l.id}" needs "pos": [x, z]`);
    return {
      ...l,
      name: l.name || l.id,
      level: roomLevel.get(l.room),
      rot: l.rot || 0,
      capabilities: l.capabilities || [], // plain smart plugs: on/off only
    };
  });

  const acs = (raw.acs || []).map((a) => {
    unique(a.id, 'An AC');
    need(roomIds.has(a.room), `AC "${a.id}" refers to unknown room "${a.room}"`);
    need(isPoint(a.pos), `AC "${a.id}" needs "pos": [x, z]`);
    need(WALLS.includes(a.wall), `AC "${a.id}" needs "wall": one of ${WALLS.join(', ')}`);
    return { ...a, name: a.name || a.id, level: roomLevel.get(a.room), y: a.y ?? 2.2, min: a.min ?? 16, max: a.max ?? 30 };
  });

  const locks = (raw.locks || []).map((k) => {
    unique(k.id, 'A lock');
    need(roomIds.has(k.room), `Lock "${k.id}" refers to unknown room "${k.room}"`);
    need(isPoint(k.pos), `Lock "${k.id}" needs "pos": [x, z]`);
    return { ...k, name: k.name || k.id, level: roomLevel.get(k.room), rot: k.rot || 0 };
  });

  const media = (raw.media || []).map((m) => {
    unique(m.id, 'A media player');
    need(roomIds.has(m.room), `Media player "${m.id}" refers to unknown room "${m.room}"`);
    need(isPoint(m.pos), `Media player "${m.id}" needs "pos": [x, z]`);
    return { ...m, name: m.name || m.id, level: roomLevel.get(m.room), rot: m.rot || 0 };
  });

  const sensors = (raw.sensors || []).map((c) => {
    unique(c.id, 'A sensor');
    need(roomIds.has(c.room), `Sensor "${c.id}" refers to unknown room "${c.room}"`);
    need(isPoint(c.pos), `Sensor "${c.id}" needs "pos": [x, z]`);
    return { ...c, name: c.name || c.id, type: c.type || 'contact', level: roomLevel.get(c.room), rot: c.rot || 0 };
  });

  const scenes = (raw.scenes || []).map((s) => {
    need(typeof s.id === 'string' && s.id, 'A scene is missing an "id"');
    return { id: s.id, name: s.name || s.id, icon: s.icon || 'sun', lights: s.lights || {}, acs: s.acs || {} };
  });

  const boundsOf = (list) => ({
    minX: Math.min(...list.map((r) => r.x)),
    minZ: Math.min(...list.map((r) => r.z)),
    maxX: Math.max(...list.map((r) => r.x + r.w)),
    maxZ: Math.max(...list.map((r) => r.z + r.d)),
  });
  levels.forEach((l, i) => {
    const own = rooms.filter((r) => r.level === i);
    need(own.length, `Level "${l.name}" has no rooms`);
    l.bounds = boundsOf(own);
  });

  return {
    name: raw.name || 'Home',
    wallHeight: raw.wallHeight ?? 2.6,
    interiorWallHeight: raw.interiorWallHeight ?? 1.25,
    camera: { azimuth: raw.camera?.azimuth ?? 34, elevation: raw.camera?.elevation ?? 47 },
    outdoorTemp: raw.outdoorTemp ?? 27,
    rooms,
    openings,
    furniture: (raw.furniture || []).map((f) => ({ ...f, level: f.level ?? 0 })),
    lights,
    acs,
    locks,
    media,
    sensors,
    scenes,
    levels,
    bounds: boundsOf(rooms),
  };
}
