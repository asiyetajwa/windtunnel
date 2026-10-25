# Wind Tunnel: spec (draft for approval)

**Hackathon:** Nebius x NVIDIA Global AI Hackathon, Physical AI track.
**Deadline:** October 30, 2026, 17:00 UTC.

## One line

A test track for robot policies with no robot. Hundreds of simulated runs find where a warehouse robot fails, Nemotron reads the failure frames and names the cause, proposes a fix to the policy, and the pass rate climbs round by round.

## Why it fits the track

The track asks for "embodied and edge agents that sense and act in the real world", powered by NVIDIA open models. Its listed uses include running simulations, generating synthetic data, evaluating robot policies, and processing sensor data at scale.

The FAQ allows simulation in place of hardware if the project runs on Nebius and uses at least one NVIDIA open model. When there is no hardware, the video must show the key modules in action.

## The robot and the task

The robot is a small warehouse tugger, a differential-drive robot that carries a tote from a pick station to packing.

- **Simulator:** a 2D physics simulator in TypeScript. It is deterministic and seeded, and runs about 400 runs a minute on a laptop CPU.
- **Sensors:** a lidar fan and a top-down camera frame, rendered to PNG.
- **Policy:** a readable parameter set covering cruise speed, look-ahead, safety margin, braking distance, yield-to-people rule, re-plan timeout, and turn rate.
  - Code applies it. The model only proposes changes.
- **Scenario generator:** synthetic edge cases including people crossing, a pallet left in the aisle, a wet floor (lower grip), narrow doors, a dropped tote, low light (camera noise), and crowded packing.
  - Every scenario has a seed, so any failure replays exactly.

## The loop (one "round")

1. **Run:** 200 seeded scenarios in parallel on worker threads. Each scenario is pass/fail, with a cause code from the simulator: collision, near miss, timeout, stuck, or tote dropped.
2. **Look:** for up to 8 representative failures, Nemotron 3.5 Super VL reads 3 frames each and writes one plain sentence on what went wrong. An example: "Robot turned into the aisle while a person was 1.2 m away and braked too late on the wet patch".
3. **Group:** Nemotron 3 Super clusters the failures by cause from the sentences and sim stats. It proposes one parameter change per cluster, with its reasoning.
4. **Check:** code clamps each change to safe bounds. It then re-runs the same 200 seeds. A change is kept only if the pass rate rises and no safety metric gets worse (collisions, near misses).
5. **Repeat** for 5 rounds. The chart shows the pass rate climbing from about 60% to about 90%. These are target numbers; we report whatever the run gives.

A held-out set of 200 fresh seeds, never seen during tuning, gives the published before/after score. We apply the same honesty rule as Airlock's leak test.

## NVIDIA and Nebius

| Part | What | Cost |
|---|---|---|
| Nemotron 3.5 Super VL (Token Factory) | Reads failure frames | ~8 images x 5 rounds |
| Nemotron 3 Super (Token Factory) | Clusters failures and proposes changes | 5 calls |
| Nemotron 3 Nano (Token Factory) | Short captions in the app | a few calls |
| Simulation | Local worker threads | $0 |

- **Spend cap in code:** $0.15. About $0.49 of the $1 trial credit is left after Apprentice and Airlock, and the expected spend is about $0.05.
- **Cosmos:** not offered on Token Factory now, so we do not claim it.
- **Nebius Serverless Jobs:** not used, because it would bill compute beyond the Token Factory credit. The README explains how the round runner would fan out as a Serverless Job. It is a container entrypoint (`npm run round`) that already takes a seed range.

## The app (desktop first)

The app is a single desktop dashboard (1440 wide) in the look of the reference: a peach backdrop, a purple hero card with orange accents, white rounded panels, a smooth purple and orange line chart, pill toggles, and a round purple centre button.

- **Hero card:** shows the robot (orange card in place of the credit card), the policy version, and "Test in sim / No robot or crashes".
- **Pass rate panel:**
  - the big number and the held-out score;
  - a toggle between Pass rate and Collisions;
  - a line chart across rounds, with a tooltip on the current round.
- **Live track:** a grid of 12 running scenarios as small top-down views, with failing tiles in orange.
- **Failures this round:** a list like "Transactions of the month". Each row has a frame thumbnail, Nemotron's sentence, the cluster, and its count.
- **Policy changes:** the diff for each round, such as "safety margin 0.40 m to 0.65 m", with kept or rejected status and the reason.
- **Centre button:** Run Round.

## Film (about 1:30, ElevenLabs voice, desktop only)

1. The problem: you cannot crash a real robot 1,000 times.
2. One run: a robot on the track, then a failure.
3. Run Round: 200 scenarios fill the grid.
4. Nemotron reads a failure frame, and its sentence appears.
5. Clusters, then policy changes, then the re-run.
6. The chart climbs over 5 rounds, then the held-out score.
7. The spend line, and the GitHub link.

## Out of scope

- Real hardware.
- Isaac Sim (needs a GPU we would pay for).
- GR00T and Cosmos (not on Token Factory).
- Dedicated endpoints and fine-tunes.
