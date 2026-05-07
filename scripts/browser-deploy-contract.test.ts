import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type VercelRewrite = {
  source: string;
  destination: string;
};

type VercelConfig = {
  rewrites?: VercelRewrite[];
};

const root = process.cwd();
const vercelConfig = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as VercelConfig;

const spaRewrite = vercelConfig.rewrites?.find((rewrite) => rewrite.destination === "/index.html");
assert.ok(spaRewrite, "vercel.json must keep an SPA fallback rewrite to /index.html");
assert.notEqual(spaRewrite.source, "/(.*)", "SPA fallback must not rewrite every request to index.html");
assert.match(spaRewrite.source, /\(\?![^)]*assets\//, "SPA fallback must exclude hashed Vite assets");
assert.match(spaRewrite.source, /\\\.\[\^\/\]\+\$/, "SPA fallback must exclude file-extension requests");

const spaRewriteRegex = new RegExp(`^${spaRewrite.source}$`);

assert.equal(spaRewriteRegex.test("/event/02c34191-f6cf-4ed5-b73e-14f511d84d50/lobby"), true);
assert.equal(spaRewriteRegex.test("/dashboard"), true);
assert.equal(spaRewriteRegex.test("/assets/EventLobby-Ro3so-7k.js"), false);
assert.equal(spaRewriteRegex.test("/assets/index-DTEhqKmD.js"), false);
assert.equal(spaRewriteRegex.test("/favicon.ico"), false);
assert.equal(spaRewriteRegex.test("/manifest.json"), false);
assert.equal(spaRewriteRegex.test("/OneSignalSDK.sw.js"), false);

console.log("browser deploy contract tests passed");
