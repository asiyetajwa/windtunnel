# Devpost Submission Draft

Copy each section into the Devpost form.
- **Hackathon:** Nebius x NVIDIA Global AI Hackathon (https://nebiusglobalaihackathon.devpost.com/).
- **Track:** Physical AI.
- **Deadline:** October 30, 2026, 17:00 UTC (10:00 PT). Confirm on the official page.

## Links

- **Demo video (YouTube, 1:54):** https://youtu.be/N_AFv_H6oro (must be **Public** before submitting; the rules ask for a public video under 3 minutes with no third-party trademarks or copyrighted music)
- **Repository (public, MIT license):** https://github.com/asiyetajwa/windtunnel
- **Thumbnail:** `docs/thumbnail.jpg` (3:2) and `docs/thumbnail-youtube.jpg` (16:9).

There is no physical hardware. The track's video rule allows that: "if your Project has no physical hardware component, the key application modules in action". The FAQ allows simulation when the project runs on Nebius and uses at least one NVIDIA open model.

The film shows every module working:
- the simulator, whose robot scenes are drawn frame by frame by the project's own simulator;
- the vision model reading failures;
- the reasoning model proposing changes;
- the simulator accepting and rejecting them;
- the held-out score.

The narration is an ElevenLabs voice. The music and sound effects were made with ElevenLabs on Brian's account.

## Project name

Wind Tunnel

## Tagline

A test track for robot policies, with no robot. NVIDIA Nemotron on Nebius reads the failures and proposes the fix; the simulator decides what stays.

## Built with

TypeScript, Node.js, Express, NVIDIA Nemotron 3.5 Super VL, NVIDIA Nemotron 3 Super, Nebius Token Factory, resvg, Remotion, Playwright, ElevenLabs

## Description

### Inspiration

You cannot crash a real warehouse robot a thousand times to find out where its driving policy breaks. Robot teams test in simulation, but then someone still has to watch the failures, work out why they happened and decide what to change. We wanted that loop to run by itself: the simulator finds the failures, an NVIDIA model looks at them and proposes a fix, and the simulator, not the model, decides whether the fix is any good.

### What it does

A small warehouse robot carries a tote from a pick station, down an aisle, through a door, to packing. Its driving policy is eight numbers, such as cruise speed, steering look-ahead, safety margin, planned braking and wet-floor speed.

Each round:
1. **Run.** The policy drives 200 seeded scenarios: people crossing (often on a spill), a pallet left in the aisle, wet floors, narrow doors, low light, a crowded packing room. Each run passes or fails with a cause: hit a person, clipped the door frame, dropped the tote, stuck, and so on.
2. **Look.** **Nemotron 3.5 Super VL** reads three frames of one failure per leading cause and says in one sentence what went wrong.
3. **Group and propose.** **Nemotron 3 Super**, with reasoning on, gets three kinds of input and returns failure clusters and up to five policy changes through a forced tool call:
   - the failures and the simulator's run logs;
   - the vision readings;
   - every change tried so far.
4. **Check.** Code clamps each value to its bounds and re-runs the same 200 scenarios. A change is kept only if the pass rate rises and at most 1 in 100 runs that passed before now hits or nearly hits something.

The model never drives. It proposes numbers; code applies them and the simulator decides.

**Results of the recorded live run, on 200 held-out scenarios the loop never saw:**
- **Pass rate:** 36.5% to **73.5%**.
- **Runs that hit something:** 47 to **7**.
- **Cost:** five rounds, 16 model calls, **$0.0114**.

### How the rounds went

- **Round 1.** Nemotron read the door-frame and stuck-at-pallet failures as the robot cutting corners. It proposed a shorter steering look-ahead: kept, 36.5% to 63.5%. It also proposed gentler braking, which scored 73% but made 3 runs that had been safe pass too close to a person, so the simulator rejected it.
- **Round 2.** Told why it was rejected, Nemotron paired gentler braking with more clearance: kept, 77%, with no safety regressions.
- **Rounds 3 to 5.** 14 more proposals, all rejected by the simulator. Some lowered the pass rate; slowing down on wet floors raised it but made 6 safe runs unsafe. The policy stayed where it was.

### How we built it

- **The simulator** is our own deterministic 2D simulator in TypeScript, running hundreds of runs a second on one CPU core. It models:
  - differential-drive steering with pure pursuit, a turn-rate cap and steering lag;
  - braking limited by floor grip;
  - a tote that slides off past its grip;
  - a camera that sees people only once they step out from between the racks (8 m, or 3 m in low light);
  - a lidar and a 1.5 m safety field.

  Every scenario comes from a seed, so any failure replays exactly.
- **The vision model** gets a single PNG of three close-up frames, rendered by the same code that draws the app, with a heads-up line of time, speed and braking.
- **The reasoning model** answers through a forced tool call with a strict schema, so its output is always parseable. Reasoning on costs about three thousand tokens a call, a fraction of a cent.
- **The spend guard** sits in front of every Token Factory call:
  - it reads published prices;
  - it reserves each call's worst case before sending;
  - it records the real cost in a ledger;
  - it refuses anything past the cap;
  - it halts on any billing error.

  There are no dedicated endpoints and no fine-tuning.
- **The desktop app** replays the recorded run. The browser re-simulates every scene from its seed and policy, so every picture on screen is the real simulation.

### Challenges we ran into

- **The first version of the loop got stuck for five rounds.** Without the reasoning step, Nemotron kept proposing the same small changes. We made three changes:
  - the simulator writes a plain-language run log for each failure, the line a real robot log would carry, such as "reached the door 0.30 m off its centre line";
  - a proposal may change two values together;
  - reasoning is on for the proposal step.

  After that, both runs we recorded with reasoning on found the look-ahead fix and the braking-plus-clearance pair within three rounds (rounds 1 and 2 in the run we publish).
- **The first keep rule was wrong.** We kept a change only if total near misses did not go up. But a better policy gets more runs far enough to meet people, so a clearly safer change raised the raw count. The rule now compares the same seeds before and after: a run that passed and now hits or nearly hits something counts against the change.
- **Free-text JSON from the reasoning model was malformed twice.** A forced tool call with a strict schema fixed it.

### Accomplishments that we're proud of

- **The simulator says no.** 19 of the 21 proposals were rejected, including five that raised the pass rate but made safe runs unsafe.
- **An honest held-out score.** The 200 held-out scenarios are never shown to the loop.
- **About one cent for the whole run.**

### What we learned

The model is most useful as the part that reads and explains, not the part that decides. Giving it the simulator's own words, and a reason when a proposal was rejected, mattered more than a bigger model would have.

We also compared the loop to brute force. A coordinate search over the same eight numbers, about 38,000 simulated runs and no models, reaches 83% held-out. It ignores the safety rule, though, and its robot takes 35 s a delivery against 26 s for the loop's policy.

### What's next for Wind Tunnel

- Swap the 2D simulator for a physics engine such as Isaac Sim, and run each seed range as a Nebius Serverless Job.
- Add Cosmos for synthetic edge cases when it is served on Token Factory again.
- Test policies for other robots (arms, mobile manipulators) with the same propose-and-check loop.

## Spend line

| Model | Calls | Cost |
|---|---|---|
| Nemotron 3.5 Super VL (frames) | 11 | about $0.003 |
| Nemotron 3 Super (reasoning, proposals) | 5 | about $0.008 |
| **Recorded run total** | **16** | **$0.0114** |

All Wind Tunnel development calls, including runs before the recorded one, came to $0.089. The cap in code is $0.15.
