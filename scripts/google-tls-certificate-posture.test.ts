import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const certificateAssetPattern = /\.(?:pem|crt|cer|der|jks|p12|pfx|keystore)$/i;

const sourcePrefixes = [
  ".github/",
  "apps/mobile/",
  "scripts/",
  "shared/",
  "src/",
  "supabase/functions/",
];

const sourceFiles = new Set([
  ".env.certification.example",
  ".env.example",
  "apps/mobile/.env.example",
  "apps/mobile/app.base.json",
  "apps/mobile/app.config.js",
  "apps/mobile/package.json",
  "package.json",
  "vercel.json",
]);

const ignoredPrefixes = [
  "apps/mobile/.expo/",
  "apps/mobile/ios/",
  "docs/",
  "node_modules/",
];

const ignoredFiles = new Set([
  "apps/mobile/package-lock.json",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "scripts/google-tls-certificate-posture.test.ts",
]);

const textFilePattern = /\.(?:cjs|cts|gradle|h|java|js|json|jsx|kt|m|mjs|mm|mts|patch|plist|properties|sh|swift|toml|ts|tsx|xml|yml|yaml)$/i;

function isIgnored(path: string): boolean {
  return ignoredFiles.has(path) || ignoredPrefixes.some((prefix) => path.startsWith(prefix));
}

function isRuntimeSource(path: string): boolean {
  if (isIgnored(path)) return false;
  if (!sourceFiles.has(path) && !sourcePrefixes.some((prefix) => path.startsWith(prefix))) return false;
  if (sourceFiles.has(path)) return true;
  return textFilePattern.test(path);
}

test("no tracked custom CA, certificate, or keystore assets ship with the repo", () => {
  const matches = trackedFiles.filter((path) => certificateAssetPattern.test(path));
  assert.deepEqual(matches, []);
});

test("runtime source does not configure Google certificate pinning or custom trust stores", () => {
  const forbidden: Array<[string, RegExp]> = [
    ["iOS pinned domains", /\bNSPinnedDomains\b/],
    ["iOS pinned CA identities", /\bNSPinnedCAIdentities\b/],
    ["iOS pinned leaf identities", /\bNSPinnedLeafIdentities\b/],
    ["TrustKit pinning", /\bTrustKit\b/],
    ["Android network security config file", /\bnetwork_security_config\b/],
    ["Android networkSecurityConfig manifest hook", /\bandroid:networkSecurityConfig\b/],
    ["OkHttp certificate pinner", /\bCertificatePinner\b/],
    ["custom hostname verifier", /\bhostnameVerifier\b/],
    ["custom trust manager", /\b(?:TrustManager|X509TrustManager)\b/],
    ["server trust override", /\b(?:ServerTrust|SecTrust|NSURLAuthenticationMethodServerTrust)\b/],
    ["React Native SSL pinning dependency", /\b(?:react-native-ssl-pinning|react-native-pinch)\b/],
    ["public key pin hashes", /\bsha256\/[A-Za-z0-9+/=]{20,}/],
    ["embedded certificate block", /-----BEGIN CERTIFICATE-----/],
    ["Deno custom HTTP client", /\bDeno\.createHttpClient\s*\(/],
    ["Deno custom CA certificates", /\bcaCerts\s*:/],
    ["custom cert file option", /\bcertFile\s*:/],
    ["custom cert path option", /\bcertPath\s*:/],
    ["Node extra CA env", /\bNODE_EXTRA_CA_CERTS\b/],
    ["OpenSSL cert file env", /\bSSL_CERT_FILE\b/],
    ["OpenSSL cert dir env", /\bSSL_CERT_DIR\b/],
    ["Requests CA bundle env", /\bREQUESTS_CA_BUNDLE\b/],
    ["curl CA bundle env", /\bCURL_CA_BUNDLE\b/],
    ["Deno TLS CA store env", /\bDENO_TLS_CA_STORE\b/],
    ["Deno cert env", /\bDENO_CERT\b/],
  ];

  const matches: string[] = [];
  for (const path of trackedFiles.filter(isRuntimeSource)) {
    const body = readFileSync(path, "utf8");
    for (const [label, pattern] of forbidden) {
      if (pattern.test(body)) {
        matches.push(`${path}: ${label}`);
      }
    }
  }

  assert.deepEqual(matches, []);
});
