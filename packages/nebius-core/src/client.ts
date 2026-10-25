// Token Factory client: chat (with JSON-schema output), files, LoRA fine-tuning jobs and adapter deployment.
// Token Factory is OpenAI-compatible (https://api.tokenfactory.nebius.com/v1). Without an API key the same
// interface is served by a stub transport, so the whole app runs offline and never blocks on the key.

import { Telemetry } from './telemetry.js';
import { costUsd, priceOf, requestStyle } from './models.js';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain text, or text and images (data: URLs) for vision models. */
  content: string | ContentPart[];
}

/** Characters of text and the number of images in a message, for estimating its cost before sending. */
export function messageSize(m: ChatMessage): { chars: number; images: number } {
  if (typeof m.content === 'string') return { chars: m.content.length, images: 0 };
  return m.content.reduce((t, p) => (p.type === 'text' ? { ...t, chars: t.chars + p.text.length } : { ...t, images: t.images + 1 }), { chars: 0, images: 0 });
}

export interface ChatRequest {
  step: string;
  role: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for JSON matching this schema (Token Factory response_format json_schema). */
  schema?: { name: string; schema: Record<string, unknown> };
  /** For pricing a fine-tuned student by its base model. */
  priceAs?: string;
  /** Extra request fields passed through as is, e.g. { chat_template_kwargs: { enable_thinking: false } }. */
  extraBody?: Record<string, unknown>;
}

export interface ChatResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export type JobStatus = 'validating_files' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface FineTuneJob {
  id: string;
  model: string;
  status: JobStatus;
  fineTunedModel: string | null;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  trainedTokens: number | null;
}

export interface Checkpoint {
  id: string;
  step: number;
  model: string;
  trainLoss: number | null;
  validLoss: number | null;
}

export interface Hyperparameters {
  n_epochs: number;
  learning_rate: number;
  batch_size: number;
  lora: true;
  lora_r: number;
  lora_alpha: number;
  lora_dropout: number;
  warmup_ratio?: number;
  weight_decay?: number;
  max_grad_norm?: number;
  /** Pack short examples into full-length sequences (Token Factory's default), so cost follows real tokens. */
  packing?: boolean;
  context_length?: number;
}

export interface DeployedModel {
  name: string;
  status: 'pending' | 'active' | 'failed' | string;
  baseModel: string;
}

/** What actually talks to Token Factory, or pretends to. */
export interface Transport {
  readonly live: boolean;
  chat(req: ChatRequest): Promise<ChatResult>;
  uploadFile(name: string, jsonl: string): Promise<{ id: string; bytes: number }>;
  createFineTune(args: { model: string; trainingFile: string; validationFile?: string; suffix: string; hyperparameters: Hyperparameters; seed: number }): Promise<FineTuneJob>;
  getFineTune(id: string): Promise<FineTuneJob>;
  checkpoints(id: string): Promise<Checkpoint[]>;
  deployLora(args: { name: string; baseModel: string; source: string }): Promise<DeployedModel>;
  getDeployed(name: string): Promise<DeployedModel>;
  listModels(): Promise<string[]>;
  /** Published price per 1M tokens, when the transport knows it (the live guard does). */
  priceFor?(model: string): { in: number; out: number } | null;
}

export class TokenFactoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The real thing: Token Factory over HTTPS, with retries on 429 and 5xx. */
export class HttpTransport implements Transport {
  readonly live = true;
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.tokenfactory.nebius.com/v1',
    private timeoutMs = 120_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Control-plane routes live under /v0 on the same host. */
  private v0(path: string): string {
    return `${this.baseUrl.replace(/\/v1$/, '')}/v0${path}`;
  }

