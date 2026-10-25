import { createFilm } from '../components/Film';
import { SCENES } from './script';
import { BeforeAfterScene, CostScene, HonestScene, IntroScene, LookScene, OutroScene, PairScene, ProblemScene, ProposeScene, RejectScene, ResultScene, TrackScene } from './scenes';

export const windTunnelFilm = createFilm('windtunnel', SCENES, {
  intro: IntroScene,
  problem: ProblemScene,
  track: TrackScene,
  look: LookScene,
  propose: ProposeScene,
  reject: RejectScene,
  pair: PairScene,
  beforeafter: BeforeAfterScene,
  result: ResultScene,
  honest: HonestScene,
  cost: CostScene,
  outro: OutroScene,
});
