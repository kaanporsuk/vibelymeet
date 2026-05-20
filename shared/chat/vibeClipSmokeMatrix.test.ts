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
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const nativeVibeClip = read("apps/mobile/components/chat/VibeClipCard.tsx");

  for (const scenario of CHAT_VIBE_CLIP_SMOKE_SCENARIOS) {
    assert.match(playwright, new RegExp(scenario.id), `Playwright references ${scenario.id}`);
    assert.match(maestro, new RegExp(scenario.id), `Maestro references ${scenario.id}`);
    assert.match(runner, new RegExp(scenario.id), `runner references ${scenario.id}`);
    assert.match(workflow, new RegExp(scenario.id), `workflow references ${scenario.id}`);
  }

  for (const envName of [...CHAT_VIBE_CLIP_WEB_SMOKE_ENV, ...CHAT_VIBE_CLIP_NATIVE_SMOKE_ENV]) {
    assert.match(runner, new RegExp(envName), `runner documents ${envName}`);
  }

  assert.match(playwright, /get-chat-media-url/, "Playwright signed-url row waits for a fresh signed URL");
  assert.match(playwright, /signed_url_refresh_status/, "Playwright records signed URL refresh evidence");
  assert.match(runner, /CHAT_VIBE_CLIP_SCENARIOS=\(/, "runner owns an executable native scenario list");
  assert.match(runner, /for native_scenario in "\$\{native_scenarios\[@\]\}"/, "runner executes each native scenario");
  assert.match(runner, /VIBELY_CVC_NATIVE_SCENARIO_ID="\$\{native_scenario\}"/, "runner passes the active native scenario id");
  assert.match(runner, /native_scenario_deeplink/, "runner creates a scenario-specific native deep link");
  assert.match(maestro, /assertTrue:[\s\S]*VIBELY_CVC_NATIVE_SCENARIO_ID/, "Maestro validates the active native scenario");
  assert.match(maestro, /VIBELY_CVC_NATIVE_SCENARIO_DEEPLINK/, "Maestro opens the scenario-specific native deep link");
  assert.match(maestro, /app-launch-stuck-processing-nudge[\s\S]*vibe-clip-recovery-panel/, "native stale-row scenario exercises the recovery panel");
  assert.match(maestro, /kill-mid-tus[\s\S]*stopApp/, "native disruption scenario restarts the app mid-flow");
  assert.match(maestro, /signed-url-mid-expiry[\s\S]*Play clip/, "native signed-url scenario drives playback");
  assert.match(nativeChat, /smokeScenario/, "native chat screen receives the smoke scenario");
  assert.match(nativeVibeClip, /testID="vibe-clip-bubble"/, "native Vibe Clip card exposes the smoke bubble test id");
  assert.match(workflow, /run_live_native/, "workflow exposes manual native matrix dispatch");
  assert.match(workflow, /scripts\/run_chat_vibe_clip_smoke_matrix\.sh --native/, "workflow can run the native matrix");
});
