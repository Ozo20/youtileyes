import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";

import {
  verifyResourceDisruption,
  type ResourceDisruption,
} from "../src/lib/planning/resource-recovery";
import type { SolverInputLike } from "../src/lib/planning/recovery-verification";

const INPUT_PATH =
  process.env.YOUTILEYES_SOLVER_INPUT ??
  "/tmp/youtileyes_solver_input.json";

const OUTPUT_PATH =
  process.env.YOUTILEYES_RESOURCE_RECOVERY_OUTPUT ??
  "/tmp/youtileyes_resource_recovery.json";

function parseArgs(): ResourceDisruption {
  const args = new Map<string, string>();

  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];

    if (!key || !value || !key.startsWith("--")) continue;
    args.set(key.slice(2), value);
  }

  const type = args.get("type");
  const resourceId = args.get("resource");
  const startDate = args.get("from");
  const endDate = args.get("to") ?? startDate;

  if (
    type !== "INSTRUCTOR_UNAVAILABLE" &&
    type !== "ROOM_UNAVAILABLE"
  ) {
    throw new Error(
      '--type must be "INSTRUCTOR_UNAVAILABLE" or "ROOM_UNAVAILABLE".',
    );
  }

  if (!resourceId || !startDate || !endDate) {
    throw new Error(
      "Required arguments: --type <...> --resource <id> --from YYYY-MM-DD [--to YYYY-MM-DD]",
    );
  }

  const startMinute = args.has("startMinute")
    ? Number(args.get("startMinute"))
    : undefined;
  const endMinute = args.has("endMinute")
    ? Number(args.get("endMinute"))
    : undefined;

  return {
    type,
    resourceId,
    startDate,
    endDate,
    startMinute,
    endMinute,
  };
}

async function main() {
  const input = JSON.parse(
    await readFile(INPUT_PATH, "utf8"),
  ) as SolverInputLike;

  const disruption = parseArgs();
  const result = await verifyResourceDisruption(input, disruption);

  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );

  console.log("=== YOUTILEYES RESOURCE RECOVERY ===");
  console.log(
    `${disruption.type}: ${disruption.resourceId} · ${disruption.startDate} -> ${disruption.endDate}`,
  );
  console.log(`Status: ${result.status}`);
  console.log(`Baseline: ${result.baselineSolverStatus}`);
  console.log(`Recovered: ${result.recoveredSolverStatus ?? "N/A"}`);
  console.log(`Changed sessions: ${result.changedSessionCount}`);
  console.log(`Direct changes: ${result.directChangeCount}`);
  console.log(`Cascading changes: ${result.indirectChangeCount}`);
  console.log(result.explanation);

  for (const change of result.changes) {
    const type = change.direct ? "DIRECT" : "CASCADE";
    console.log(
      `${type} ${change.occurrenceId}: ` +
        `${change.before?.instructorId ?? "-"} / ${change.before?.roomId ?? "-"} -> ` +
        `${change.after?.instructorId ?? "-"} / ${change.after?.roomId ?? "-"}`,
    );
  }

  console.log(`Report: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
