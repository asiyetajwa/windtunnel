import React, { useMemo } from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';
import { BlurText, Camera, clamp, Cursor, easeOut, popAt, useRoll, type CamKey, type CursorKey } from '../components/motion';
import boxesJson from '../../public/app/boxes.json';
import runJson from '../../../data/run.json';
import { simulate, CAUSE_LABEL } from '../../../src/sim/sim';
import { scenario } from '../../../src/sim/scenario';
import { renderSvg, viewAround, FULL_VIEW } from '../../../src/sim/render';
import type { Policy } from '../../../src/sim/policy';

type SceneProps = { duration: number };
type Box = { x: number; y: number; w: number; h: number };
const boxes = boxesJson as unknown as Record<string, Box>;
const B = (key: string): Box => {
  const b = boxes[key];
  if (!b) throw new Error(`No box ${key}`);
  return b;
};
const sec = (s: number) => Math.round(s * 60);

type Summary = { passRate: number; passed: number; runs: number; collisions: number; nearMisses: number };
const run = runJson as unknown as { v0: Policy; costUsd: number; calls: unknown[]; rounds: Array<{ next: Policy; heldOut: Summary; nextHeldOut: Summary; tune: Summary }> };
/** Policy after k rounds. */
const P = (k: number): Policy => (k === 0 ? run.v0 : run.rounds[k - 1]!.next);
const v0Held = run.rounds[0]!.heldOut;
const lastHeld = run.rounds[run.rounds.length - 1]!.nextHeldOut;

/* ------------------------------------------------------------ the simulator, drawn live */

type SimProps = {
  seed: number;
  policy: Policy;
  w: number;
  h: number;
  /** Sim seconds per film second. */
  speed?: number;
  /** Film frame (scene time) the run starts at. */
  delay?: number;
  /** Start this many sim seconds in. */
  from?: number;
  /** Metres shown across. */
  span?: number;
  hud?: boolean;
  caption?: boolean;
  radius?: number;
  /** Treat the run as over at this sim time (a robot that stopped for good). */
  until?: number;
};

