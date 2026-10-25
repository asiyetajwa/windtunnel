// Wind Tunnel film: scene order, voiceover lines and minimum on-screen time. The screens are stills of the real
// app (scripts/capture.mjs); every robot scene is drawn frame by frame by the app's own simulator (../src/sim), and
// every number and model reading is from the recorded live run (data/run.json). Voiceover: npm run voiceover
// Written for the ear: numbers as words. <break time="0.4s" /> is an ElevenLabs pause tag.

export type SceneId = 'intro' | 'problem' | 'track' | 'look' | 'propose' | 'reject' | 'pair' | 'beforeafter' | 'result' | 'honest' | 'cost' | 'outro';

export type SceneSpec = {
  id: SceneId;
  voiceover: string;
  /** Length in seconds the choreography needs; audio can only extend it. */
  minSeconds: number;
  /** A sound after the line (public/sfx, made with ElevenLabs Sound Effects). */
  after?: { file: string; gap: number; seconds: number; volume: number };
};

export const SCENES: SceneSpec[] = [
  { id: 'intro', voiceover: 'This is Wind Tunnel: a test track for robot policies, with no robot.', minSeconds: 5.6 },
  { id: 'problem', voiceover: 'A warehouse robot carries a tote down an aisle, through a door, to packing. Version zero clips the door frame, drops its tote, and gets stuck at a pallet.', minSeconds: 10.0 },
  { id: 'track', voiceover: 'Each round, the simulator drives it through two hundred seeded scenarios. Version zero delivers barely one in three.', minSeconds: 8.0 },
  { id: 'look', voiceover: 'Then NVIDIA Nemotron, on Nebius Token Factory, takes a look. Nemotron 3.5 Super VL reads three frames of each kind of failure and says what went wrong.', minSeconds: 11.0 },
  { id: 'propose', voiceover: 'Nemotron 3 Super reasons over those readings and the simulator\'s logs. The robot is cutting corners, so it proposes a shorter steering look-ahead. The simulator re-runs it on the same two hundred seeds. Kept: thirty-six to sixty-three percent.', minSeconds: 13.0 },
  { id: 'reject', voiceover: 'Gentler braking scores even higher. But three runs that were safe now pass too close to a person. Rejected.', minSeconds: 8.0 },
  { id: 'pair', voiceover: 'Told why, Nemotron pairs gentler braking with more clearance. Seventy-seven percent, and no safe run got less safe.', minSeconds: 8.5 },
  { id: 'beforeafter', voiceover: 'Same seed, before and after.', minSeconds: 10.5 },
  { id: 'result', voiceover: 'On two hundred scenarios it never trained on, the pass rate doubled, from thirty-six and a half to seventy-three and a half percent. Runs that hit something fell from forty-seven to seven.', minSeconds: 12.0 },
  { id: 'honest', voiceover: 'The last three rounds found nothing that passed the checks, so nothing changed. The model proposes. <break time="0.3s" /> The simulator decides.', minSeconds: 9.0 },
  { id: 'cost', voiceover: 'Five rounds, sixteen model calls, about one cent.', minSeconds: 5.5 },
  { id: 'outro', voiceover: 'Wind Tunnel. <break time="0.4s" /> Crash it here, not on the floor.', minSeconds: 5.6, after: { file: 'sfx/chime.mp3', gap: 0.3, seconds: 1.4, volume: 0.35 } },
];
