
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
  console.log("Running benchmark...");

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

  const avgBaseline = baselineResults.reduce((a, b) => a + b, 0) / baselineResults.length;
  const avgOptimized = optimizedResults.reduce((a, b) => a + b, 0) / optimizedResults.length;

  console.log(`Average Baseline (N=20 individual calls): ${avgBaseline.toFixed(2)}ms`);
  console.log(`Average Optimized (1 batch call): ${avgOptimized.toFixed(2)}ms`);
  console.log(`Improvement: ${(((avgBaseline - avgOptimized) / avgBaseline) * 100).toFixed(2)}%`);
}

runBenchmark().catch(console.error);
