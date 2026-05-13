import { performance } from "node:perf_hooks";

// Mocking the behavior of Drizzle ORM to measure call overhead
async function mockDbOperation(delay = 1) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

const builtInToolsCount = 20;

async function baseline() {
  const start = performance.now();
  for (let i = 0; i < builtInToolsCount; i++) {
    // Simulating db.insert().values().onConflictDoUpdate()
    await mockDbOperation(2); // Simulating 2ms DB roundtrip per call
  }
  return performance.now() - start;
}

async function optimized() {
  const start = performance.now();
  // Simulating single batch insert
  await mockDbOperation(2); // Simulating single 2ms DB roundtrip
  return performance.now() - start;
}

async function runBenchmark() {
  const baselineResults: number[] = [];
  const optimizedResults: number[] = [];

  // Warmup
  for (let i = 0; i < 5; i++) {
    await baseline();
    await optimized();
  }

  for (let i = 0; i < 50; i++) {
    baselineResults.push(await baseline());
    optimizedResults.push(await optimized());
  }

  const _avgBaseline = baselineResults.reduce((a, b) => a + b, 0) / baselineResults.length;
  const _avgOptimized = optimizedResults.reduce((a, b) => a + b, 0) / optimizedResults.length;
}

runBenchmark().catch(console.error);
