// Renders the Wind Tunnel film to out/. Usage: npm run render
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';

const comps = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['WindTunnelLandscape'];
// Remotion downloads its own headless shell when this is unset. Cloud sessions
// ship one with Playwright, so prefer that when it exists.
const browser =
  process.env.REMOTION_BROWSER_EXECUTABLE ??
  ['/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'].find((p) => existsSync(p));

mkdirSync('out', { recursive: true });
for (const id of comps) {
  const args = ['remotion', 'render', 'src/index.ts', id, `out/${id}.mp4`];
  if (browser) args.push(`--browser-executable=${browser}`);
  console.log(`Rendering ${id}...`);
  execFileSync('npx', args, { stdio: 'inherit' });
  // Social platforms play back around -14 LUFS; raw ElevenLabs output sits far
  // lower. Normalise the mix and copy the video stream untouched.
  const tmp = `out/${id}.loud.mp4`;
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', `out/${id}.mp4`, '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', tmp],
    { stdio: 'inherit' },
  );
  renameSync(tmp, `out/${id}.mp4`);
}
