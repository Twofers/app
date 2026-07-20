// D2 runner — executes the database suites in order, each in its own
// process so their guard-first + process.exit semantics stay isolated.
// These talk to the REMOTE test project and are DELIBERATELY excluded from the
// hermetic `npm test` (vitest) suite. Run explicitly: `npm run test:db`.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  "2a-purge-user-data.mjs",
  "2b-role-enforcement.mjs",
  "2c-rls-cross-tenant.mjs",
  "2d-billing-token-consume.mjs",
  "2e-public-visibility-and-publish-gate.mjs",
  "2f-business-name-lock.mjs",
  "2g-business-locations-rls.mjs",
  "2h-promo-materials-authorization.mjs",
];

let failed = 0;
for (const s of suites) {
  console.log(`\n${"=".repeat(72)}\n${s}\n${"=".repeat(72)}`);
  const res = spawnSync(process.execPath, [path.join(here, s)], { stdio: "inherit" });
  if (res.status !== 0) failed++;
}

console.log(`\n${"=".repeat(72)}`);
console.log(failed === 0 ? "ALL DB SUITES PASSED" : `${failed} DB SUITE(S) FAILED`);
process.exit(failed ? 1 : 0);