  private async request<T>(url: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.apiKey}`, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers },
      });
      const body = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await sleep(1000 * 2 ** attempt);
        return this.request<T>(url, init, attempt + 1);
      }
      if (!res.ok) throw new TokenFactoryError(`Token Factory ${String(res.status)} on ${new URL(url).pathname}: ${body.slice(0, 300)}`, res.status, body);
      return (body ? JSON.parse(body) : {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const style = requestStyle(req.model);
    let messages = req.messages;
    if (req.schema && style.schemaInPrompt) {
      // No structured outputs listed for this model: put the schema in the instructions and parse the reply.
      const rule = `Reply with only a JSON object, no other text, matching this JSON schema:\n${JSON.stringify(req.schema.schema)}`;
      const first = messages[0];
      messages = first?.role === 'system' && typeof first.content === 'string' ? [{ role: 'system', content: `${first.content}\n\n${rule}` }, ...messages.slice(1)] : [{ role: 'system', content: rule }, ...messages];
    }
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      temperature: req.temperature ?? 0,
      max_tokens: req.maxTokens ?? 512,
    };
    if (style.noThinking) body.chat_template_kwargs = { enable_thinking: false };
    if (req.extraBody) Object.assign(body, req.extraBody);
    if (req.schema && !style.schemaInPrompt) body.response_format = { type: 'json_schema', json_schema: { name: req.schema.name, schema: req.schema.schema, strict: true } };
    const out = await this.request<{ choices: Array<{ message: { content: string | null; tool_calls?: Array<{ function: { arguments: string } }> } }>; usage?: { prompt_tokens: number; completion_tokens: number } }>(
      `${this.baseUrl}/chat/completions`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return {
      // A forced tool call carries its answer in the call's arguments.
      text: out.choices[0]?.message.tool_calls?.[0]?.function.arguments || (out.choices[0]?.message.content ?? ''),
      tokensIn: out.usage?.prompt_tokens ?? 0,
      tokensOut: out.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }

  async uploadFile(name: string, jsonl: string): Promise<{ id: string; bytes: number }> {
    const form = new FormData();
    form.append('purpose', 'fine-tune');
    form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), name);
    const out = await this.request<{ id: string; bytes: number }>(`${this.baseUrl}/files`, { method: 'POST', body: form });
    return { id: out.id, bytes: out.bytes };
  }

  async createFineTune(args: { model: string; trainingFile: string; validationFile?: string; suffix: string; hyperparameters: Hyperparameters; seed: number }): Promise<FineTuneJob> {
    const out = await this.request<RawJob>(`${this.baseUrl}/fine_tuning/jobs`, {
      method: 'POST',
      body: JSON.stringify({
        model: args.model,
        training_file: args.trainingFile,
        validation_file: args.validationFile,
        suffix: args.suffix,
        hyperparameters: args.hyperparameters,
        seed: args.seed,
      }),
    });
    return toJob(out);
  }

  async getFineTune(id: string): Promise<FineTuneJob> {
    return toJob(await this.request<RawJob>(`${this.baseUrl}/fine_tuning/jobs/${encodeURIComponent(id)}`));
  }

  async checkpoints(id: string): Promise<Checkpoint[]> {
    const out = await this.request<{ data: Array<{ id: string; step_number?: number; fine_tuned_model_checkpoint: string; metrics?: { train_loss?: number; valid_loss?: number } }> }>(
      `${this.baseUrl}/fine_tuning/jobs/${encodeURIComponent(id)}/checkpoints`,
    );
    return (out.data ?? []).map((c, i) => ({
      id: c.id,
      step: c.step_number ?? i + 1,
      model: c.fine_tuned_model_checkpoint,
      trainLoss: c.metrics?.train_loss ?? null,
      validLoss: c.metrics?.valid_loss ?? null,
    }));
  }

  async deployLora(args: { name: string; baseModel: string; source: string }): Promise<DeployedModel> {
    const out = await this.request<{ name: string; status: string; base_model?: string }>(this.v0('/models'), {
      method: 'POST',
      body: JSON.stringify({ name: args.name, base_model: args.baseModel, source: args.source, description: 'Deployed by Apprentice' }),
    });
    return { name: out.name ?? args.name, status: out.status ?? 'pending', baseModel: out.base_model ?? args.baseModel };
  }

  async getDeployed(name: string): Promise<DeployedModel> {
    const out = await this.request<{ name: string; status: string; base_model?: string }>(this.v0(`/models/${encodeURIComponent(name)}`));
    return { name: out.name ?? name, status: out.status, baseModel: out.base_model ?? '' };
  }

  async listModels(): Promise<string[]> {
    const out = await this.request<{ data: Array<{ id: string }> }>(`${this.baseUrl}/models`);
    return (out.data ?? []).map((m) => m.id);
  }
}

interface RawJob {
  id: string;
  model: string;
  status: JobStatus;
  fine_tuned_model?: string | null;
  created_at?: number;
  finished_at?: number | null;
  error?: { message?: string } | string | null;
  trained_tokens?: number | null;
}

function toJob(j: RawJob): FineTuneJob {
  const iso = (t?: number | null) => (t ? new Date(t * 1000).toISOString() : null);
  return {
    id: j.id,
    model: j.model,
    status: j.status,
    fineTunedModel: j.fine_tuned_model ?? null,
    createdAt: iso(j.created_at) ?? new Date().toISOString(),
    finishedAt: iso(j.finished_at),
    error: typeof j.error === 'string' ? j.error : (j.error?.message ?? null),
    trainedTokens: j.trained_tokens ?? null,
  };
}

/**
 * The client the app uses: one place that times, prices and records every call (live or stub), so the
 * "every call, with its receipt" view is complete and the cost numbers come from real usage.
 */
export class TokenFactory {
  constructor(
    readonly transport: Transport,
    readonly telemetry = new Telemetry(),
  ) {}

  get live(): boolean {
    return this.transport.live;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    try {
      const out = await this.transport.chat(req);
      const price = this.transport.priceFor?.(req.model) ?? priceOf(req.priceAs ?? req.model, req.priceAs);
      this.telemetry.record({
        step: req.step,
        role: req.role,
        model: req.model,
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        latencyMs: out.latencyMs,
        costUsd: costUsd(price, out.tokensIn, out.tokensOut),
        stub: !this.live,
        ok: true,
      });
      return out;
    } catch (err) {
      this.telemetry.record({ step: req.step, role: req.role, model: req.model, tokensIn: 0, tokensOut: 0, latencyMs: 0, costUsd: 0, stub: !this.live, ok: false, error: (err as Error).message });
      throw err;
    }
  }

  /** Chat that must come back as JSON; one repair attempt if the model wraps it in prose or code fences. */
  async json<T>(req: ChatRequest & { schema: NonNullable<ChatRequest['schema']> }): Promise<T> {
    const out = await this.chat(req);
    try {
      return parseJson<T>(out.text);
    } catch {
      const retry = await this.chat({ ...req, messages: [...req.messages, { role: 'assistant', content: out.text }, { role: 'user', content: 'Reply again with only the JSON object, no other text.' }] });
      return parseJson<T>(retry.text);
    }
  }
}

export function parseJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = trimmed.search(/[[{]/);
  return JSON.parse(start > 0 ? trimmed.slice(start) : trimmed) as T;
}
