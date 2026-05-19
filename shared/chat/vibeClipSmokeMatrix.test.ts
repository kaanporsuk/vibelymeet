import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAT_VIBE_CLIP_NATIVE_SMOKE_ENV,
  CHAT_VIBE_CLIP_SMOKE_MATRIX,
  CHAT_VIBE_CLIP_SMOKE_PLATFORMS,
  CHAT_VIBE_CLIP_SMOKE_SCENARIOS,
  CHAT_VIBE_CLIP_WEB_SMOKE_ENV,
} from "./vibeClipSmokeMatrix";

const read = (path: string) => readFileSync(path, "utf8");

test("Chat Vibe Clip smoke matrix covers required scenarios on web, iOS, and Android", () => {
  assert.equal(
    CHAT_VIBE_CLIP_SMOKE_MATRIX.length,
    CHAT_VIBE_CLIP_SMOKE_PLATFORMS.length * CHAT_VIBE_CLIP_SMOKE_SCENARIOS.length,
  );

  for (const platform of CHAT_VIBE_CLIP_SMOKE_PLATFORMS) {
    const rows = CHAT_VIBE_CLIP_SMOKE_MATRIX.filter((row) => row.platform === platform);
    assert.deepEqual(rows.map((row) => row.id), CHAT_VIBE_CLIP_SMOKE_SCENARIOS.map((scenario) => scenario.id));
  }

  for (const row of CHAT_VIBE_CLIP_SMOKE_MATRIX) {
    assert.ok(row.timeoutMs >= 120_000, `${row.rowId} has enough time for provider processing`);
    assert.ok(row.requiredEvidence.length >= 3, `${row.rowId} captures useful debugging evidence`);
  }
});

test("Chat Vibe Clip smoke entrypoints stay wired to the canonical matrix", () => {
  const playwright = read("e2e/chat-vibe-clip-smoke.spec.ts");
  const maestro = read("apps/mobile/maestro/chat-vibe-clip-smoke.yaml");
  const runner = read("scripts/run_chat_vibe_clip_smoke_matrix.sh");
  const workflow = read(".github/workflows/chat-vibe-clip-smoke.yml");

  for (const scenario of CHAT_VIBE_CLIP_SMOKE_SCENARIOS) {
    assert.match(playwright, new RegExp(scenario.id), `Playwright references ${scenario.id}`);
    assert.match(maestro, new RegExp(scenario.id), `Maestro references ${scenario.id}`);
    assert.match(runner, new RegExp(scenario.id), `runner references ${scenario.id}`);
    assert.match(workflow, new RegExp(scenario.id), `workflow references ${scenario.id}`);
  }

  for (const envName of [...CHAT_VIBE_CLIP_WEB_SMOKE_ENV, ...CHAT_VIBE_CLIP_NATIVE_SMOKE_ENV]) {
    assert.match(runner, new RegExp(envName), `runner documents ${envName}`);
  }
});

