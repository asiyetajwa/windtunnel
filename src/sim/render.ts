// Draws a moment of a run as SVG, top-down: the aisle, racks, the door, the packing room, the robot with its
// sensor fan, people, the pallet and the wet floor. Pure string building, so the browser and Node share it;
// Node rasterises it to PNG for the vision model (see png.ts).

import { MAP, type Scenario } from './scenario.js';
import type { Frame } from './sim.js';

export interface View {
  /** World window to draw, metres. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const FULL_VIEW: View = { x0: -0.6, x1: 30.6, y0: -1.2, y1: 9.6 };

const C = {
  floor: '#22105c',
  grid: 'rgba(255,255,255,0.045)',
  rack: '#3a1b8f',
  box: ['#5530c2', '#7f5df0', '#4a27b0'],
  room: '#2a1470',
  wall: '#7f5df0',
  label: '#c9b8ff',
  robot: '#ff7a2e',
  robotDark: '#2a0f02',
  fan: 'rgba(255,122,46,0.16)',
  person: '#ffd9bd',
  unseen: 'rgba(255,217,189,0.35)',
  pallet: '#d9a066',
  wet: 'rgba(120,180,255,0.22)',
  path: 'rgba(201,184,255,0.55)',
  alert: '#ff7a2e',
};

function rackBoxes(x0: number, x1: number, y0: number, y1: number, k: number, sx: (x: number) => number, sy: (y: number) => number, s: number): string {
  const out: string[] = [];
  const bay = 2.4;
  for (let x = x0; x < x1 - 0.3; x += bay) {
    const w = Math.min(bay - 0.3, x1 - x - 0.15);
    out.push(`<rect x="${sx(x + 0.15)}" y="${sy(y1 - 0.1)}" width="${w * s}" height="${(y1 - y0 - 0.2) * s}" rx="${0.18 * s}" fill="${C.rack}"/>`);
    const n = Math.max(1, Math.floor(w / 0.55));
    for (let i = 0; i < n; i++) {
      const c = C.box[(Math.floor(x) + i + k) % 3]!;
      out.push(`<rect x="${sx(x + 0.3 + i * 0.55)}" y="${sy((y0 + y1) / 2 + 0.2)}" width="${0.42 * s}" height="${0.4 * s}" rx="${0.08 * s}" fill="${c}"/>`);
    }
  }
  return out.join('');
}

export interface RenderOptions {
  view?: View;
  /** Pixels per metre. */
  scale?: number;
  /** Text labels on things (for the vision model). */
  labels?: boolean;
  /** The heads-up line: time, speed and braking. */
  hud?: boolean;
  /** Mark the robot in alert colour (the failure moment). */
  alert?: boolean;
  /** The robot's trail so far. */
  trail?: Array<{ x: number; y: number }>;
}

