#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [, , suite = "e2e", resultsPath = "e2e-results.json", maxSkipPctArg = "0.25"] = process.argv;
const maxSkipPct = Number(maxSkipPctArg);

const results = JSON.parse(readFileSync(resultsPath, "utf8"));
const stats = results?.stats ?? {};
const expected = Number(stats.expected ?? 0);
const unexpected = Number(stats.unexpected ?? 0);
const flaky = Number(stats.flaky ?? 0);
const skipped = Number(stats.skipped ?? 0);
const total = expected + unexpected + flaky + skipped;
const skipPct = total > 0 ? skipped / total : 0;

if (total === 0) {
  console.error(`No ${suite} assertions executed (total=${total}).`);
  process.exit(1);
}

if (skipPct > maxSkipPct) {
  console.error(
    `${suite} skip budget breached: ${(skipPct * 100).toFixed(1)}% skipped (${skipped}/${total}), max ${(maxSkipPct * 100).toFixed(1)}%.`,
  );
  process.exit(1);
}

console.log(
  `${suite} skip budget OK: ${(skipPct * 100).toFixed(1)}% skipped (${skipped}/${total}), max ${(maxSkipPct * 100).toFixed(1)}%.`,
);
