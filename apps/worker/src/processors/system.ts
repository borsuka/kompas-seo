import type { Processor } from '../runtime.js';

export interface DemoProgressInput {
  steps: number;
  delayMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Demonstrates the async job pipeline: progress events stream to the UI over SSE. */
export const demoProgress: Processor<DemoProgressInput, { steps: number }> = async (input, ctx) => {
  const steps = Math.max(1, Math.min(50, input.steps ?? 10));
  for (let i = 1; i <= steps; i++) {
    await sleep(input.delayMs ?? 300);
    await ctx.progress((i / steps) * 100, `step ${i}/${steps}`);
  }
  return { steps };
};
