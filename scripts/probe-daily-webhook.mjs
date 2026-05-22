#!/usr/bin/env node
import { createHmac, randomUUID } from "node:crypto";

const CLOUD_ENDPOINT =
  "https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook";
const LOCAL_ENDPOINT =
  "http://127.0.0.1:54321/functions/v1/video-date-daily-webhook";

function usage() {
  console.log(`Usage: DAILY_WEBHOOK_SECRET=<base64 hmac> node scripts/probe-daily-webhook.mjs [options]

Options:
  --cloud                 Use the production Supabase endpoint (default).
  --local                 Use the local Supabase Functions endpoint.
  --endpoint <url>        Use a custom endpoint.
  --dry-run               Build and sign the request but do not send it.
  --verification-probe    Send Daily's webhook verification body {"test":"test"}.
  --event-type <type>     Synthetic event type (default: participant.joined).
  --room-name <name>      Synthetic room name.
  --user-id <uuid>        Synthetic participant user_id.
  --participant-id <id>   Synthetic provider participant id.
  --help                  Show this help.

The script never prints DAILY_WEBHOOK_SECRET or the computed signature.`);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function decodeBase64Secret(value) {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    return null;
  }
  const bytes = Buffer.from(trimmed, "base64");
  return bytes.length > 0 ? bytes : null;
}

function endpointFor(args) {
  const custom = readOption(args, "--endpoint");
  if (custom) return custom;
  if (args.includes("--local")) return LOCAL_ENDPOINT;
  return CLOUD_ENDPOINT;
}

function syntheticPayload(args) {
  if (args.includes("--verification-probe")) return { test: "test" };

  return {
    id: `codex-daily-webhook-smoke-${randomUUID()}`,
    type: readOption(args, "--event-type") ?? "participant.joined",
    room_name: readOption(args, "--room-name") ?? "date-00000000000000000000000000000000",
    participant: {
      id: readOption(args, "--participant-id") ?? "codex-smoke-participant",
      user_id: readOption(args, "--user-id") ?? "00000000-0000-4000-8000-000000000000",
    },
    timestamp: Math.floor(Date.now() / 1000),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    usage();
    return;
  }

  const secret = process.env.DAILY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("DAILY_WEBHOOK_SECRET is required and was not printed.");
  }

  const secretBytes = decodeBase64Secret(secret);
  if (!secretBytes) {
    throw new Error("DAILY_WEBHOOK_SECRET must be Daily's base64 webhook hmac.");
  }

  const endpoint = endpointFor(args);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(syntheticPayload(args));
  const signature = createHmac("sha256", secretBytes)
    .update(`${timestamp}.${body}`)
    .digest("base64");

  const summary = {
    endpoint,
    mode: args.includes("--dry-run") ? "dry_run" : "post",
    payload: JSON.parse(body),
    timestamp,
    secret: "loaded_not_printed",
    signature: "computed_not_printed",
  };

  if (args.includes("--dry-run")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Timestamp": timestamp,
      "X-Webhook-Signature": signature,
    },
    body,
  });

  const responseBody = await response.text();
  console.log(responseBody);
  console.log(`HTTP_STATUS:${response.status}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "daily_webhook_probe_failed");
  process.exitCode = 1;
});
