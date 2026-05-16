import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

test("native date composer uses an inline date-time picker across native and Expo web", () => {
  const nativeComposer = readRepoFile("apps/mobile/components/chat/DateSuggestionSheet.tsx");

  assert.doesNotMatch(nativeComposer, /@react-native-community\/datetimepicker/);
  assert.doesNotMatch(nativeComposer, /<DateTimePicker\b/);
  assert.match(nativeComposer, /const HOUR12_OPTIONS = \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12\] as const/);
  assert.match(nativeComposer, /let startsAt: string \| null \| undefined = null/);
  assert.match(nativeComposer, /let endsAt: string \| null \| undefined = null/);
  assert.match(nativeComposer, /let timeBlock: string \| null \| undefined = null/);
  assert.match(nativeComposer, /const \[inlinePickOpen, setInlinePickOpen\] = useState\(false\)/);
  assert.match(nativeComposer, /const \[inlinePickPhase, setInlinePickPhase\] = useState<'date' \| 'time'>\('date'\)/);
  assert.match(nativeComposer, /function isUsableExactPick/);
  assert.match(nativeComposer, /function nextDefaultExactPick/);
  assert.match(nativeComposer, /w\.timeChoiceKey === 'pick_a_time' && !isUsableExactPick\(w\.pickStartIso\)/);
  assert.match(nativeComposer, /const resetInlinePickUi = useCallback/);
  assert.match(nativeComposer, /resetInlinePickUi\(\);\s*if \(!visible\) return/);
  assert.match(nativeComposer, /const openInlinePickFlow = useCallback/);
  assert.match(nativeComposer, /const fallback = nextDefaultExactPick\(\)/);
  assert.match(nativeComposer, /const base = Number\.isFinite\(parsedMs\) && parsedMs > Date\.now\(\) \? parsed : fallback/);
  assert.match(nativeComposer, /onPress=\{openInlinePickFlow\}/);
  assert.match(nativeComposer, /Choose date & time/);
  assert.match(nativeComposer, /Pick a date/);
  assert.match(nativeComposer, /Pick a time/);
  assert.match(nativeComposer, /disabled = isBeforeLocalDay\(day, todayStart\)/);
  assert.match(nativeComposer, /previousMonthDisabled = inlinePickMonth\.getTime\(\) <= startOfLocalMonth\(todayStart\)\.getTime\(\)/);
  assert.match(nativeComposer, /disabled=\{previousMonthDisabled\}/);
  assert.match(nativeComposer, /setInlinePickPhase\('time'\)/);
  assert.match(nativeComposer, /inlinePickTimeIsPast = inlinePickCandidate\.getTime\(\) <= Date\.now\(\)/);
  assert.match(nativeComposer, /disabled=\{inlinePickTimeIsPast\}/);
  assert.match(nativeComposer, /accessibilityState=\{\{ disabled: inlinePickTimeIsPast \}\}/);
  assert.match(nativeComposer, /That date and time has passed\. Choose a future time before sending\./);
  assert.match(nativeComposer, /if \(inlinePickCandidate\.getTime\(\) <= Date\.now\(\)\)/);
  assert.match(nativeComposer, /const exactPickIso = inlinePickCandidate\.toISOString\(\)/);
  assert.match(
    nativeComposer,
    /pickStartIso: exactPickIso,\s*pickEndIso: exactPickIso/,
  );
});

test("web date composer still opens its inline calendar and saves exact proposal time", () => {
  const webComposer = readRepoFile("src/components/chat/DateSuggestionComposer.tsx");

  assert.match(webComposer, /const HOUR12_OPTIONS = \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12\] as const/);
  assert.match(webComposer, /const openPickFlow = useCallback/);
  assert.match(webComposer, /let startsAt: string \| null \| undefined = null/);
  assert.match(webComposer, /let endsAt: string \| null \| undefined = null/);
  assert.match(webComposer, /let timeBlock: string \| null \| undefined = null/);
  assert.match(webComposer, /function isUsableExactPick/);
  assert.match(webComposer, /function nextDefaultExactPick/);
  assert.match(webComposer, /w\.timeChoiceKey === "pick_a_time" && !isUsableExactPick\(w\.pickStartIso\)/);
  assert.match(webComposer, /const fallback = nextDefaultExactPick\(\)/);
  assert.match(webComposer, /const base = Number\.isFinite\(parsedMs\) && parsedMs > Date\.now\(\) \? parsed : fallback/);
  assert.match(webComposer, /const resetPickFlowUi = useCallback/);
  assert.match(webComposer, /resetPickFlowUi\(\);\s*if \(!open\) return/);
  assert.match(webComposer, /onClick=\{openPickFlow\}/);
  assert.match(webComposer, /Choose date & time/);
  assert.match(webComposer, /<Calendar\s+mode="single"/);
  assert.match(webComposer, /disabled=\{\(date\) => isBefore\(startOfDay\(date\), startOfDay\(new Date\(\)\)\)\}/);
  assert.match(webComposer, /setPickPhase\("time"\)/);
  assert.match(webComposer, /pickTimeIsPast = pickCandidate\.getTime\(\) <= Date\.now\(\)/);
  assert.match(webComposer, /disabled=\{pickTimeIsPast\}/);
  assert.match(webComposer, /That date and time has passed\. Choose a future time before sending\./);
  assert.match(webComposer, /if \(pickCandidate\.getTime\(\) <= Date\.now\(\)\)/);
  assert.match(webComposer, /const exactPickIso = pickCandidate\.toISOString\(\)/);
  assert.match(
    webComposer,
    /pickStartIso: exactPickIso,\s*pickEndIso: exactPickIso/,
  );
});
