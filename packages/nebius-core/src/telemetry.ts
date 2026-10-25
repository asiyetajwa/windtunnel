// Every model call, with its receipt: who called which model for which step, tokens, time and cost.

export interface CallRecord {
  id: string;
  at: string;
  /** The loop step that made the call: baseline, teach, grade, train, prove, ship. */
  step: string;
  role: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
  /** True when the call was answered by stub mode, not Token Factory. */
  stub: boolean;
  ok: boolean;
  error?: string;
}

export type CallListener = (call: CallRecord) => void;

export class Telemetry {
  readonly calls: CallRecord[] = [];
  private listeners = new Set<CallListener>();
  private seq = 0;

  record(call: Omit<CallRecord, 'id' | 'at'>): CallRecord {
    const full: CallRecord = { id: `call-${String(++this.seq).padStart(5, '0')}`, at: new Date().toISOString(), ...call };
    this.calls.push(full);
    for (const l of this.listeners) l(full);
    return full;
  }

  onCall(listener: CallListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Totals for a step (or all steps): calls, tokens, cost, and median latency. */
  summary(step?: string): { calls: number; tokensIn: number; tokensOut: number; costUsd: number; medianLatencyMs: number } {
    const xs = this.calls.filter((c) => !step || c.step === step);
    const lat = xs.map((c) => c.latencyMs).sort((a, b) => a - b);
    return {
      calls: xs.length,
      tokensIn: xs.reduce((s, c) => s + c.tokensIn, 0),
      tokensOut: xs.reduce((s, c) => s + c.tokensOut, 0),
      costUsd: xs.reduce((s, c) => s + c.costUsd, 0),
      medianLatencyMs: lat.length ? lat[Math.floor(lat.length / 2)]! : 0,
    };
  }
}
