// Stub mode: the same Transport, answered locally. The app supplies the answers to chat calls (it knows
// what a teacher, grader or student should say); this file simulates the rest of Token Factory: file
// uploads, a fine-tuning job that runs for a while with falling loss, and adapter deployment.
// Every stub answer is labelled stub in the call log, so stub numbers are never mistaken for real ones.

import { messageSize, type ChatRequest, type ChatResult, type Checkpoint, type DeployedModel, type FineTuneJob, type Hyperparameters, type Transport } from './client.js';

export type StubResponder = (req: ChatRequest) => string;

export interface StubOptions {
  respond: StubResponder;
  /** Scales every simulated wait: 1 is a watchable demo, 0 is instant (tests). */
  speed?: number;
  /** Simulated seconds for a fine-tuning job at speed 1. */
  trainSeconds?: number;
}

const tokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

export class StubTransport implements Transport {
  readonly live = false;
  private jobs = new Map<string, { job: FineTuneJob; started: number; epochs: number; seconds: number }>();
  private deployed = new Map<string, { model: DeployedModel; at: number }>();
  private seq = 0;

  constructor(private opts: StubOptions) {}

  private get speed(): number {
    return this.opts.speed ?? 1;
  }

  private wait(ms: number): Promise<void> {
    const t = ms * this.speed;
    return t > 0 ? new Promise((r) => setTimeout(r, t)) : Promise.resolve();
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const text = this.opts.respond(req);
    const tokensIn = req.messages.reduce((s, m) => s + Math.ceil(messageSize(m).chars / 4) + 1500 * messageSize(m).images, 0);
    const tokensOut = tokens(text);
    // Bigger models think longer; the numbers are only for the feel of the demo.
    const base = /ultra/i.test(req.model) ? 900 : /super/i.test(req.model) ? 450 : 60;
    const latencyMs = Math.round(base + tokensOut * (/ultra/i.test(req.model) ? 6 : /super/i.test(req.model) ? 3 : 0.4));
    await this.wait(latencyMs / 8);
    return { text, tokensIn, tokensOut, latencyMs };
  }

  async uploadFile(_name: string, jsonl: string): Promise<{ id: string; bytes: number }> {
    await this.wait(300);
    return { id: `file-stub-${String(++this.seq)}`, bytes: Buffer.byteLength(jsonl) };
  }

  async createFineTune(args: { model: string; trainingFile: string; suffix: string; hyperparameters: Hyperparameters }): Promise<FineTuneJob> {
    await this.wait(400);
    const id = `ftjob-stub-${String(++this.seq)}`;
    const job: FineTuneJob = { id, model: args.model, status: 'validating_files', fineTunedModel: null, createdAt: new Date().toISOString(), finishedAt: null, error: null, trainedTokens: null };
    this.jobs.set(id, { job, started: Date.now(), epochs: args.hyperparameters.n_epochs, seconds: (this.opts.trainSeconds ?? 40) * this.speed });
    return { ...job };
  }

  private progress(id: string): { entry: { job: FineTuneJob; started: number; epochs: number; seconds: number }; p: number } {
    const entry = this.jobs.get(id);
    if (!entry) throw new Error(`No stub job ${id}`);
    const p = entry.seconds <= 0 ? 1 : Math.min(1, (Date.now() - entry.started) / (entry.seconds * 1000));
    return { entry, p };
  }

  async getFineTune(id: string): Promise<FineTuneJob> {
    const { entry, p } = this.progress(id);
    const j = entry.job;
    j.status = p >= 1 ? 'succeeded' : p > 0.12 ? 'running' : p > 0.05 ? 'queued' : 'validating_files';
    if (p >= 1 && !j.fineTunedModel) {
      j.fineTunedModel = `ft:${j.model.split('/').pop()}:apprentice:${id.slice(-4)}`;
      j.finishedAt = new Date().toISOString();
      j.trainedTokens = 184_000;
    }
    return { ...j };
  }

  async checkpoints(id: string): Promise<Checkpoint[]> {
    const { entry, p } = this.progress(id);
    // One checkpoint per epoch reached, loss falling the way a small LoRA run does.
    const reached = Math.floor(p * entry.epochs + 1e-9);
    return Array.from({ length: reached }, (_, i) => ({
      id: `ckpt-${String(i + 1)}`,
      step: (i + 1) * 30,
      model: `${entry.job.model}:ckpt-step-${String((i + 1) * 30)}`,
      trainLoss: Number((1.42 * Math.exp(-1.15 * (i + 1)) + 0.12).toFixed(3)),
      validLoss: Number((1.38 * Math.exp(-1.0 * (i + 1)) + 0.18).toFixed(3)),
    }));
  }

  async deployLora(args: { name: string; baseModel: string; source: string }): Promise<DeployedModel> {
    await this.wait(500);
    const model = { name: args.name, status: 'pending', baseModel: args.baseModel };
    this.deployed.set(args.name, { model, at: Date.now() });
    return { ...model };
  }

  async getDeployed(name: string): Promise<DeployedModel> {
    const d = this.deployed.get(name);
    if (!d) throw new Error(`No stub model ${name}`);
    if (Date.now() - d.at > 4000 * this.speed) d.model.status = 'active';
    return { ...d.model };
  }

  async listModels(): Promise<string[]> {
    return ['nvidia/Nemotron-3-Ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/Nemotron-3_5-Lightning', 'meta-llama/Meta-Llama-3.1-8B-Instruct'];
  }
}