export function renderSvg(sc: Scenario, f: Frame, opts: RenderOptions = {}): string {
  const v = opts.view ?? FULL_VIEW;
  const s = opts.scale ?? 40;
  const W = (v.x1 - v.x0) * s;
  const H = (v.y1 - v.y0) * s;
  const sx = (x: number) => +((x - v.x0) * s).toFixed(1);
  const sy = (y: number) => +((v.y1 - y) * s).toFixed(1);
  const half = sc.doorWidth / 2;
  const parts: string[] = [];
  const font = `font-family="Geist Mono, JetBrains Mono, DejaVu Sans Mono, monospace"`;
  const text = (x: number, y: number, t: string, size = 0.34, fill = C.label, anchor = 'start') =>
    `<text x="${sx(x)}" y="${sy(y)}" fill="${fill}" font-size="${(size * s).toFixed(1)}" ${font} letter-spacing="1" text-anchor="${anchor}">${t}</text>`;

  parts.push(`<rect width="${W}" height="${H}" fill="${C.floor}"/>`);
  for (let x = Math.ceil(v.x0); x <= v.x1; x++) parts.push(`<line x1="${sx(x)}" y1="0" x2="${sx(x)}" y2="${H}" stroke="${C.grid}"/>`);
  // Packing room floor and walls.
  parts.push(`<rect x="${sx(MAP.room.x0)}" y="${sy(MAP.room.y1)}" width="${(MAP.room.x1 - MAP.room.x0) * s}" height="${(MAP.room.y1 - MAP.room.y0) * s}" fill="${C.room}"/>`);
  // Racks: below the aisle, above it up to the packing room, and beyond the aisle's end.
  parts.push(rackBoxes(0, MAP.aisleEnd, -1.2, 0, 0, sx, sy, s));
  parts.push(rackBoxes(0, MAP.room.x0, MAP.aisleTop, MAP.aisleTop + 1.4, 1, sx, sy, s));
  // Wall along the top of the aisle into the room, with the door opening.
  const wall = (xa: number, xb: number) => `<line x1="${sx(xa)}" y1="${sy(MAP.aisleTop)}" x2="${sx(xb)}" y2="${sy(MAP.aisleTop)}" stroke="${C.wall}" stroke-width="${0.12 * s}" stroke-linecap="round"/>`;
  parts.push(wall(MAP.room.x0, MAP.door.x - half), wall(MAP.door.x + half, MAP.room.x1));
  parts.push(`<rect x="${sx(MAP.room.x0)}" y="${sy(MAP.room.y1)}" width="${(MAP.room.x1 - MAP.room.x0) * s}" height="${(MAP.room.y1 - MAP.aisleTop) * s}" fill="none" stroke="${C.wall}" stroke-width="${0.08 * s}" rx="${0.2 * s}"/>`);
  parts.push(`<line x1="${sx(MAP.aisleEnd)}" y1="${sy(0)}" x2="${sx(MAP.aisleEnd)}" y2="${sy(MAP.aisleTop)}" stroke="${C.wall}" stroke-width="${0.08 * s}"/>`);
  // Stations.
  parts.push(`<rect x="${sx(MAP.goal.x - 0.6)}" y="${sy(MAP.goal.y + 0.45)}" width="${1.2 * s}" height="${0.9 * s}" rx="${0.15 * s}" fill="none" stroke="${C.label}" stroke-dasharray="4 4" stroke-opacity="0.6"/>`);
  parts.push(text(0.3, 2.9, 'PICK 3'), text(MAP.goal.x, MAP.goal.y + 0.75, 'PACK 1', 0.34, C.label, 'middle'));
  if (opts.labels) parts.push(text(MAP.door.x, MAP.aisleTop + 0.35, 'DOOR', 0.3, C.label, 'middle'));

  if (sc.wet) {
    parts.push(`<rect x="${sx(sc.wet.x0)}" y="${sy(MAP.aisleTop)}" width="${(sc.wet.x1 - sc.wet.x0) * s}" height="${MAP.aisleTop * s}" fill="${C.wet}" rx="${0.6 * s}"/>`);
    parts.push(text(sc.wet.x0 + 0.2, 0.3, 'WET FLOOR', 0.3, '#a9ccff'));
  }
  if (sc.pallet) {
    parts.push(`<rect x="${sx(sc.pallet.x - 0.6)}" y="${sy(2.6)}" width="${1.2 * s}" height="${1.2 * s}" rx="${0.1 * s}" fill="${C.pallet}"/>`);
    parts.push(`<path d="M${sx(sc.pallet.x - 0.6)} ${sy(2.2)}h${1.2 * s}M${sx(sc.pallet.x - 0.6)} ${sy(1.8)}h${1.2 * s}" stroke="#8a5a2b" stroke-width="2"/>`);
    if (opts.labels) parts.push(text(sc.pallet.x, 2.85, 'PALLET', 0.3, '#f0c48f', 'middle'));
  }

  if (opts.trail && opts.trail.length > 1) {
    parts.push(`<polyline points="${opts.trail.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}" fill="none" stroke="${C.path}" stroke-width="2" stroke-dasharray="5 6"/>`);
  }

  // Sensor fan, then the robot.
  const fanR = 3.2;
  const a0 = f.heading - 0.75;
  const a1 = f.heading + 0.75;
  parts.push(`<path d="M${sx(f.x)} ${sy(f.y)} L${sx(f.x + fanR * Math.cos(a0))} ${sy(f.y + fanR * Math.sin(a0))} A${fanR * s} ${fanR * s} 0 0 0 ${sx(f.x + fanR * Math.cos(a1))} ${sy(f.y + fanR * Math.sin(a1))} Z" fill="${C.fan}"/>`);
  const deg = (-f.heading * 180) / Math.PI;
  parts.push(`<g transform="translate(${sx(f.x)} ${sy(f.y)}) rotate(${deg.toFixed(1)})"><rect x="${-0.36 * s}" y="${-0.28 * s}" width="${0.72 * s}" height="${0.56 * s}" rx="${0.14 * s}" fill="${C.robot}"/><rect x="${0.12 * s}" y="${-0.14 * s}" width="${0.14 * s}" height="${0.28 * s}" rx="${0.05 * s}" fill="${C.robotDark}" opacity="0.75"/></g>`);
  if (opts.alert) parts.push(`<circle cx="${sx(f.x)}" cy="${sy(f.y)}" r="${0.85 * s}" fill="none" stroke="${C.alert}" stroke-width="2.5" stroke-dasharray="6 6"/>`);
  if (opts.labels) parts.push(text(f.x, f.y - 0.75, 'ROBOT', 0.3, '#ffae6e', 'middle'));

  for (const p of f.people) {
    parts.push(`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${0.28 * s}" fill="${p.seen ? C.person : C.unseen}"/>`);
    if (opts.labels) parts.push(text(p.x, p.y + 0.45, p.seen ? 'PERSON' : 'PERSON (NOT SEEN)', 0.26, '#ffd9bd', 'middle'));
  }

  if (sc.lowLight) parts.push(`<rect width="${W}" height="${H}" fill="rgba(6,2,20,0.42)"/>`, text(v.x1 - 0.3, v.y1 - 0.5, 'LOW LIGHT', 0.3, '#c9b8ff', 'end'));
  if (opts.hud) {
    parts.push(`<rect x="${0.25 * s}" y="${0.2 * s}" width="${7.2 * s}" height="${0.62 * s}" rx="${0.31 * s}" fill="rgba(20,8,60,0.72)"/>`);
    parts.push(text(v.x0 + 0.5, v.y1 - 0.62, `t ${f.t.toFixed(1)} s  v ${f.v.toFixed(2)} m/s  brake ${f.decel.toFixed(1)} m/s2`, 0.3, '#ffffff'));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">${parts.join('')}</svg>`;
}

/** A window around the robot, for close-up frames. */
export function viewAround(x: number, y: number, w = 12, h = 7): View {
  const x0 = Math.min(Math.max(x - w / 2, FULL_VIEW.x0), FULL_VIEW.x1 - w);
  const y0 = Math.min(Math.max(y - h / 2, FULL_VIEW.y0), FULL_VIEW.y1 - h);
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}
