import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");

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

function replaceBetween(content, tag, value) {
  const re = new RegExp(`<!--METRICS:${tag}-->\\d+<!--/METRICS:${tag}-->`);
  if (!re.test(content)) throw new Error(`No encontre los markers METRICS:${tag} en README.md`);
  return content.replace(re, `<!--METRICS:${tag}-->${value}<!--/METRICS:${tag}-->`);
}

const backend = countBackendTests();
const frontend = countFrontendTests();

const readmePath = path.join(root, "README.md");
let readme = readFileSync(readmePath, "utf8");
readme = replaceBetween(readme, "BACKEND", backend);
readme = replaceBetween(readme, "FRONTEND", frontend);
writeFileSync(readmePath, readme);

console.log(`backend tests: ${backend}, frontend tests: ${frontend}`);
