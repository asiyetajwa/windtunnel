import { continueRender, delayRender, staticFile } from 'remotion';

// Wind Tunnel's look: peach, purple and orange; Plus Jakarta Sans and Geist Mono (both SIL Open Font License).
export const theme = {
  bg: '#f6dccb',
  bg2: '#f1c9b0',
  ink: '#1a1230',
  ink2: '#4a4060',
  muted: '#8d84a0',
  purple: '#5b2bd6',
  purple2: '#8457ff',
  purple3: '#2c1077',
  lav: '#c9b8ff',
  lavSoft: '#efe8ff',
  orange: '#ff7a2e',
  orange2: '#ffae6e',
  good: '#1f9d63',
  goodSoft: '#e5f6ed',
  floor: '#22105c',
  font: "'Plus Jakarta Sans', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
} as const;

let fontsRequested = false;

/** Loads the two fonts before the first frame renders. */
export function ensureFonts(): void {
  if (fontsRequested || typeof document === 'undefined') return;
  fontsRequested = true;
  const handle = delayRender('Loading fonts');
  Promise.all([
    new FontFace('Plus Jakarta Sans', `url(${staticFile('fonts/plus-jakarta-sans-variable.woff2')}) format('woff2')`, { weight: '200 800' }).load(),
    new FontFace('Geist Mono', `url(${staticFile('fonts/geist-mono-variable.woff2')}) format('woff2')`, { weight: '100 900' }).load(),
  ])
    .then((faces) => {
      for (const f of faces) document.fonts.add(f);
    })
    .catch((err: unknown) => {
      console.error(err);
    })
    .finally(() => {
      continueRender(handle);
    });
}
