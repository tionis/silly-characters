#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const serverRoot = path.resolve(__dirname, "..");
const nodeModulesDir = path.join(serverRoot, "node_modules");

if (!fs.existsSync(nodeModulesDir)) {
  console.log("[native] node_modules not found, skipping native rebuild check");
  process.exit(0);
}

const abi = String(process.versions.modules || "unknown").trim();
const markerDir = path.join(nodeModulesDir, ".native-build-markers");
const markerFile = path.join(markerDir, `abi-${abi}`);

if (fs.existsSync(markerFile)) {
  console.log(`[native] ABI ${abi} already prepared`);
  process.exit(0);
}

console.log(`[native] Rebuilding better-sqlite3/sharp for Node ABI ${abi} (${process.version})`);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const rebuild = spawnSync(npmCmd, ["rebuild", "better-sqlite3", "sharp"], {
  cwd: serverRoot,
  stdio: "inherit",
  env: process.env,
});

if (rebuild.status !== 0) {
  process.exit(rebuild.status ?? 1);
}

fs.mkdirSync(markerDir, { recursive: true });
for (const entry of fs.readdirSync(markerDir)) {
  if (entry.startsWith("abi-")) {
    try {
      fs.rmSync(path.join(markerDir, entry), { force: true });
    } catch {
      // ignore stale marker cleanup errors
    }
  }
}

const markerBody = [
  `abi=${abi}`,
  `node=${process.version}`,
  `createdAt=${new Date().toISOString()}`,
  "",
].join("\n");
fs.writeFileSync(markerFile, markerBody, "utf8");

console.log(`[native] Native modules ready for ABI ${abi}`);
