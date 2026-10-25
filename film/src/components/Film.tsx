import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useVideoConfig,
  type CalculateMetadataFunction,
} from 'remotion';
import { ensureFonts } from '../theme';
import { Backdrop, SceneShell } from './motion';

// Shared shell for every product film: scene sequencing with dissolves,
// per-scene voiceover that stretches its scene, and a faded music bed.

export const FPS = 60;
// Scenes overlap slightly so each dissolve reads as one continuous move.
const OVERLAP = 10;
// Voiceover starts a beat after its scene and leaves a beat of air after.
export const VO_LEAD = 0.15;
const VO_TAIL = 0.35;

export type SceneSpec<Id extends string> = {
  id: Id;
  voiceover: string;
  /** Length in seconds the choreography needs; audio can only extend it. */
  minSeconds: number;
  /** A sound that follows the line (a sign-off sting), `gap` seconds after it ends. The scene grows to fit it. */
  after?: SceneSound;
};

export type SceneSound = { file: string; gap: number; seconds: number; volume: number };

type VoiceoverClip = { id: string; file: string; seconds: number };

export type FilmProps = {
  sceneFrames: Record<string, number>;
  voiceover: VoiceoverClip[];
  music: string | null;
  /** Seconds into the music file where the film's bed starts. */
  musicStart: number;
};

export function createFilm<Id extends string>(
  name: string,
  scenes: SceneSpec<Id>[],
  components: Record<Id, React.FC<{ duration: number }>>,
  /** Canvas behind every scene; films of dark screens pass a dark one so dissolves never flash light. */
  Canvas: React.FC = Backdrop,
) {
  const defaultFrames = (): Record<string, number> =>
    Object.fromEntries(scenes.map((s) => [s.id, Math.round(s.minSeconds * FPS)]));

  const frameOf = (frames: Record<string, number>, id: string) => frames[id] ?? 0;

  const totalFrames = (frames: Record<string, number>) =>
    scenes.reduce((acc, s) => acc + frameOf(frames, s.id), 0) - OVERLAP * (scenes.length - 1);

  const defaultProps: FilmProps = { sceneFrames: defaultFrames(), voiceover: [], music: null, musicStart: 0 };

  /**
   * Reads public/voiceover/<name>/manifest.json (written by scripts/voiceover.mjs)
   * and stretches each scene to fit its line. Without it the film renders silent
   * at the choreographed length.
   */
  const calculateMetadata: CalculateMetadataFunction<FilmProps> = async ({ props }) => {
    const frames = defaultFrames();
    let voiceover: VoiceoverClip[] = [];
    let music: string | null = null;
    let musicStart = 0;
    try {
      const res = await fetch(staticFile(`voiceover/${name}/manifest.json`));
      if (res.ok) {
        const manifest = (await res.json()) as { clips: VoiceoverClip[]; music?: string; musicStart?: number };
        voiceover = manifest.clips;
        music = manifest.music ?? null;
        musicStart = manifest.musicStart ?? 0;
        for (const clip of voiceover) {
          const after = scenes.find((s) => s.id === clip.id)?.after;
          const tail = after ? after.gap + after.seconds + VO_TAIL : VO_TAIL;
          const needed = Math.ceil((clip.seconds + VO_LEAD + tail) * FPS);
          frames[clip.id] = Math.max(frameOf(frames, clip.id), needed);
        }
      }
    } catch {
      // No manifest yet: silent cut.
    }
    return { durationInFrames: totalFrames(frames), props: { ...props, sceneFrames: frames, voiceover, music, musicStart } };
  };

  const Component: React.FC<FilmProps> = ({ sceneFrames, voiceover, music, musicStart }) => {
    ensureFonts();
    const { durationInFrames } = useVideoConfig();
    const musicLevel = voiceover.length > 0 ? 0.22 : 0.5;
    let t = 0;
    return (
      <AbsoluteFill>
        <Canvas />
        {scenes.map((s) => {
          const Scene: React.FC<{ duration: number }> = components[s.id];
          const length = frameOf(sceneFrames, s.id);
          const from = t;
          t += length - OVERLAP;
          const clip = voiceover.find((v) => v.id === s.id);
          return (
            <Sequence key={s.id} from={from} durationInFrames={length} name={s.id}>
              <SceneShell durationInFrames={length}>
                <Scene duration={length} />
              </SceneShell>
              {clip ? (
                <Sequence from={Math.round(VO_LEAD * FPS)}>
                  <Audio src={staticFile(clip.file)} />
                </Sequence>
              ) : null}
              {s.after ? (
                <Sequence from={Math.round((clip ? VO_LEAD + clip.seconds + s.after.gap : length / FPS - s.after.seconds - VO_TAIL) * FPS)}>
                  <Audio src={staticFile(s.after.file)} volume={s.after.volume} />
                </Sequence>
              ) : null}
            </Sequence>
          );
        })}
        {music ? (
          <Audio
            src={staticFile(music)}
            trimBefore={Math.round(musicStart * FPS)}
            volume={(f) =>
              musicLevel *
              interpolate(f, [0, 20, durationInFrames - 70, durationInFrames], [0, 1, 1, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })
            }
          />
        ) : null}
      </AbsoluteFill>
    );
  };

  return { Component, calculateMetadata, defaultProps, durationInFrames: totalFrames(defaultProps.sceneFrames) };
}
