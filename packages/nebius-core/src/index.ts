// @windtunnel/nebius-core: the shared core every Nebius project here builds on.
// Token Factory client, model routing, cost and latency telemetry, and a stub mode for working offline.

export * from './budget.js';
export * from './client.js';
export * from './models.js';
export * from './stub.js';
export * from './telemetry.js';

import { join } from 'node:path';
import { fetchPrices, GuardedTransport, SpendGuard } from './budget.js';
import { HttpTransport, TokenFactory, type Transport } from './client.js';
import { StubTransport, type StubOptions } from './stub.js';
import { Telemetry } from './telemetry.js';

/**
 * Live when NEBIUS_API_KEY is set, stub otherwise. The stub needs the app's answers for chat calls. A live client
 * always runs behind the spend guard: WINDTUNNEL_BUDGET_USD is the cap, WINDTUNNEL_LEDGER the ledger file.
 */
export function createTokenFactory(stub: StubOptions, env: NodeJS.ProcessEnv = process.env): TokenFactory {
  const key = env.NEBIUS_API_KEY?.trim();
  if (!key) return new TokenFactory(new StubTransport(stub), new Telemetry());
  const baseUrl = env.NEBIUS_BASE_URL?.trim() || undefined;
  // No fine-tuning in this project: no quote, so the guard refuses any fine-tuning job.
  const guard = new SpendGuard(Number(env.WINDTUNNEL_BUDGET_USD ?? 0), env.WINDTUNNEL_LEDGER?.trim() || join(process.cwd(), '.windtunnel-ledger.jsonl'), null);
  const transport: Transport = new GuardedTransport(new HttpTransport(key, baseUrl), guard, () => fetchPrices(key, baseUrl));
  return new TokenFactory(transport, new Telemetry());
}
