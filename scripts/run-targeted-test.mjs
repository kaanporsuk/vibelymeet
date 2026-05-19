#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const target = process.argv[2];

const targets = new Map([
  ["media-sdk", ["npm", ["run", "test:media-sdk", "--silent"]]],
]);

if (!target || !targets.has(target)) {
  const available = [...targets.keys()].sort().join(", ");
  console.error(`Usage: npm run test:targeted -- <target>`);
  console.error(`Available targets: ${available}`);
  process.exit(1);
}

const [command, args] = targets.get(target);
const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
