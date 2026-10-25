// Model routing and prices. Roles map to Token Factory model ids; every id can be overridden from the
// environment, because Token Factory's catalogue changes (check GET /v1/models with your key).

export type Role = 'teacher' | 'grader' | 'student';

export interface ModelChoice {
  id: string;
  label: string;
  /** USD per 1M tokens, input and output. Live runs use Token Factory's published prices instead. */
  price: { in: number; out: number };
  /** Reasoning models think before answering unless told not to; the thinking is billed as output. */
  reasoning?: boolean;
  /** False when Token Factory does not list structured outputs for the model: the JSON schema goes in the prompt. */
  structured?: boolean;
}

const CATALOGUE: Record<string, ModelChoice> = {
  'nvidia/Nemotron-3-Ultra-550b-a55b': { id: 'nvidia/Nemotron-3-Ultra-550b-a55b', label: 'Nemotron 3 Ultra', price: { in: 1.0, out: 3.0 }, reasoning: true, structured: false },
  'nvidia/nemotron-3-super-120b-a12b': { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super', price: { in: 0.3, out: 0.9 }, reasoning: true, structured: false },
  'nvidia/Nemotron-3.5-Super-VL': { id: 'nvidia/Nemotron-3.5-Super-VL', label: 'Nemotron 3.5 Super VL', price: { in: 0.3, out: 0.9 }, reasoning: true, structured: false },
  'nvidia/Nemotron-3_5-Lightning': { id: 'nvidia/Nemotron-3_5-Lightning', label: 'Nemotron 3.5 Lightning', price: { in: 0.06, out: 0.24 }, reasoning: true, structured: false },
  'meta-llama/Meta-Llama-3.1-8B-Instruct': { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', label: 'Llama 3.1 8B', price: { in: 0.02, out: 0.06 } },
  'Qwen/Qwen3-1.7B': { id: 'Qwen/Qwen3-1.7B', label: 'Qwen3 1.7B', price: { in: 0.02, out: 0.06 } },
  'Qwen/Qwen3-30B-A3B-Instruct-2507': { id: 'Qwen/Qwen3-30B-A3B-Instruct-2507', label: 'Qwen3 30B-A3B', price: { in: 0.1, out: 0.3 } },
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B': { id: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', label: 'Nemotron 3 Nano', price: { in: 0.06, out: 0.24 }, reasoning: true, structured: false },
};

const DEFAULTS: Record<Role, string> = {
  teacher: 'nvidia/Nemotron-3-Ultra-550b-a55b',
  grader: 'nvidia/nemotron-3-super-120b-a12b',
  // Served per token on Token Factory and listed as LoRA-tunable (Llama 3.1 8B is tunable but not served per token).
  student: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
};

const ENV: Record<Role, string> = { teacher: 'APPRENTICE_TEACHER', grader: 'APPRENTICE_GRADER', student: 'APPRENTICE_STUDENT' };

export function modelFor(role: Role, env: NodeJS.ProcessEnv = process.env): ModelChoice {
  const id = env[ENV[role]]?.trim() || DEFAULTS[role];
  return CATALOGUE[id] ?? { id, label: id.split('/').pop() ?? id, price: { in: 0.1, out: 0.3 } };
}

/** A fine-tuned student is priced like its base (Token Factory serves LoRA adapters at the base model's rate). */
export function priceOf(modelId: string, studentBase?: string): ModelChoice['price'] {
  if (CATALOGUE[modelId]) return CATALOGUE[modelId].price;
  if (studentBase && CATALOGUE[studentBase]) return CATALOGUE[studentBase].price;
  return { in: 0.1, out: 0.3 };
}

export function costUsd(price: ModelChoice['price'], tokensIn: number, tokensOut: number): number {
  return (price.in * tokensIn + price.out * tokensOut) / 1_000_000;
}

/** How to ask a model: thinking off for reasoning models (short label answers), schema in the prompt when needed. */
export function requestStyle(modelId: string): { noThinking: boolean; schemaInPrompt: boolean } {
  const m = CATALOGUE[modelId];
  const nvidia = /^nvidia\//i.test(modelId);
  return { noThinking: m?.reasoning ?? nvidia, schemaInPrompt: m ? m.structured === false : nvidia };
}
