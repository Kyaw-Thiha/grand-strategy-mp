import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface LaneConfig {
  source_prefixes: string[];
  tests: string[];
}
interface LanesConfig {
  lanes: Record<string, LaneConfig>;
  shared: { source_prefixes: string[] };
}

const ALL_MARKER = "__ALL__";

function loadConfig(): LanesConfig {
  const raw = readFileSync(resolve(ROOT, "test-lanes.json"), "utf8");
  return JSON.parse(raw);
}

function getChangedFiles(): string[] {
  const files = new Set<string>();

  try {
    const status = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
    for (const line of status.split("\n").filter(Boolean)) {
      const file = line.slice(3).trim();
      if (file) files.add(file);
    }
  } catch { /* not a git repo */ }

  for (const base of ["origin/main", "main"]) {
    try {
      const mergeBase = execSync(`git merge-base HEAD ${base}`, { cwd: ROOT, encoding: "utf8" }).trim();
      if (!mergeBase) continue;
      const diff = execSync(`git diff --name-only ${mergeBase}...HEAD`, { cwd: ROOT, encoding: "utf8" });
      for (const file of diff.split("\n").filter(Boolean)) {
        files.add(file.trim());
      }
      return [...files];
    } catch { /* try next */ }
  }

  try {
    const diff = execSync("git diff --name-only HEAD~1", { cwd: ROOT, encoding: "utf8" });
    for (const file of diff.split("\n").filter(Boolean)) {
      files.add(file.trim());
    }
  } catch { /* empty set */ }

  return [...files];
}

function matchLanes(config: LanesConfig, changedFiles: string[]): string[] {
  if (config.shared.source_prefixes.some(p => changedFiles.some(f => f.startsWith(p)))) {
    return [ALL_MARKER];
  }

  const matched = new Set<string>();
  const unmatched: string[] = [];

  for (const file of changedFiles) {
    let found = false;
    for (const [name, lane] of Object.entries(config.lanes)) {
      if (lane.source_prefixes.some(p => file.startsWith(p))) {
        matched.add(name);
        found = true;
        break;
      }
    }
    if (!found) unmatched.push(file);
  }

  if (unmatched.length > 0) {
    console.warn(`[test-changed] Files not matching any lane — running full suite:`);
    for (const f of unmatched) console.warn(`  ${f}`);
    return [ALL_MARKER];
  }

  if (matched.size === 0) return [ALL_MARKER];

  return [...matched];
}

function buildTestFiles(config: LanesConfig, lanes: string[]): string[] {
  const files = new Set<string>();
  for (const name of lanes) {
    const lane = config.lanes[name];
    if (lane) lane.tests.forEach(f => files.add(f));
  }
  return [...files];
}

function runMocha(testFiles: string[]) {
  const args = testFiles.map(f => `'${f}'`).join(" ");
  execSync(`NODE_ENV=test npx mocha ${args}`, { cwd: ROOT, stdio: "inherit", timeout: 600000 });
}

function main() {
  const config = loadConfig();
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    console.log("[test-changed] No changed files detected. Running full suite.");
    runMocha(["test/*.test.ts"]);
    return;
  }

  console.log(`[test-changed] ${changedFiles.length} changed files:`);
  for (const f of changedFiles) console.log(`  ${f}`);
  console.log();

  const matched = matchLanes(config, changedFiles);

  if (matched.length === 1 && matched[0] === ALL_MARKER) {
    console.log("[test-changed] Running full test suite.");
    runMocha(["test/*.test.ts"]);
    return;
  }

  const testFiles = buildTestFiles(config, matched);
  console.log(`[test-changed] Lanes: ${matched.join(", ")}`);
  console.log(`[test-changed] Tests: ${testFiles.length} file(s)`);
  for (const f of testFiles) console.log(`  ${f}`);
  console.log();

  if (testFiles.length === 0) {
    console.log("[test-changed] No test files — running full suite.");
    runMocha(["test/*.test.ts"]);
    return;
  }

  runMocha(testFiles);
}

main();