const SimView: React.FC<SimProps> = ({ seed, policy, w, h, speed = 1, delay = 0, from = 0, span = 13, hud = true, caption = true, radius = 18, until }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const result = useMemo(() => simulate(seed, policy, { frames: true }), [seed, policy]);
  const sc = useMemo(() => scenario(seed), [seed]);
  const all = result.frames ?? [];
  const frames = until === undefined ? all : all.filter((x) => x.t <= until);
  const simT = from + (Math.max(0, frame - delay) / fps) * speed;
  const i = Math.min(frames.length - 1, Math.max(0, Math.round(simT / 0.05)));
  const f = frames[i]!;
  const ended = i >= frames.length - 1;
  const endedAt = delay + ((frames.length - 1) * 0.05 - from) / speed * fps;
  const viewH = Math.min((span * h) / w, FULL_VIEW.y1 - FULL_VIEW.y0);
  const viewW = (viewH * w) / h;
  const view = viewAround(f.x + 2.2 * Math.cos(f.heading), f.y + 2.2 * Math.sin(f.heading), viewW, viewH);
  const svg = renderSvg(sc, f, { view, scale: w / viewW, alert: ended && !result.pass, trail: frames.slice(0, i + 1).filter((_, j) => j % 3 === 0) }).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block" ');
  const cap = popAt(frame, fps, endedAt + 2, 16);
  const label = result.pass ? `Delivered in ${result.t.toFixed(1)} s` : CAUSE_LABEL[result.cause!];
  const pill: React.CSSProperties = { padding: '6px 14px', borderRadius: 999, background: 'rgba(20,8,60,0.72)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)', fontFamily: theme.mono, fontSize: 15, whiteSpace: 'nowrap' };
  return (
    <div style={{ position: 'relative', width: w, height: h, borderRadius: radius, overflow: 'hidden', background: theme.floor }}>
      <div style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />
      {hud ? (
        <div style={{ position: 'absolute', left: 14, right: 14, top: 12, display: 'flex', justifyContent: 'space-between' }}>
          <span style={pill}>seed {seed} · {w < 700 ? sc.tags[0] : sc.tags.slice(0, 2).join(' + ')}</span>
          <span style={pill}>t = {f.t.toFixed(1)} s · {f.v.toFixed(2)} m/s</span>
        </div>
      ) : null}
      {caption && ended ? (
        <div style={{ position: 'absolute', left: '50%', bottom: 18, transform: `translate(-50%, ${String((1 - cap) * 12)}px)`, opacity: cap, padding: '9px 20px', borderRadius: 999, fontFamily: theme.font, fontWeight: 700, fontSize: 19, whiteSpace: 'nowrap', background: result.pass ? '#d9f6e6' : theme.orange, color: result.pass ? '#0f6b40' : '#2a0f02' }}>
          {label}
        </div>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------ the desktop window */

const WIN = { w: 1440, h: 900, bar: 36 };
const winH = WIN.h + WIN.bar;
const w = (x: number, y: number) => ({ x: -WIN.w / 2 + x, y: -winH / 2 + WIN.bar + y });

type State = { src: string; at: number };

const Window: React.FC<{ states: State[]; hero?: { seed: number; policy: Policy; speed?: number } }> = ({ states, hero }) => {
  const frame = useCurrentFrame();
  const scene = B('ov-k0:scene');
  return (
    <div style={{ position: 'absolute', left: -WIN.w / 2, top: -winH / 2, width: WIN.w, height: winH, borderRadius: 20, overflow: 'hidden', background: '#fbeee6', boxShadow: '0 60px 120px rgba(120,50,20,0.28), 0 0 0 1px rgba(255,255,255,0.6)' }}>
      <div style={{ height: WIN.bar, background: '#fdf5f0', display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', borderBottom: '1px solid rgba(58,26,150,0.06)' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c, opacity: 0.85 }} />
        ))}
        <div style={{ margin: '0 auto', color: theme.muted, fontFamily: theme.font, fontSize: 14, fontWeight: 700, transform: 'translateX(-30px)' }}>Wind Tunnel</div>
      </div>
      <div style={{ position: 'relative', width: WIN.w, height: WIN.h }}>
        {states.map((s, i) => {
          const next = states[i + 1];
          const opacity = i === 0 ? 1 : interpolate(frame, [s.at, s.at + 12], [0, 1], { ...clamp, easing: easeOut });
          if (frame < s.at - 1 || (next && frame >= next.at + 14)) return null;
          return <Img key={s.src} src={staticFile(`app/${s.src}.png`)} style={{ position: 'absolute', inset: 0, width: WIN.w, height: WIN.h, opacity }} />;
        })}
        {hero ? (
          <div style={{ position: 'absolute', left: scene.x, top: scene.y }}>
            <SimView seed={hero.seed} policy={hero.policy} w={scene.w} h={scene.h} speed={hero.speed ?? 1.6} radius={18} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

const WIDE = (f: number): CamKey => ({ f, x: 0, y: 0, z: 0.98 });
const read = (f: number, b: Box, zmax = 1.8): CamKey => {
  const top = 40;
  const bottom = 1080 - 160;
  const z = Math.min(zmax, (bottom - top) / (b.h + 80), (1920 * 0.86) / (b.w + 120));
  const lift = (1080 / 2 - (top + bottom) / 2) / z;
  return { f, ...w(b.x + b.w / 2, b.y + b.h / 2 + lift), z };
};
const readKey = (f: number, key: string, zmax = 1.8) => read(f, B(key), zmax);
const union = (...keys: string[]): Box => {
  const bs = keys.map(B);
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};
const cur = (f: number, x: number, y: number, click = false): CursorKey => ({ f, ...w(x, y), click });
const at = (key: string, dx = 0.5, dy = 0.5): [number, number] => {
  const b = B(key);
  return [b.x + b.w * dx, b.y + b.h * dy];
};

/** Ink caption pill with an orange dot, for the point the line makes. */
const Callout: React.FC<{ text: string; at: number; outAt: number; tone?: 'orange' | 'green' | 'purple' }> = ({ text, at: start, outAt, tone = 'orange' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = popAt(frame, fps, start, 15);
  const out = interpolate(frame, [outAt, outAt + 14], [0, 1], clamp);
  const dot = tone === 'green' ? '#4ade80' : tone === 'purple' ? theme.lav : theme.orange2;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 56, pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, maxWidth: 1500, padding: '16px 32px 16px 24px', borderRadius: 999, background: theme.ink, color: '#fff', fontFamily: theme.font, fontSize: 32, fontWeight: 700, opacity: p * (1 - out), transform: `translateY(${String((1 - p) * 24 + out * 12)}px)`, boxShadow: '0 20px 50px rgba(26,18,48,0.35)' }}>
        <span style={{ flex: 'none', width: 16, height: 16, borderRadius: 999, background: dot, boxShadow: `0 0 16px ${dot}` }} />
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <defs>
      <radialGradient id="lg" cx="30%" cy="25%" r="80%">
        <stop offset="0" stopColor="#8457ff" />
        <stop offset="1" stopColor="#2c1077" />
      </radialGradient>
    </defs>
    <circle cx="32" cy="32" r="32" fill="url(#lg)" />
    <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" transform="translate(11 11) scale(1.75)">
      <path d="M3 8h10.5a3 3 0 1 0-3-3" />
      <path d="M3 12.5h15a3 3 0 1 1-3 3" />
      <path d="M3 17h7" />
    </g>
  </svg>
);

const Eyebrow: React.FC<{ children: React.ReactNode; dark?: boolean; style?: React.CSSProperties }> = ({ children, dark, style }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 999, fontFamily: theme.font, fontSize: 15, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: dark ? '#fff' : theme.purple, background: dark ? 'rgba(255,255,255,0.12)' : theme.lavSoft, ...style }}>
    {children}
  </span>
);

const fadeUp = (frame: number, fps: number, start: number) => {
  const p = popAt(frame, fps, start, 18);
  return { opacity: p, transform: `translateY(${String((1 - p) * 30)}px)` };
};

/* ------------------------------------------------------------ scenes */

export const IntroScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: theme.floor }}>
      <AbsoluteFill style={{ opacity: interpolate(frame, [0, 30], [0, 1], clamp) }}>
        <SimView seed={1} policy={P(2)} w={1920} h={1080} span={16} speed={1.4} from={3} hud={false} caption={false} radius={0} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(44,16,119,0.94) 0%, rgba(44,16,119,0.72) 42%, rgba(44,16,119,0) 75%)' }} />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, ...fadeUp(frame, fps, 6) }}>
          <Logo size={96} />
          <span style={{ fontFamily: theme.font, fontWeight: 800, fontSize: 92, letterSpacing: -2.5, color: '#fff' }}>Wind Tunnel</span>
        </div>
        <div style={{ marginTop: 26, maxWidth: 900 }}>
          <BlurText text="A test track for robot policies, with no robot." at={26} style={{ fontFamily: theme.font, fontSize: 44, fontWeight: 600, color: theme.orange2, letterSpacing: -0.6 }} />
        </div>
        <div style={{ marginTop: 36, ...fadeUp(frame, fps, 70) }}>
          <Eyebrow dark>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#76b900' }} />
            NVIDIA Nemotron on Nebius Token Factory
          </Eyebrow>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Seed 7 at v0: the sim second the robot stops beside the pallet for good (it times out at 45 s). */
const STUCK_7 = (() => {
  const f = simulate(7, P(0), { frames: true }).frames ?? [];
  let i = f.length - 1;
  while (i > 0 && f[i - 1]!.v < 0.05) i--;
  return f[i]!.t;
})();

/** Three version-zero failures side by side, each played into its failure. */
export const ProblemScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const panel = { w: 560, h: 520 };
  const clips = [
    { seed: 4, from: 14.6, label: 'Narrow door' },
    { seed: 12, from: 4.4, label: 'Person crossing' },
    { seed: 7, from: 11, label: 'Pallet in the aisle', until: STUCK_7 + 3 },
  ];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, ...fadeUp(frame, fps, 0) }}>
        <Eyebrow>Policy v0 · the first try</Eyebrow>
        <span style={{ fontFamily: theme.font, fontWeight: 800, fontSize: 56, letterSpacing: -1.6, color: theme.ink }}>Pick 3 to Pack 1, and how it fails</span>
      </div>
      <div style={{ display: 'flex', gap: 34, marginTop: 120 }}>
        {clips.map((c, i) => (
          <div key={c.seed} style={{ padding: 7, borderRadius: 32, background: 'rgba(255,255,255,0.42)', boxShadow: '0 30px 60px -30px rgba(120,50,20,0.35)', ...fadeUp(frame, fps, 8 + i * 8) }}>
            <SimView seed={c.seed} policy={P(0)} w={panel.w} h={panel.h} from={c.from} speed={c.seed === 7 ? 3.2 : 1} delay={sec(0.6) + i * sec(1.6)} span={11} radius={26} until={c.until} />
            <div style={{ padding: '12px 10px 6px', fontFamily: theme.font, fontSize: 20, fontWeight: 600, color: theme.ink2 }}>{c.label}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** The 200 tuning seeds at v0, revealed as a wave. */
export const TrackScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const results = useMemo(() => Array.from({ length: 200 }, (_, i) => simulate(i + 1, P(0)).pass), []);
  const revealAt = (i: number) => 24 + ((i % 20) + Math.floor(i / 20)) * 3;
  const shown = results.filter((ok, i) => ok && frame >= revealAt(i)).length;
  const tw = 72;
  const th = 52;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', width: 20 * tw + 19 * 10, marginBottom: 30, ...fadeUp(frame, fps, 0) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Eyebrow>Policy v0 · 200 seeded scenarios</Eyebrow>
          <span style={{ fontFamily: theme.font, fontWeight: 800, fontSize: 56, letterSpacing: -1.6, color: theme.ink }}>One round on the track</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: theme.font, fontWeight: 800, fontSize: 84, letterSpacing: -3, color: theme.ink, lineHeight: 1 }}>
            {shown}
            <span style={{ fontSize: 40, color: theme.muted, letterSpacing: -1 }}> / 200</span>
          </div>
          <div style={{ fontFamily: theme.font, fontSize: 20, color: theme.muted, marginTop: 6 }}>delivered</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(20, ${String(tw)}px)`, gap: 10 }}>
        {results.map((ok, i) => {
          const p = popAt(frame, fps, revealAt(i), 14);
          return (
            <div key={i} style={{ width: tw, height: th, borderRadius: 12, display: 'grid', placeItems: 'center', fontFamily: theme.mono, fontSize: 14, background: p < 0.02 ? 'rgba(255,255,255,0.45)' : ok ? theme.lavSoft : theme.orange, color: ok ? 'rgba(91,43,214,0.6)' : 'rgba(42,15,2,0.75)', transform: `scale(${String(0.7 + 0.3 * p)})` }}>
              {i + 1}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const LookScene: React.FC<SceneProps> = ({ duration }) => {
  const [cx, cy] = at('ov-k0:cta', 0.85, 0.5);
  const click = sec(1.6);
  const keys: CamKey[] = [WIDE(0), WIDE(sec(2.4)), read(sec(3.6), union('ov-look:fails'), 1.6), read(duration - sec(0.6), union('ov-look:fails'), 1.6)];
  return (
    <AbsoluteFill>
      <Camera keys={keys}>
        <Window states={[{ src: 'ov-k0', at: 0 }, { src: 'ov-look', at: click + 6 }]} hero={{ seed: 4, policy: P(0) }} />
        <Cursor keys={[cur(0, 900, 520), cur(click - 8, cx, cy), cur(click, cx, cy, true), cur(click + 40, cx + 40, cy + 30)]} visibleFrom={sec(0.3)} visibleTo={click + 60} />
      </Camera>
      <Callout text="Nemotron 3.5 Super VL: the robot clipped the door frame because it entered the narrow door too fast." at={sec(6.4)} outAt={duration - 14} tone="purple" />
    </AbsoluteFill>
  );
};

export const ProposeScene: React.FC<SceneProps> = ({ duration }) => {
  const keys: CamKey[] = [read(0, union('ov-look:fails'), 1.6), WIDE(sec(1.6)), WIDE(sec(4.2)), readKey(sec(6.2), 'ov-k1:policy', 1.7), readKey(duration - sec(0.4), 'ov-k1:kept', 2.2)];
  return (
    <AbsoluteFill>
      <Camera keys={keys}>
        <Window states={[{ src: 'ov-propose', at: 0 }, { src: 'ov-k1', at: sec(3.2) }]} hero={{ seed: 4, policy: P(1) }} />
      </Camera>
      <Callout text="Nemotron 3 Super: reduce look-ahead to follow the planned path more tightly through narrow doors." at={sec(1.2)} outAt={duration - sec(5.2)} tone="purple" />
      <Callout text="Look-ahead 1.60 m to 1.00 m · Kept · 36.5% to 63.5%" at={duration - sec(4.6)} outAt={duration - 14} tone="green" />
    </AbsoluteFill>
  );
};

export const RejectScene: React.FC<SceneProps> = ({ duration }) => {
  const keys: CamKey[] = [readKey(0, 'ov-k1:kept', 2.2), readKey(sec(1.4), 'ov-k1:rej2', 2.2), readKey(duration, 'ov-k1:rej2', 2.3)];
  return (
    <AbsoluteFill>
      <Camera keys={keys}>
        <Window states={[{ src: 'ov-k1', at: 0 }]} />
      </Camera>
      <Callout text="Planned braking: 73% pass, but 3 safe runs now pass too close to a person. Rejected." at={sec(2.4)} outAt={duration - 14} />
    </AbsoluteFill>
  );
};

export const PairScene: React.FC<SceneProps> = ({ duration }) => {
  const keys: CamKey[] = [readKey(0, 'ov-k1:policy', 1.7), readKey(sec(1.2), 'ov-k2:kept', 2.1), readKey(sec(5.4), 'ov-k2:kept', 2.2), WIDE(duration)];
  return (
    <AbsoluteFill>
      <Camera keys={keys}>
        <Window states={[{ src: 'ov-k1', at: 0 }, { src: 'ov-k2', at: sec(0.6) }]} hero={{ seed: 4, policy: P(2) }} />
      </Camera>
      <Callout text="Gentler braking plus more clearance · Kept · 63.5% to 77%" at={sec(2.2)} outAt={duration - 14} tone="green" />
    </AbsoluteFill>
  );
};

export const BeforeAfterScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const panel = { w: 860, h: 640 };
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, ...fadeUp(frame, fps, 0) }}>
        <Eyebrow>Seed 4 · narrow door, crowded packing</Eyebrow>
        <span style={{ fontFamily: theme.font, fontWeight: 800, fontSize: 56, letterSpacing: -1.6, color: theme.ink }}>Same seed, before and after</span>
      </div>
      <div style={{ display: 'flex', gap: 40, marginTop: 110 }}>
        {[0, 2].map((k, i) => (
          <div key={k} style={{ padding: 7, borderRadius: 34, background: 'rgba(255,255,255,0.42)', boxShadow: '0 30px 60px -30px rgba(120,50,20,0.35)', ...fadeUp(frame, fps, 6 + i * 8) }}>
            <SimView seed={4} policy={P(k)} w={panel.w} h={panel.h} from={8} speed={1.8} delay={sec(0.5)} span={13} radius={28} />
            <div style={{ padding: '12px 12px 6px', fontFamily: theme.font, fontSize: 22, fontWeight: 700, color: theme.ink }}>
              Policy v{k} <span style={{ fontWeight: 500, color: theme.muted }}>{k === 0 ? 'before the loop' : 'after two kept rounds'}</span>
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const ResultScene: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const swap = sec(6.6);
  const keys: CamKey[] = [WIDE(0), readKey(sec(1.2), 'ov-k5:rate', 1.5), readKey(duration, 'ov-k5:rate', 1.55)];
  const pass = useRoll(v0Held.passRate, lastHeld.passRate, sec(1.6), sec(2.4));
  const hits = useRoll(v0Held.collisions, lastHeld.collisions, swap + sec(0.8), sec(2));
  const card = (o: number): React.CSSProperties => ({ ...fadeUp(frame, fps, o), padding: '22px 34px', borderRadius: 28, background: theme.ink, color: '#fff', fontFamily: theme.font, boxShadow: '0 30px 60px -20px rgba(26,18,48,0.45)', minWidth: 420 });
  return (
    <AbsoluteFill>
      <Camera keys={keys}>
        <Window states={[{ src: 'ov-k5', at: 0 }, { src: 'ov-k5-safety', at: swap }]} hero={{ seed: 4, policy: P(5) }} />
      </Camera>
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 50 }}>
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={card(sec(1.4))}>
            <div style={{ fontSize: 18, opacity: 0.7, fontWeight: 600 }}>Pass rate, 200 held-out scenarios</div>
            <div style={{ fontSize: 58, fontWeight: 800, letterSpacing: -2 }}>{v0Held.passRate.toFixed(1)}% <span style={{ color: theme.lav, fontSize: 40 }}>to</span> {pass.toFixed(1)}%</div>
          </div>
          <div style={card(swap)}>
            <div style={{ fontSize: 18, opacity: 0.7, fontWeight: 600 }}>Runs that hit something</div>
            <div style={{ fontSize: 58, fontWeight: 800, letterSpacing: -2 }}>{v0Held.collisions} <span style={{ color: theme.lav, fontSize: 40 }}>to</span> {Math.round(hits)}</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const HonestScene: React.FC<SceneProps> = ({ duration }) => {
  const top: Box = { x: 40, y: 140, w: 1360, h: 420 };
  const low: Box = { x: 40, y: 430, w: 1360, h: 430 };
  const keys: CamKey[] = [read(0, top, 1.25), read(sec(4.5), low, 1.25), read(duration, low, 1.3)];
  return (
    <AbsoluteFill>
      <Camera keys={keys}>
        <Window states={[{ src: 'policy-k5', at: 0 }]} />
      </Camera>
      <Callout text={`Rounds 3 to 5: 14 proposals, all rejected by the simulator`} at={sec(1.0)} outAt={duration - 14} />
    </AbsoluteFill>
  );
};

export const CostScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stat = (v: string, l: string, o: number) => (
    <div style={{ ...fadeUp(frame, fps, o), padding: 7, borderRadius: 34, background: 'rgba(255,255,255,0.42)', boxShadow: '0 30px 60px -30px rgba(120,50,20,0.35)' }}>
      <div style={{ width: 400, padding: '34px 36px', borderRadius: 28, background: '#fff', fontFamily: theme.font }}>
        <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -3, color: theme.ink }}>{v}</div>
        <div style={{ fontSize: 22, color: theme.muted, marginTop: 4 }}>{l}</div>
      </div>
    </div>
  );
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 44 }}>
      <div style={{ display: 'flex', gap: 30 }}>
        {stat('5', 'rounds', 4)}
        {stat('16', 'model calls', 14)}
        {stat(`$${run.costUsd.toFixed(4)}`, 'on Nebius Token Factory', 24)}
      </div>
      <div style={{ display: 'flex', gap: 16, ...fadeUp(frame, fps, 40) }}>
        <Eyebrow>Nemotron 3.5 Super VL · 11 calls</Eyebrow>
        <Eyebrow>Nemotron 3 Super · 5 calls</Eyebrow>
        <Eyebrow>11,400 simulated runs · free</Eyebrow>
      </div>
    </AbsoluteFill>
  );
};

export const OutroScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, ...fadeUp(frame, fps, 4) }}>
        <Logo size={110} />
        <span style={{ fontFamily: theme.font, fontWeight: 800, fontSize: 104, letterSpacing: -3, color: theme.ink }}>Wind Tunnel</span>
      </div>
      <BlurText text="Crash it here, not on the floor." at={30} style={{ fontFamily: theme.font, fontSize: 50, fontWeight: 700, color: theme.orange, letterSpacing: -1 }} />
      <div style={{ marginTop: 18, display: 'flex', gap: 16, ...fadeUp(frame, fps, 70) }}>
        <Eyebrow>github.com/asiyetajwa/windtunnel</Eyebrow>
        <Eyebrow>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: '#76b900' }} />
          NVIDIA Nemotron on Nebius
        </Eyebrow>
      </div>
    </AbsoluteFill>
  );
};
