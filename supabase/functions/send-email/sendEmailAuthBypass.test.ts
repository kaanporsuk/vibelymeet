import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createSendEmailHandler,
  type ProviderEmailInput,
  type ProviderEmailResult,
} from "./handler";

const root = process.cwd();
const defaultOrigin = "https://www.vibelymeet.com";
const serviceRoleKey = "test-service-role-key";
const userToken = "test-user-jwt";
const userEmail = "User@Example.com";

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function forgedServiceRoleToken(): string {
  return `x.${base64UrlJson({ role: "service_role" })}.x`;
}

function makeCors(allowedOrigins = new Set([defaultOrigin])) {
  function normalizedOrigin(req: Request): string | null {
    return req.headers.get("Origin")?.replace(/\/+$/, "") ?? null;
  }

  function corsHeadersForRequest(req: Request): Record<string, string> {
    const origin = normalizedOrigin(req);
    const headers: Record<string, string> = {
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      Vary: "Origin",
    };
    if (origin && allowedOrigins.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    return headers;
  }

  function isBrowserOriginRejected(req: Request): boolean {
    const origin = normalizedOrigin(req);
    return Boolean(origin && !allowedOrigins.has(origin));
  }

  function preflightResponse(req: Request): Response {
    return new Response(null, {
      status: isBrowserOriginRejected(req) ? 403 : 204,
      headers: corsHeadersForRequest(req),
    });
  }

  return { corsHeadersForRequest, isBrowserOriginRejected, preflightResponse };
}

function makeRequest(
  token: string,
  body: unknown,
  origin: string | null = defaultOrigin,
): Request {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (origin) {
    headers.Origin = origin;
  }

  return new Request("https://example.test/functions/v1/send-email", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function makeHarness(options: {
  providerResult?: ProviderEmailResult | ((input: ProviderEmailInput) => ProviderEmailResult);
  resendConfigured?: boolean;
  users?: Record<string, string>;
} = {}) {
  const sent: ProviderEmailInput[] = [];
  const logs: Array<{ level: "log" | "warn" | "error"; args: unknown[] }> = [];
  const users = options.users ?? { [userToken]: userEmail };

  const handler = createSendEmailHandler({
    appUrl: defaultOrigin,
    authenticateUser: async (authHeader: string) => {
      const token = authHeader.slice("Bearer ".length);
      const email = users[token];
      return email ? { email } : null;
    },
    cors: makeCors(),
    fromEmail: "Vibely <hello@vibelymeet.com>",
    logger: {
      error: (...args: unknown[]) => logs.push({ level: "error", args }),
      log: (...args: unknown[]) => logs.push({ level: "log", args }),
      warn: (...args: unknown[]) => logs.push({ level: "warn", args }),
    },
    resendConfigured: options.resendConfigured ?? true,
    sendEmail: async (input: ProviderEmailInput) => {
      sent.push(input);
      if (typeof options.providerResult === "function") {
        return options.providerResult(input);
      }
      return options.providerResult ?? { ok: true, id: "email_test_123" };
    },
    serviceRoleKey,
  });

  return { handler, logs, sent };
}

test("forged bearer with service_role payload is rejected and sends nothing", async () => {
  const { handler, sent } = makeHarness();

  const response = await handler(makeRequest(forgedServiceRoleToken(), {
    html: "<p>phish</p>",
    subject: "Urgent",
    to: "victim@example.com",
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 401);
  assert.deepEqual(json, { success: false, error: "Unauthorized" });
  assert.deepEqual(sent, []);
});

test("near-service tokens are not accepted as service-role", async () => {
  const { handler, sent } = makeHarness({ users: {} });

  const response = await handler(makeRequest(`${serviceRoleKey}.suffix`, {
    html: "<p>not service</p>",
    subject: "Nope",
    to: "victim@example.com",
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 401);
  assert.deepEqual(json, { success: false, error: "Unauthorized" });
  assert.deepEqual(sent, []);
});

test("normal user cannot send arbitrary email", async () => {
  const { handler, sent } = makeHarness();

  const response = await handler(makeRequest(userToken, {
    html: "<p>custom attacker body</p>",
    subject: "Custom subject",
    to: userEmail,
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 403);
  assert.deepEqual(json, { success: false, error: "Forbidden" });
  assert.deepEqual(sent, []);
});

test("normal user cannot add custom subject or HTML to welcome template", async () => {
  const { handler, sent } = makeHarness();

  const response = await handler(makeRequest(userToken, {
    data: { name: "Kaan" },
    html: "<p>custom attacker body</p>",
    subject: "Custom subject",
    template: "welcome",
    to: userEmail,
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 403);
  assert.deepEqual(json, { success: false, error: "Forbidden" });
  assert.deepEqual(sent, []);
});

test("normal user cannot send welcome template to a different email", async () => {
  const { handler, sent } = makeHarness();

  const response = await handler(makeRequest(userToken, {
    data: { name: "Kaan" },
    template: "welcome",
    to: "victim@example.com",
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 403);
  assert.deepEqual(json, { success: false, error: "Forbidden" });
  assert.deepEqual(sent, []);
});

test("unsigned service_role payload is ignored even when token authenticates as a user", async () => {
  const forgedToken = forgedServiceRoleToken();
  const { handler, sent } = makeHarness({ users: { [forgedToken]: userEmail } });

  const response = await handler(makeRequest(forgedToken, {
    html: "<p>custom attacker body</p>",
    subject: "Custom subject",
    to: "victim@example.com",
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 403);
  assert.deepEqual(json, { success: false, error: "Forbidden" });
  assert.deepEqual(sent, []);
});

test("malformed runtime payload fields do not throw or reach provider", async () => {
  const { handler, sent } = makeHarness();

  const response = await handler(makeRequest(userToken, {
    data: "not-an-object",
    template: "welcome",
    to: { email: userEmail },
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 403);
  assert.deepEqual(json, { success: false, error: "Forbidden" });
  assert.deepEqual(sent, []);
});

test("normal user can send allowed welcome email to own canonical email", async () => {
  const { handler, sent } = makeHarness();

  const response = await handler(makeRequest(userToken, {
    data: { name: "Kaan" },
    template: "welcome",
    to: " user@example.com ",
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), defaultOrigin);
  assert.deepEqual(json, { success: true, id: "email_test_123" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, userEmail);
  assert.match(sent[0].subject, /^Welcome to Vibely, Kaan!/);
  assert.match(sent[0].html, /Welcome to Vibely/);
});

test("welcome template data is sanitized before rendering", async () => {
  const { handler, sent } = makeHarness();

  const response = await handler(makeRequest(userToken, {
    data: { name: "<img src=x onerror=alert(1)>\r\nBcc: victim@example.com" },
    template: "welcome",
    to: userEmail,
  }));

  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].subject, /\r|\n/);
  assert.doesNotMatch(sent[0].html, /<img src=x onerror=alert\(1\)>/);
  assert.match(sent[0].html, /&lt;img src=x onerror=alert\(1\)&gt; Bcc: victim@example\.com/);
});

test("native-style requests without Origin keep working after auth", async () => {
  const { handler, sent } = makeHarness();

  const response = await handler(makeRequest(userToken, {
    data: { name: "Native" },
    template: "welcome",
    to: userEmail,
  }, null));
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(json, { success: true, id: "email_test_123" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, userEmail);
});

test("legitimate service-role invocation can send custom email", async () => {
  const { handler, sent } = makeHarness({ users: {} });

  const response = await handler(makeRequest(serviceRoleKey, {
    html: "<p>Operational message</p>",
    subject: "Ops",
    to: "ops@example.com",
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(json, { success: true, id: "email_test_123" });
  assert.deepEqual(sent, [{
    from: "Vibely <hello@vibelymeet.com>",
    html: "<p>Operational message</p>",
    subject: "Ops",
    to: "ops@example.com",
  }]);
});

test("service-role malformed custom payload is rejected before provider send", async () => {
  const { handler, sent } = makeHarness({ users: {} });

  const response = await handler(makeRequest(serviceRoleKey, {
    html: ["not", "html"],
    subject: "Ops",
    to: "ops@example.com",
  }));
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(json, { success: false, error: "Missing to, subject, or html" });
  assert.deepEqual(sent, []);
});

test("trusted-origin CORS is origin-specific and untrusted browser origins are rejected", async () => {
  const { handler, sent } = makeHarness();

  const preflight = await handler(new Request("https://example.test/functions/v1/send-email", {
    headers: { Origin: defaultOrigin },
    method: "OPTIONS",
  }));

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), defaultOrigin);
  assert.notEqual(preflight.headers.get("Access-Control-Allow-Origin"), "*");

  const rejected = await handler(makeRequest(serviceRoleKey, {
    html: "<p>blocked</p>",
    subject: "Blocked",
    to: "blocked@example.com",
  }, "https://evil.example"));

  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(await responseJson(rejected), { success: false, error: "Forbidden origin" });
  assert.deepEqual(sent, []);
});

test("Resend error logs and responses do not include attacker-provided HTML", async () => {
  const attackerHtml = "<img src=x onerror=alert(1)>";
  const { handler, logs } = makeHarness({
    providerResult: { ok: false, status: 422, bodyLength: attackerHtml.length },
  });

  const response = await handler(makeRequest(serviceRoleKey, {
    html: attackerHtml,
    subject: "Bad",
    to: "bad@example.com",
  }));
  const responseText = await response.text();
  const logText = JSON.stringify(logs);

  assert.equal(response.status, 200);
  assert.doesNotMatch(responseText, /onerror=alert/);
  assert.doesNotMatch(logText, /onerror=alert/);
  assert.match(logText, /send-email resend_failed/);
  assert.match(logText, /"status":422/);
  assert.match(logText, /"bodyLength":28/);
});

test("send-email source has no unsigned JWT payload role trust and keeps trusted CORS", () => {
  const indexSource = read("supabase/functions/send-email/index.ts");
  const handlerSource = read("supabase/functions/send-email/handler.ts");
  const combinedSource = `${indexSource}\n${handlerSource}`;
  const config = read("supabase/config.toml");

  assert.match(config, /\[functions\.send-email\][\s\S]{0,80}verify_jwt = false/);
  assert.match(indexSource, /from "\.\.\/_shared\/cors\.ts"/);
  assert.doesNotMatch(combinedSource, /jwtPayloadRole/);
  assert.doesNotMatch(combinedSource, /\batob\s*\(/);
  assert.doesNotMatch(combinedSource, /payload[\s\S]{0,160}\brole\b[\s\S]{0,80}service_role/i);
  assert.doesNotMatch(combinedSource, /\brole\b\s*={2,3}\s*["']service_role["']/);
  assert.doesNotMatch(combinedSource, /Access-Control-Allow-Origin["']?\s*:\s*["']\*/);
});
