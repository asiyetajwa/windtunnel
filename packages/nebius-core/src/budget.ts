// Spend guard for live Token Factory use. Every paid call goes through it:
// - Prices come from Token Factory itself (GET /v1/models?verbose=true), never from guesses. A model with no
//   published price is refused.
// - Before a chat call, its worst case (input estimate plus max_tokens of output, reasoning included) is
//   reserved; the call is refused if spent + reserved + worst case would pass the cap.
// - After it, the real cost from the returned usage is written to a ledger file, so the total survives restarts
//   and is shared by every process that uses the same ledger.
// - Any balance, billing, credit or trial error halts all further calls, and the halt is written to the ledger.
// - Fine-tuning needs an approved quote (APPRENTICE_FINETUNE_QUOTE_USD) that fits under the cap.
// - Deploying a model is refused: on Token Factory it means a dedicated endpoint, which bills by the hour.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { TokenFactoryError, messageSize, type ChatRequest, type ChatResult, type Checkpoint, type DeployedModel, type FineTuneJob, type Hyperparameters, type Transport } from './client.js';

export interface Price { in: number; out: number }

export class BudgetError extends Error {}

interface LedgerLine { at: string; kind: 'chat' | 'finetune' | 'halt'; model?: string; tokensIn?: number; tokensOut?: number; usd?: number; note?: string }

const BILLING = /balance|billing|credit|quota|trial|insufficient|payment|deactivated|suspended/i;

export class SpendGuard {
  private reserved = 0;
  private prices = new Map<string, Price>();

  constructor(
    readonly capUsd: number,
    readonly ledgerPath: string,
    readonly fineTuneQuoteUsd: number | null = null,
  ) {
    if (!(capUsd > 0)) throw new BudgetError('Set WINDTUNNEL_BUDGET_USD to a positive spend cap before making live calls.');
  }

  private lines(): LedgerLine[] {
    if (!existsSync(this.ledgerPath)) return [];
    return readFileSync(this.ledgerPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LedgerLine);
  }

  /** Real spend so far, from the ledger. */
  spent(): number {
    return this.lines().reduce((t, l) => t + (l.usd ?? 0), 0);
  }

  halted(): string | null {
    return this.lines().find((l) => l.kind === 'halt')?.note ?? null;
  }

