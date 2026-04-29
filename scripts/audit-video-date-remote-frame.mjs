#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function extractStringConst(source, name, relPath) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*"([^"]*)"`));
  assert(Boolean(match), `${relPath}: missing ${name} string constant`);
  return match?.[1] ?? "";
}

function sliceBetween(source, start, end, relPath) {
  const startIndex = source.indexOf(start);
  assert(startIndex >= 0, `${relPath}: missing marker ${start}`);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex);
  assert(endIndex >= 0, `${relPath}: missing marker ${end}`);
  return source.slice(startIndex, endIndex >= 0 ? endIndex : undefined);
}

function assertNoCropTokens(label, value) {
  assert(!/\bobject-cover\b/.test(value), `${label}: must not use object-cover`);
  assert(!/\bscale-[^\s"'`]+/.test(value), `${label}: must not use Tailwind scale-*`);
  assert(!/\b(?:transform|translate|rotate|skew)(?:-[^\s"'`]+)?\b/.test(value), `${label}: must not use transform utilities`);
  assert(!/\boverflow-hidden\b/.test(value), `${label}: must not hide overflow around the remote video`);
}

const webDatePath = "src/pages/VideoDate.tsx";
const webDate = read(webDatePath);
const webRemoteContainerClass = extractStringConst(webDate, "REMOTE_DATE_VIDEO_CONTAINER_CLASS", webDatePath);
const webRemoteVideoClass = extractStringConst(webDate, "REMOTE_DATE_VIDEO_CLASS", webDatePath);
const webRemoteRender = sliceBetween(
  webDate,
  "Remote Video with Progressive Blur",
  "<SelfViewPIP",
  webDatePath
);

assert(
  webRemoteContainerClass === "flex-1 relative bg-black",
  `${webDatePath}: remote date container must stay exactly "flex-1 relative bg-black"`
);
assert(
  webRemoteVideoClass === "w-full h-full object-contain object-center",
  `${webDatePath}: remote date video must stay exactly "w-full h-full object-contain object-center"`
);
assertNoCropTokens(`${webDatePath}: REMOTE_DATE_VIDEO_CONTAINER_CLASS`, webRemoteContainerClass);
assertNoCropTokens(`${webDatePath}: REMOTE_DATE_VIDEO_CLASS`, webRemoteVideoClass);
assert(
  webRemoteRender.includes("className={REMOTE_DATE_VIDEO_CONTAINER_CLASS}"),
  `${webDatePath}: remote date render must use REMOTE_DATE_VIDEO_CONTAINER_CLASS`
);
assert(
  webRemoteRender.includes("className={REMOTE_DATE_VIDEO_CLASS}"),
  `${webDatePath}: remote date render must use REMOTE_DATE_VIDEO_CLASS`
);
assert(!/style=\{\{[^}]*\btransform\s*:/.test(webRemoteRender), `${webDatePath}: remote date video style must not set transform`);
assert(!/style=\{\{[^}]*\bscale\s*:/.test(webRemoteRender), `${webDatePath}: remote date video style must not set scale`);

const nativeDatePath = "apps/mobile/app/date/[id].tsx";
const nativeDate = read(nativeDatePath);
const nativeRemoteBlock = sliceBetween(
  nativeDate,
  "<View style={styles.remoteContainer}>",
  "<View style={[styles.localPip",
  nativeDatePath
);

assert(
  /remoteContainer:\s*\{[^}]*backgroundColor:\s*'#000'/.test(nativeDate),
  `${nativeDatePath}: remoteContainer must provide a black letterbox background`
);
assert(
  /<DailyMediaView[\s\S]*?mirror=\{false\}[\s\S]*?objectFit="contain"[\s\S]*?zOrder=\{0\}/.test(nativeRemoteBlock),
  `${nativeDatePath}: remote DailyMediaView must explicitly use mirror={false}, objectFit="contain", and zOrder={0}`
);
assert(
  !/<DailyMediaView[\s\S]*?objectFit="cover"[\s\S]*?zOrder=\{0\}/.test(nativeRemoteBlock),
  `${nativeDatePath}: remote DailyMediaView must not use objectFit="cover"`
);
assert(
  nativeRemoteBlock.includes("DailyMediaView defaults to cover"),
  `${nativeDatePath}: remote DailyMediaView must keep the invariant comment explaining contain`
);

const selfViewPath = "src/components/video-date/SelfViewPIP.tsx";
const selfView = read(selfViewPath);
assert(
  selfView.includes("Self-view PIP") && selfView.includes("intentionally crops"),
  `${selfViewPath}: intentional self-view crop behavior must stay documented`
);

const webMatchCallPath = "src/components/chat/ActiveCallOverlay.tsx";
const webMatchCall = read(webMatchCallPath);
assert(
  webMatchCall.includes("Match/chat calls are intentionally full-bleed today"),
  `${webMatchCallPath}: match/chat full-bleed crop behavior must stay documented`
);

const nativeMatchCallPath = "apps/mobile/components/chat/ActiveCallOverlay.tsx";
const nativeMatchCall = read(nativeMatchCallPath);
assert(
  nativeMatchCall.includes("Match/chat calls are intentionally full-bleed today"),
  `${nativeMatchCallPath}: native match/chat full-bleed crop behavior must stay documented`
);
assert(
  /<DailyMediaView[\s\S]*?mirror=\{false\}[\s\S]*?objectFit="cover"[\s\S]*?zOrder=\{0\}/.test(nativeMatchCall),
  `${nativeMatchCallPath}: native match/chat remote full-bleed crop must be explicit if it remains intentional`
);

if (failures.length > 0) {
  console.error("Video date remote frame audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Video date remote frame audit passed.");
