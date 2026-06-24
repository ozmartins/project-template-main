import { runActivityContractCheck } from "./check-activity-contracts.js";
import { runRpcContractCheck } from "./check-rpc-contracts.js";

async function main(): Promise<void> {
  const updateBaseline =
    process.argv.includes("--update-baseline") || process.argv.includes("--update-baselines");

  const rpc = await runRpcContractCheck({ updateBaseline });
  const activities = await runActivityContractCheck({ updateBaseline });

  const total = rpc.findings.length + activities.findings.length;
  if (total > 0) {
    process.stderr.write(`\nContract drift detector found ${total} finding(s).\n`);
  }

  // Non-gating by design.
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`Contract drift detector failed: ${(error as Error).message}\n`);
  process.exit(1);
});