  private write(line: Omit<LedgerLine, 'at'>): void {
    appendFileSync(this.ledgerPath, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
  }

  setPrices(prices: Map<string, Price>): void {
    this.prices = prices;
  }

  priceOf(model: string): Price {
    const p = this.prices.get(model);
    if (!p) throw new BudgetError(`No published Token Factory price for ${model}; refusing the call.`);
    return p;
  }

  private check(worstUsd: number, what: string): void {
    const halt = this.halted();
    if (halt) throw new BudgetError(`Live calls are halted: ${halt}`);
    const spent = this.spent();
    if (spent + this.reserved + worstUsd > this.capUsd) {
      throw new BudgetError(`Refused ${what}: spent $${spent.toFixed(4)}, in flight $${this.reserved.toFixed(4)}, this call up to $${worstUsd.toFixed(4)}, cap $${this.capUsd.toFixed(2)}.`);
    }
  }

  /** Reserve a chat call's worst case; returns the release function that records the real cost. */
  reserveChat(req: ChatRequest): { worst: number; settle: (out: ChatResult | null) => void } {
    const price = this.priceOf(req.model);
    const size = req.messages.map(messageSize);
    const chars = size.reduce((t, s) => t + s.chars, 0) + (req.extraBody ? JSON.stringify(req.extraBody).length : 0);
    // An image is billed as prompt tokens; a generous fixed allowance per image keeps the reservation a worst case.
    const images = size.reduce((t, s) => t + s.images, 0);
    const inEst = Math.ceil(chars / 3) + 40 * req.messages.length + 200 + 3000 * images;
    const worst = (price.in * inEst + price.out * (req.maxTokens ?? 512)) / 1e6;
    this.check(worst, `${req.model} call`);
    this.reserved += worst;
    return {
      worst,
      settle: (out) => {
        this.reserved -= worst;
        if (!out) return;
        const usd = (price.in * out.tokensIn + price.out * out.tokensOut) / 1e6;
        this.write({ kind: 'chat', model: req.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut, usd });
      },
    };
  }

  checkFineTune(): number {
    if (this.fineTuneQuoteUsd == null) throw new BudgetError('Fine-tuning refused: no approved price quote (set APPRENTICE_FINETUNE_QUOTE_USD once one is approved).');
    this.check(this.fineTuneQuoteUsd, 'fine-tuning job');
    return this.fineTuneQuoteUsd;
  }

  recordFineTune(model: string, usd: number, note: string): void {
    this.write({ kind: 'finetune', model, usd, note });
  }

  /** Halt on any billing-shaped error, verbatim. */
  inspect(err: unknown): void {
    if (err instanceof TokenFactoryError && (err.status === 402 || BILLING.test(err.body))) {
      this.write({ kind: 'halt', note: `Token Factory ${String(err.status)}: ${err.body.slice(0, 500)}` });
    }
  }
}

/** Reads published prices: USD per token in the API, stored here per 1M tokens. */
export async function fetchPrices(apiKey: string, baseUrl = 'https://api.tokenfactory.nebius.com/v1'): Promise<Map<string, Price>> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models?verbose=true`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new TokenFactoryError(`Token Factory ${String(res.status)} on /models`, res.status, await res.text());
  const body = (await res.json()) as { data: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
  const out = new Map<string, Price>();
  for (const m of body.data) {
    const pin = Number(m.pricing?.prompt);
    const pout = Number(m.pricing?.completion);
    if (Number.isFinite(pin) && Number.isFinite(pout)) out.set(m.id, { in: pin * 1e6, out: pout * 1e6 });
  }
  return out;
}

/** Wraps the live transport so nothing that costs money happens outside the guard. */
export class GuardedTransport implements Transport {
  readonly live = true;
  private ready: Promise<void> | null = null;

  constructor(
    private inner: Transport,
    readonly guard: SpendGuard,
    private loadPrices: () => Promise<Map<string, Price>>,
  ) {}

  private async prices(): Promise<void> {
    this.ready ??= this.loadPrices().then((p) => this.guard.setPrices(p));
    await this.ready;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    await this.prices();
    const slot = this.guard.reserveChat(req);
    try {
      const out = await this.inner.chat(req);
      slot.settle(out);
      return out;
    } catch (err) {
      slot.settle(null);
      this.guard.inspect(err);
      throw err;
    }
  }

  async createFineTune(args: { model: string; trainingFile: string; validationFile?: string; suffix: string; hyperparameters: Hyperparameters; seed: number }): Promise<FineTuneJob> {
    const quote = this.guard.checkFineTune();
    try {
      const job = await this.inner.createFineTune(args);
      this.guard.recordFineTune(args.model, quote, `job ${job.id}, charged at the approved quote until the bill says otherwise`);
      return job;
    } catch (err) {
      this.guard.inspect(err);
      throw err;
    }
  }

  deployLora(): Promise<DeployedModel> {
    return Promise.reject(new BudgetError('Deploying refused: on Token Factory a fine-tuned model is served only from a dedicated endpoint, which bills by the hour.'));
  }

  priceFor(model: string): Price | null {
    try {
      return this.guard.priceOf(model);
    } catch {
      return null;
    }
  }

  // Free control-plane reads and file uploads pass through.
  uploadFile(name: string, jsonl: string): Promise<{ id: string; bytes: number }> {
    return this.inner.uploadFile(name, jsonl);
  }
  getFineTune(id: string): Promise<FineTuneJob> {
    return this.inner.getFineTune(id);
  }
  checkpoints(id: string): Promise<Checkpoint[]> {
    return this.inner.checkpoints(id);
  }
  getDeployed(name: string): Promise<DeployedModel> {
    return this.inner.getDeployed(name);
  }
  listModels(): Promise<string[]> {
    return this.inner.listModels();
  }
}
