export type DateSuggestionActionNormalizeResult =
  | {
      ok: true;
      payload: Record<string, unknown>;
      shareRequested: boolean;
    }
  | {
      ok: false;
      error: string;
      error_code: string;
    };

const TRUE_VALUES = new Set(["true", "t", "1", "yes"]);
const FALSE_VALUES = new Set(["false", "f", "0", "no", "off", ""]);

export const DATE_SUGGESTION_SCALAR_EXTRACTION_MESSAGE = "cannot extract elements from a scalar";

export function isDateSuggestionRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBooleanLike(value: unknown): boolean | null {
  const normalized = String(value ?? "false").toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function clonePlainPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload };
}

function normalizeSlotKeyArray(value: unknown): string[] | "nullish" | "invalid" {
  if (value == null) return "nullish";
  if (!Array.isArray(value)) return "invalid";

  const keys: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return "invalid";
    const trimmed = item.trim();
    if (!trimmed) return "invalid";
    keys.push(trimmed);
  }
  return keys;
}

function normalizeRevisionPayload(
  payload: Record<string, unknown>,
  action: string,
): DateSuggestionActionNormalizeResult {
  if (!isDateSuggestionRecord(payload.revision)) {
    return { ok: false, error: "revision_fields_required", error_code: "revision_fields_required" };
  }

  const normalizedPayload = clonePlainPayload(payload);
  const revision = { ...payload.revision };
  const shareFlag = parseBooleanLike(revision.schedule_share_enabled);
  const timeChoiceKey = typeof revision.time_choice_key === "string" ? revision.time_choice_key : "";
  if (shareFlag == null) {
    return {
      ok: false,
      error: "invalid_schedule_share_enabled",
      error_code: "invalid_schedule_share_enabled",
    };
  }

  const shareRequested = shareFlag === true || timeChoiceKey === "share_schedule";
  if (shareRequested && shareFlag !== true) {
    revision.schedule_share_enabled = true;
  }
  const hasSelectedSlotKeys = Object.prototype.hasOwnProperty.call(revision, "selected_slot_keys");
  let selectedSlotKeys: string[] | "nullish" = "nullish";

  if (hasSelectedSlotKeys) {
    const normalized = normalizeSlotKeyArray(revision.selected_slot_keys);
    if (normalized === "invalid") {
      return { ok: false, error: "invalid_selected_slot_keys", error_code: "invalid_selected_slot_keys" };
    }

    selectedSlotKeys = normalized;
    if (normalized === "nullish" || !shareRequested) {
      delete revision.selected_slot_keys;
    } else {
      revision.selected_slot_keys = normalized;
    }
  }

  if (shareRequested && (selectedSlotKeys === "nullish" || selectedSlotKeys.length === 0)) {
    delete revision.selected_slot_keys;
    normalizedPayload.revision = revision;
    return { ok: false, error: "selected_slots_required", error_code: "selected_slots_required" };
  }

  normalizedPayload.revision = revision;
  return {
    ok: true,
    payload: normalizedPayload,
    shareRequested: ["send_proposal", "counter"].includes(action) && shareRequested,
  };
}

function normalizeEditScheduleSharePayload(payload: Record<string, unknown>): DateSuggestionActionNormalizeResult {
  const normalizedPayload = clonePlainPayload(payload);
  const normalized = normalizeSlotKeyArray(normalizedPayload.selected_slot_keys);

  if (normalized === "invalid") {
    return { ok: false, error: "invalid_selected_slot_keys", error_code: "invalid_selected_slot_keys" };
  }

  if (normalized === "nullish" || normalized.length === 0) {
    delete normalizedPayload.selected_slot_keys;
    return { ok: false, error: "selected_slots_required", error_code: "selected_slots_required" };
  }

  normalizedPayload.selected_slot_keys = normalized;
  return { ok: true, payload: normalizedPayload, shareRequested: true };
}

export function normalizeDateSuggestionActionPayload(
  action: string,
  payload: Record<string, unknown>,
): DateSuggestionActionNormalizeResult {
  if (["send_proposal", "counter"].includes(action)) {
    return normalizeRevisionPayload(payload, action);
  }

  if (action === "edit_schedule_share_slots") {
    return normalizeEditScheduleSharePayload(payload);
  }

  return { ok: true, payload: clonePlainPayload(payload), shareRequested: false };
}

export function dateSuggestionRpcErrorCode(message: unknown): string | null {
  const text = String(message ?? "");
  if (text.includes(DATE_SUGGESTION_SCALAR_EXTRACTION_MESSAGE)) return "invalid_selected_slot_keys";
  return null;
}
