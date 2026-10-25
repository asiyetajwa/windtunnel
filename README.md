# Wind Tunnel

A test track for robot policies, with no robot. A warehouse robot drives 200 seeded scenarios a round in simulation. NVIDIA Nemotron on Nebius Token Factory looks at the failures, groups them and proposes fixes to the robot's driving policy. The simulator re-runs every proposal on the same 200 scenarios and keeps only what makes the robot better without making it less safe.

**Crash it here, not on the floor.**

**Demo video (1:54):** https://youtu.be/N_AFv_H6oro

## The result (recorded live run, October 24, 2026)

| | Policy v0 | After the loop |
|---|---|---|
| Pass rate on 200 held-out scenarios (never used for tuning) | 36.5% | **73.5%** |
| Pass rate on the 200 tuning scenarios | 36.5% | 77.0% |
| Held-out runs that hit something (person, pallet, door frame, rack) | 47 | **7** |
| Held-out runs with a near miss (within 0.25 m of a person) | 3 | 12 |
| Model calls | | 16 (11 vision, 5 reasoning) |
| Cost | | **$0.0114** |

Near misses went up because many more runs now get far enough to meet people: runs that used to stop dead at a pallet or a door frame now drive the whole route. Hits and near misses together fell from 25.0% to 9.5% of held-out runs.

Five rounds; two of them kept changes:
1. **Round 1:** Nemotron read the door-frame and stuck-at-pallet failures as corner-cutting and proposed a shorter steering look-ahead (1.6 m to 1.0 m). 36.5% to 63.5%. Its gentler-braking idea raised the pass rate to 73%, but 3 runs that had passed now came too close to someone, so the simulator rejected it.
2. **Round 2:** told why that was rejected, Nemotron paired gentler braking with more clearance (2.2 to 1.8 m/s², and 0.3 to 0.5 m). 63.5% to 77%, with no safety regressions.
3. **Rounds 3 to 5:** 14 more proposals, all rejected by the simulator: some lowered the pass rate, and slowing down on wet floors raised it but made 6 safe runs unsafe. The policy stayed at v2.

For scale, a brute-force coordinate search (`scripts/ceiling.ts`, about 38,000 simulated runs and no models) reaches 83% held-out. It ignores the safety rule, though, and its robot takes 35 s a delivery against 26 s for the loop's policy.

## How a round works

1. **Run.** The current policy drives 200 seeded tuning scenarios. Each run passes or fails with a cause from the simulator: hit a person, hit the pallet, clipped the door frame, scraped a rack, near miss, dropped the tote, stuck or timed out.
2. **Look.** For each of the leading failure causes, **Nemotron 3.5 Super VL** reads three frames of one failed run: two moments before the end, and the end. It says in one sentence what went wrong.
3. **Group and propose.** **Nemotron 3 Super** (reasoning on) gets the failures by cause, the simulator's run logs, the vision readings, the policy with each value's bounds, and every change tried so far. It returns clusters and up to five proposals through a forced tool call. A proposal can change one value, or two values that only work as a pair.
4. **Check.** Code clamps each value to its bounds and re-runs the same 200 scenarios. A proposal is kept only if:
   - the pass rate rises by at least half a point;
   - at most 1 in 100 runs that passed before now hits or nearly hits something.

   Kept proposals are combined one at a time and re-checked at each step.

The model never drives. It proposes numbers; code applies them every tick and the simulator decides what stays. The 200 held-out scenarios are scored for the record and never shown to the loop.

## The simulator

`src/sim/` is a deterministic 2D simulator in TypeScript, hundreds of runs a second on one CPU core:
- **The robot:** a differential-drive tugger carrying a tote from a pick station, down an aisle between racks, through a door into a packing room.
- **Driving and braking:**
  - pure-pursuit steering with a turn-rate cap and steering lag;
  - braking limited by floor grip;
  - a tote that slides off when the robot brakes harder than the tote can take.
- **Sensors:**
  - a camera that sees people only once they step out from between the racks: 8 m in good light, 3 m in low light;
  - a lidar for static obstacles;
  - a 1.5 m safety field.
- **Scenarios:** generated from a seed, so a failure replays exactly. They include:
  - people crossing, often on a spill;
  - a pallet left in the aisle;
  - wet floor;
  - narrow doors;
  - low light;
  - a crowded packing room.

The policy is eight named numbers (`src/sim/policy.ts`), such as cruise speed, look-ahead, safety margin, planned braking and wet-floor speed.

## NVIDIA and Nebius

| Part | What it does |
|---|---|
| `nvidia/Nemotron-3.5-Super-VL` on Nebius Token Factory | Reads the failure frames |
| `nvidia/nemotron-3-super-120b-a12b` on Nebius Token Factory | Groups failures, proposes policy changes (reasoning on, tool call output) |
| Simulator, on the local CPU | Every run, every check; costs nothing |

**Spend guard.** Every model call goes through a spend guard (`packages/nebius-core`):
- it reads Token Factory's published prices;
- it reserves each call's worst case before sending;
- it records the real cost from the returned usage in a ledger;
- it refuses anything past `WINDTUNNEL_BUDGET_USD`;
- it stops all calls on any billing error.

There are no dedicated endpoints and no fine-tuning.

**Why no Serverless Jobs.** A round is about 2,300 simulated runs (11,400 for the whole five-round run) and takes seconds on one CPU, so this demo does not use Nebius Serverless Jobs. The round runner fits one, though: it is a single command that takes a seed range. At scale (a physics engine instead of 2D kinematics, thousands of scenarios), each seed range would run as a Serverless Job and the results would be merged before the look step.

## Run it

```bash
npm install
npm test             # simulator, safety rule and frame rendering
npm start            # the app at http://127.0.0.1:8790, replaying data/run.json
```

The app replays the recorded run: what Nemotron read, grouped and proposed, and what the simulator kept. Every scene on screen is re-simulated in the browser from its seed and policy.

To run the loop live, put a Nebius Token Factory key in `.env` (see `.env.example`), then:

```bash
npm run rounds       # five rounds, writes data/run.json
```

Runs vary: the models are not perfectly repeatable, and some rounds find nothing that passes the checks.

## Layout

- `src/sim/`: the scenario generator, the simulator, the policy and its bounds, and the frame renderer.
- `src/loop/round.ts`: one round (run, look, group and propose, check).
- `scripts/rounds.ts`: runs the loop and records it.
- `scripts/ceiling.ts`: the brute-force comparison.
- `src/web/`: the desktop app.
- `src/server/`: serves the app and the recorded run.
- `packages/nebius-core/`: the Token Factory client and the spend guard.
- `data/run.json`: the recorded live run, including every frame strip the vision model read.

## License

MIT
