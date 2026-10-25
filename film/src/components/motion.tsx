import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { theme } from '../theme';

// Finite stand-in for "never"; interpolate() rejects Infinity in its input range.
export const NEVER = 1e9;

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
// Long, soft ease used for every camera move.
export const cameraEase = Easing.bezier(0.7, 0, 0.2, 1);

/** Soft, slightly bouncy spring for things that appear. */
export function popAt(frame: number, fps: number, at: number, damping = 16): number {
  return spring({ frame: frame - at, fps, config: { damping, mass: 0.8, stiffness: 140 } });
}

export function usePop(at: number, damping = 16): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return popAt(frame, fps, at, damping);
}

/** Tween between keyframes with the camera ease. Holds the ends. */
export function track(frame: number, frames: number[], values: number[]): number {
  if (frames.length === 0) return 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1] ?? 0;
    const b = frames[i] ?? 0;
    if (frame <= b) {
      return interpolate(frame, [a, b], [values[i - 1] ?? 0, values[i] ?? 0], { ...clamp, easing: cameraEase });
    }
  }
  return values[values.length - 1] ?? 0;
}

export type CamKey = { f: number; x: number; y: number; z: number };

export function cameraAt(frame: number, keys: CamKey[]): { x: number; y: number; z: number } {
  const fs = keys.map((k) => k.f);
  return {
    x: track(frame, fs, keys.map((k) => k.x)),
    y: track(frame, fs, keys.map((k) => k.y)),
    z: track(frame, fs, keys.map((k) => k.z)),
  };
}

/**
 * World space is centred on (0, 0). The camera looks at (x, y) at zoom z, so
 * everything inside, the cursor included, scales together like a real lens.
 */
export const Camera: React.FC<{ keys: CamKey[]; children: React.ReactNode }> = ({ keys, children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const base = Math.min(width / 1920, height / 1080) * (height > width ? 1.55 : 1);
  const c = cameraAt(frame, keys);
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: width / 2,
          top: height / 2,
          transform: `scale(${String(c.z * base)}) translate(${String(-c.x)}px, ${String(-c.y)}px)`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

export const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: theme.bg,
      backgroundImage: `radial-gradient(60% 55% at 0% 0%, #fde9dc 0%, rgba(253,233,220,0) 70%), radial-gradient(60% 70% at 100% 100%, ${theme.bg2} 0%, rgba(241,201,176,0) 70%)`,
    }}
  />
);

/** Scene-level fade with a touch of blur, so cuts dissolve like a lens refocus. */
export const SceneShell: React.FC<{ durationInFrames: number; children: React.ReactNode }> = ({
  durationInFrames,
  children,
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: easeOut });
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames], [0, 1], clamp);
  const opacity = Math.min(enter, 1 - exit);
  const blur = (1 - enter) * 10 + exit * 10;
  return <AbsoluteFill style={{ opacity, filter: blur > 0.05 ? `blur(${String(blur)}px)` : undefined }}>{children}</AbsoluteFill>;
};

export type CursorKey = { f: number; x: number; y: number; click?: boolean };

function cursorPos(frame: number, keys: CursorKey[]): { x: number; y: number } {
  const fs = keys.map((k) => k.f);
  return { x: track(frame, fs, keys.map((k) => k.x)), y: track(frame, fs, keys.map((k) => k.y)) };
}

const Arrow: React.FC<{ opacity: number; scale: number; blur?: number }> = ({ opacity, scale, blur = 0 }) => (
  <svg
    width={46}
    height={50}
    viewBox="0 0 23 25"
    style={{
      position: 'absolute',
      left: -5,
      top: -3,
      opacity,
      transform: `scale(${String(scale)})`,
      transformOrigin: '5px 3px',
      filter: blur > 0 ? `blur(${String(blur)}px)` : 'drop-shadow(0 10px 18px rgba(0,0,0,0.22))',
    }}
  >
    <path d="M3 2 L20 11.2 L12.4 13.2 L9 20.6 Z" fill="#171717" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
  </svg>
);

/** Black pointer in world space with a short motion trail and click press. */
export const Cursor: React.FC<{ keys: CursorKey[]; visibleFrom?: number; visibleTo?: number }> = ({
  keys,
  visibleFrom = 0,
  visibleTo = NEVER,
}) => {
  const frame = useCurrentFrame();
  const p = cursorPos(frame, keys);
  const fade = Math.min(
    interpolate(frame, [visibleFrom, visibleFrom + 10], [0, 1], clamp),
    interpolate(frame, [visibleTo - 10, visibleTo], [1, 0], clamp),
  );
  if (fade <= 0) return null;
  const clicks = keys.filter((k) => k.click);
  const press = clicks.reduce((acc, k) => {
    const d = frame - k.f;
    return d >= -4 && d < 8 ? Math.min(acc, d < 0 ? 1 - ((d + 4) / 4) * 0.16 : 0.84 + (d / 8) * 0.16) : acc;
  }, 1);
  const trail = [1, 2, 3, 4].map((i) => ({ i, ...cursorPos(frame - i * 1.2, keys) }));
  const speed = Math.hypot(p.x - (trail[0]?.x ?? p.x), p.y - (trail[0]?.y ?? p.y));
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
      {speed > 2
        ? trail.map((t) => (
            <div key={t.i} style={{ position: 'absolute', left: t.x, top: t.y }}>
              <Arrow opacity={fade * Math.min(1, speed / 30) * (0.22 - t.i * 0.04)} scale={press} blur={2} />
            </div>
          ))
        : null}
      <div style={{ position: 'absolute', left: p.x, top: p.y }}>
        <Arrow opacity={fade} scale={press} />
      </div>
    </div>
  );
};

/** Characters sharpen from blur left to right, then blur away on exit. */
export const BlurText: React.FC<{
  text: string;
  at: number;
  outAt?: number;
  style?: React.CSSProperties;
}> = ({ text, at, outAt = NEVER, style }) => {
  const frame = useCurrentFrame();
  // Characters animate individually but sit inside unbreakable word spans, so
  // lines only wrap between words.
  let index = 0;
  const words = text.split(' ').map((word) => {
    const chars = [...word].map((ch) => ({ ch, i: index++ }));
    index++;
    return chars;
  });
  const charStyle = (i: number): React.CSSProperties => {
    const t = interpolate(frame, [at + i * 0.9, at + i * 0.9 + 16], [0, 1], { ...clamp, easing: easeOut });
    const o = interpolate(frame, [outAt + i * 0.4, outAt + i * 0.4 + 12], [0, 1], clamp);
    const blur = (1 - t) * 12 + o * 12;
    return {
      display: 'inline-block',
      opacity: t * (1 - o),
      filter: blur > 0.05 ? `blur(${String(blur)}px)` : undefined,
      transform: `translateY(${String((1 - t) * 6)}px)`,
    };
  };
  return (
    <span style={style}>
      {words.map((chars, w) => (
        <React.Fragment key={w}>
          {w > 0 ? ' ' : null}
          <span style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
            {chars.map(({ ch, i }) => (
              <span key={i} style={charStyle(i)}>
                {ch}
              </span>
            ))}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
};

/** Rolls a number between two values from frame `start`. */
export function useRoll(from: number, to: number, start: number, length: number): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [start, start + length], [from, to], { ...clamp, easing: easeOut });
}
