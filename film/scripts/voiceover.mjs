// Generates one ElevenLabs voiceover clip per scene from src/<film>/script.ts and
// writes public/voiceover/<film>/manifest.json, which the composition reads to
// stretch each scene to its line.
//
//   ELEVENLABS_API_KEY=... npm run voiceover        (the key needs the Text to Speech permission)
//
// SCRIPT=<dir> reads src/<dir>/script.ts for a film that shares another film's
// script. ELEVENLABS_STABILITY, ELEVENLABS_STYLE and PAUSE (longest kept
// silence, seconds) default to the brisk ad read; documentary reads want more
// stability, less style and longer pauses.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
const film = process.argv[2] ?? 'windtunnel';
if (!/^[a-z]+$/.test(film)) throw new Error(`Unknown film "${film}"`);
// Wind Tunnel is narrated by "Brian" (deep, resonant, American, male) from the ElevenLabs default library.
const voiceId = process.env.ELEVENLABS_VOICE_ID ?? 'nPczCjzI2devNBz1zQrb';
const modelId = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';

// Pull the scene list straight from the TypeScript source so the script stays
// the single source of truth.
const scriptDir = process.env.SCRIPT ?? film;
if (!/^[a-z]+$/.test(scriptDir)) throw new Error(`Unknown script "${scriptDir}"`);
const source = readFileSync(new URL(`../src/${scriptDir}/script.ts`, import.meta.url), 'utf8');
const stability = Number(process.env.ELEVENLABS_STABILITY ?? 0.35);
const style = Number(process.env.ELEVENLABS_STYLE ?? 0.45);
const pause = Number(process.env.PAUSE ?? 0.3);
// ElevenLabs speaking rate, 0.7 to 1.2.
const speed = Number(process.env.ELEVENLABS_SPEED ?? 1.0);
const scenes = [...source.matchAll(/id: '(\w+)',\s*voiceover:\s*\n?\s*(['"])(.*?)\2,/gs)].map((m) => ({
  id: m[1],
  text: m[3].replace(/\\'/g, "'"),
}));
if (scenes.length === 0) throw new Error(`No scenes parsed from src/${scriptDir}/script.ts`);

const outDir = new URL(`../public/voiceover/${film}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });

// ONLY=id1,id2 regenerates just those lines and keeps every other clip from the
// existing manifest (for re-reading one line without touching the rest).
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
let existing = [];
try {
  existing = JSON.parse(readFileSync(new URL('manifest.json', outDir), 'utf8')).clips ?? [];
} catch {
  existing = [];
}

const clips = [];
let previous = '';
for (const [i, scene] of scenes.entries()) {
  const kept = only && !only.has(scene.id) ? existing.find((c) => c.id === scene.id) : undefined;
  if (kept) {
    clips.push(kept);
    previous = scene.text;
    continue;
  }
  const next = scenes[i + 1]?.text ?? '';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      text: scene.text,
      model_id: modelId,
      // Neighbouring lines keep intonation continuous across separate clips.
      previous_text: previous,
      next_text: next,
      voice_settings: { stability, similarity_boost: 0.8, style, use_speaker_boost: true, speed },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${String(res.status)}: ${await res.text()}`);
  const data = await res.json();
  const file = `voiceover/${film}/${scene.id}.mp3`;
  const raw = new URL(`${scene.id}.raw.mp3`, outDir).pathname;
  writeFileSync(raw, Buffer.from(data.audio_base64, 'base64'));
  // Expressive voices leave long gaps between sentences and trail off with
  // silence. Cap every pause (0.3s for ad pacing) and trim the ends. A line with
  // a <break time="Ns" /> tag keeps pauses up to that length, so the break survives.
  const breakSeconds = Math.max(0, ...[...scene.text.matchAll(/<break time="([\d.]+)s"/g)].map((m) => Number(m[1])));
  const linePause = Math.max(pause, breakSeconds);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', raw,
    '-af', `silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=${String(linePause)}:stop_threshold=-45dB:stop_silence=${String(linePause)}`,
    '-c:a', 'libmp3lame', '-b:a', '192k',
    new URL(`${scene.id}.mp3`, outDir).pathname,
  ]);
  unlinkSync(raw);
  const seconds = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', new URL(`${scene.id}.mp3`, outDir).pathname])
      .toString()
      .trim(),
  );
  clips.push({ id: scene.id, file, seconds });
  previous = scene.text;
  console.log(`${scene.id}: ${seconds.toFixed(2)}s`);
}

// Keep the music bed and its start offset from an earlier run (music is chosen
// separately).
let music;
let musicStart;
try {
  ({ music, musicStart } = JSON.parse(readFileSync(new URL('manifest.json', outDir), 'utf8')));
} catch {
  music = undefined;
}
writeFileSync(new URL('manifest.json', outDir), JSON.stringify({ voiceId, modelId, music, musicStart, clips }, null, 2));
console.log(`Wrote public/voiceover/${film}/manifest.json`);
