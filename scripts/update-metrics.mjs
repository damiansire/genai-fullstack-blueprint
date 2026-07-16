// Regenerates (or verifies, with --check) the test counts embedded in README.md.
//
// The README's numbers live between <!--METRICS:*--> markers and are NEVER
// edited by hand: this script runs both real suites, extracts the counts the
// runners report, and rewrites the markers.
//
//   node scripts/update-metrics.mjs           -> run suites, rewrite README
//   node scripts/update-metrics.mjs --check   -> run suites, exit 1 if any
//                                                README number differs from
//                                                the freshly measured one
//                                                (nothing is written)
//
// CI runs the --check mode, so a hand-typed or stale number can never ship:
// the moment a test is added/removed, CI fails until the README is regenerated.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const checkMode = process.argv.includes("--check");

function countBackendTests() {
  const out = execSync("npm run test --workspace=api", {
    cwd: root,
    encoding: "utf8",
  });
  const match = out.match(/^ℹ tests (\d+)$/m);
  if (!match) throw new Error("No pude leer el conteo de tests del backend (node:test)");
  return Number(match[1]);
}

function countFrontendTests() {
  const out = execSync("npm run test --workspace=client -- --run", {
    cwd: root,
    encoding: "utf8",
  }).replace(/\x1b\[[0-9;]*m/g, "");
  const match = out.match(/Tests\s+(\d+) passed/);
  if (!match) throw new Error("No pude leer el conteo de tests del frontend (vitest)");
  return Number(match[1]);
}

/** Reads the number currently claimed between the METRICS markers. */
function readClaimed(content, tag) {
  const match = content.match(new RegExp(`<!--METRICS:${tag}-->(\\d+)<!--/METRICS:${tag}-->`));
  if (!match) throw new Error(`No encontre los markers METRICS:${tag} en README.md`);
  return Number(match[1]);
}

function replaceBetween(content, tag, value) {
  const re = new RegExp(`<!--METRICS:${tag}-->\\d+<!--/METRICS:${tag}-->`);
  if (!re.test(content)) throw new Error(`No encontre los markers METRICS:${tag} en README.md`);
  return content.replace(re, `<!--METRICS:${tag}-->${value}<!--/METRICS:${tag}-->`);
}

const measured = {
  BACKEND: countBackendTests(),
  FRONTEND: countFrontendTests(),
};

const readmePath = path.join(root, "README.md");
let readme = readFileSync(readmePath, "utf8");

if (checkMode) {
  const drift = Object.entries(measured)
    .map(([tag, value]) => ({ tag, claimed: readClaimed(readme, tag), value }))
    .filter(({ claimed, value }) => claimed !== value);

  if (drift.length > 0) {
    for (const { tag, claimed, value } of drift) {
      console.error(
        `DRIFT ${tag}: README claims ${claimed} tests but the suite reports ${value}. ` +
          `Run "node scripts/update-metrics.mjs" and commit the result.`,
      );
    }
    process.exit(1);
  }
  console.log(
    `metrics OK: backend ${measured.BACKEND}, frontend ${measured.FRONTEND} (README matches)`,
  );
} else {
  readme = replaceBetween(readme, "BACKEND", measured.BACKEND);
  readme = replaceBetween(readme, "FRONTEND", measured.FRONTEND);
  writeFileSync(readmePath, readme);
  console.log(`backend tests: ${measured.BACKEND}, frontend tests: ${measured.FRONTEND}`);
}
