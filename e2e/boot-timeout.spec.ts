import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const eq = line.indexOf("=");
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      }),
  );
}

function storageKeysForSupabase(): string[] {
  const env = { ...readEnvFile(".env.local"), ...process.env };
  const supabaseUrl = env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
  let projectRef = "127";
  try {
    projectRef = new URL(supabaseUrl).hostname.split(".")[0] || projectRef;
  } catch {
    // Keep local fallback.
  }
  return Array.from(new Set([`sb-${projectRef}-auth-token`, "sb-127-auth-token"]));
}

test("authenticated boot exits the global spinner when Supabase boot calls stall", async ({ page }) => {
  test.slow();

  const storageKeys = storageKeysForSupabase();
  await page.addInitScript(({ storageKeys }) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const session = {
      access_token: "e2e-stalled-access-token",
      refresh_token: "e2e-stalled-refresh-token",
      expires_in: 3600,
      expires_at: nowSeconds + 3600,
      token_type: "bearer",
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        email: "stalled-boot@example.test",
        created_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: { name: "Stalled Boot" },
      },
    };
    for (const key of storageKeys) {
      window.localStorage.setItem(key, JSON.stringify(session));
    }
  }, { storageKeys });

  await page.route(/\/(?:auth\/v1\/user|rest\/v1\/profiles|rest\/v1\/rpc\/resolve_entry_state)(?:[?#]|$)/, async () => {
    await new Promise(() => undefined);
  });

  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expect(page.locator(".animate-spin").first()).toBeVisible();
  await expect(page).toHaveURL(/\/entry-recovery(?:[?#].*)?$/, { timeout: 13_000 });
});
