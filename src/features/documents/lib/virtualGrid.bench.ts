import { computeVirtualGridWindow } from "./virtualGrid";

const benchmarkCases = [
  {
    name: "10k-page desktop viewport",
    input: {
      itemCount: 10_000,
      gridItemWidth: 180,
      viewportWidth: 1440,
      viewportHeight: 900,
      scrollTop: 48_000,
    },
    iterations: 20_000,
  },
  {
    name: "500-page mobile viewport",
    input: {
      itemCount: 500,
      gridItemWidth: 156,
      viewportWidth: 390,
      viewportHeight: 844,
      scrollTop: 9_000,
    },
    iterations: 20_000,
  },
] as const;

for (const benchmarkCase of benchmarkCases) {
  let lastWindow = computeVirtualGridWindow(benchmarkCase.input);
  const start = performance.now();

  for (let index = 0; index < benchmarkCase.iterations; index += 1) {
    lastWindow = computeVirtualGridWindow(benchmarkCase.input);
  }

  const elapsed = performance.now() - start;
  const average = elapsed / benchmarkCase.iterations;

  console.log(
    `${benchmarkCase.name}: ${elapsed.toFixed(2)}ms total, ${average.toFixed(5)}ms/op, ` +
      `window=${JSON.stringify(lastWindow)}`,
  );
}
