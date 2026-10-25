// The robot's driving policy: a small set of named numbers that code applies every tick.
// A model may propose new values; it never drives. Every value is clamped to the bounds below before use.

export interface Policy {
  /** Top speed on a clear aisle, m/s. */
  cruiseSpeed: number;
  /** Pure-pursuit look-ahead distance, m. Long cuts corners; short weaves. */
  lookahead: number;
  /** Extra clearance kept from anything ahead, m. */
  safetyMargin: number;
  /** The deceleration the robot plans its stops with, m/s². */
  plannedDecel: number;
  /** Speed multiplier on a floor the camera sees as wet (1 = no change). */
  wetSpeedFactor: number;
  /** Slow to 0.5 m/s while a person is within this distance, m (0 = never). */
  yieldRadius: number;
  /** Seconds stopped behind an obstacle before re-planning around it. */
  replanTimeout: number;
  /** Speed multiplier in low light (1 = no change). */
  darkSpeedFactor: number;
}

export type PolicyKey = keyof Policy;

export interface Bound {
  min: number;
  max: number;
  unit: string;
  label: string;
  /** Decimal places shown and kept. */
  dp: number;
}

export const BOUNDS: Record<PolicyKey, Bound> = {
  cruiseSpeed: { min: 0.6, max: 2.0, unit: 'm/s', label: 'Cruise speed', dp: 2 },
  lookahead: { min: 0.4, max: 2.5, unit: 'm', label: 'Look-ahead', dp: 2 },
  safetyMargin: { min: 0.2, max: 1.2, unit: 'm', label: 'Safety margin', dp: 2 },
  plannedDecel: { min: 0.5, max: 3.0, unit: 'm/s²', label: 'Planned braking', dp: 2 },
  wetSpeedFactor: { min: 0.3, max: 1.0, unit: 'x', label: 'Wet floor speed', dp: 2 },
  yieldRadius: { min: 0, max: 4.0, unit: 'm', label: 'Yield radius', dp: 1 },
  replanTimeout: { min: 1, max: 10, unit: 's', label: 'Re-plan timeout', dp: 1 },
  darkSpeedFactor: { min: 0.4, max: 1.0, unit: 'x', label: 'Low light speed', dp: 2 },
};

export const POLICY_KEYS = Object.keys(BOUNDS) as PolicyKey[];

/** Version 0: a plausible first policy, tuned for a dry, bright, empty aisle. */
export const V0: Policy = {
  cruiseSpeed: 1.5,
  lookahead: 1.6,
  safetyMargin: 0.3,
  plannedDecel: 2.2,
  wetSpeedFactor: 1.0,
  yieldRadius: 0,
  replanTimeout: 6,
  darkSpeedFactor: 1.0,
};

export function clampValue(key: PolicyKey, value: number): number {
  const b = BOUNDS[key];
  const v = Math.min(b.max, Math.max(b.min, value));
  const f = 10 ** b.dp;
  return Math.round(v * f) / f;
}

export function clampPolicy(p: Policy): Policy {
  const out = { ...p };
  for (const k of POLICY_KEYS) out[k] = clampValue(k, p[k]);
  return out;
}

export function formatValue(key: PolicyKey, value: number): string {
  const b = BOUNDS[key];
  return b.unit === 'x' ? `x${value.toFixed(b.dp)}` : `${value.toFixed(b.dp)} ${b.unit}`;
}
