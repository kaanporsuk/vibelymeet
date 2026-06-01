import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260601120000_admin_event_publish_unpublish_lifecycle.sql");
const lifecycleForwardSyncMigration = read("supabase/migrations/20260601133000_admin_event_lifecycle_forward_sync.sql");
const statusHardeningMigration = read("supabase/migrations/20260601143000_event_creation_status_bulletproofing.sql");
const adminEventsPanel = read("src/components/admin/AdminEventsPanel.tsx");
const adminEventControls = read("src/components/admin/AdminEventControls.tsx");
const adminEventForm = read("src/components/admin/AdminEventFormModal.tsx");
const batchEventImport = read("src/components/admin/BatchEventImportModal.tsx");
const adminEventInvalidation = read("src/lib/adminEventInvalidation.ts");
const adminActivityLog = read("src/components/admin/AdminActivityLog.tsx");
const webEventDetails = read("src/pages/EventDetails.tsx");
const webEventUtils = read("src/utils/eventUtils.ts");
const webEventReminders = read("src/hooks/useEventReminders.ts");
const webPaymentSuccess = read("src/pages/EventPaymentSuccess.tsx");
const nativeEventDetails = read("apps/mobile/app/(tabs)/events/[id].tsx");
const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
const nativePaymentSuccess = read("apps/mobile/app/event-payment-success.tsx");
const createEventCheckout = read("supabase/functions/create-event-checkout/index.ts");
const eventLifecycle = read("shared/eventLifecycle.ts");
const supabaseTypes = read("src/integrations/supabase/types.ts");
const discoverVisibility = read("shared/discoverEventVisibility.ts");
const visibleEventsMigration = read("supabase/migrations/20260521161000_video_date_phase0_observability_flags.sql");

function fnSection(source: string, fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = source.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = source.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const comment = source.indexOf("\nCOMMENT ON FUNCTION", start + marker.length);
  const candidates = [next, revoke, comment].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("admin publish and unpublish RPCs are explicit lifecycle actions", () => {
  for (const fn of [
    "admin_publish_event",
    "admin_unpublish_event",
    "admin_publish_event_series",
    "admin_unpublish_event_series",
  ]) {
    const source = fnSection(migration, fn);

    assert.match(source, /SECURITY DEFINER/);
    assert.match(source, /SET search_path = public, pg_catalog/);
    assert.match(source, /auth\.uid\(\)/);
    assert.match(source, /has_role\(v_admin_id, 'admin'::public\.app_role\)/);
    assert.match(source, new RegExp(`admin_idempotency_begin\\(v_admin_id, '${fn}'`));
    assert.match(source, new RegExp(`admin_idempotency_complete\\(v_admin_id, '${fn}'`));
    assert.match(source, /FOR UPDATE/);
    assert.match(source, /log_admin_action\([\s\S]{0,80}'event\.(publish|unpublish)(_series)?'/);
  }

  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_publish_event\(uuid, text, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_publish_event\(uuid, text, text\) TO authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_unpublish_event\(uuid, text, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_unpublish_event\(uuid, text, text\) TO authenticated/);
});

test("unpublish blocks hidden-with-registrations cases", () => {
  const unpublish = fnSection(migration, "admin_unpublish_event");
  const unpublishSeries = fnSection(migration, "admin_unpublish_event_series");

  assert.match(unpublish, /admission_status IN \('confirmed', 'waitlisted'\)/);
  assert.match(unpublish, /active_registration_count/);
  assert.match(unpublish, /Events with confirmed or waitlisted registrations cannot be unpublished/);
  assert.match(unpublish, /SET status = 'draft'/);

  assert.match(unpublishSeries, /event_id = ANY\(v_candidate_ids\)/);
  assert.match(unpublishSeries, /admission_status IN \('confirmed', 'waitlisted'\)/);
  assert.match(unpublishSeries, /Series with confirmed or waitlisted registrations cannot be unpublished/);
  assert.match(unpublishSeries, /SET status = 'draft'/);
});

test("generic event updates cannot mutate lifecycle fields", () => {
  const update = fnSection(migration, "admin_update_event");
  const finalUpdate = fnSection(lifecycleForwardSyncMigration, "admin_update_event");

  for (const source of [update, finalUpdate]) {
    assert.match(source, /ARRAY\['archived_at', 'archived_by', 'ended_at', 'status'\]/);
    assert.match(source, /Event lifecycle fields must be changed through lifecycle admin actions/);
    assert.match(source, /INVALID_TRANSITION/);
    assert.match(source, /v_before\.archived_at IS NOT NULL/);
    assert.match(source, /lower\(COALESCE\(v_before\.status, ''\)\) = 'archived'/);
    assert.match(source, /WHERE key NOT IN \('title', 'description', 'cover_image', 'language', 'tags', 'vibes', 'category_keys'\)/);
    assert.doesNotMatch(source, /SET[\s\S]{0,120}status = CASE WHEN p_payload \? 'status'/);
  }
});

test("recurrence generation preserves draft status and blocks invalid parents", () => {
  const generator = fnSection(migration, "generate_recurring_events");
  const finalGenerator = fnSection(lifecycleForwardSyncMigration, "generate_recurring_events");
  const wrapper = fnSection(migration, "admin_generate_recurring_events");

  for (const source of [generator, finalGenerator]) {
    assert.match(source, /v_child_status := CASE WHEN lower\(COALESCE\(v_parent\.status, ''\)\) = 'draft' THEN 'draft' ELSE 'upcoming' END/);
    assert.match(source, /lower\(COALESCE\(status, ''\)\) NOT IN \('archived', 'cancelled'\)/);
    assert.match(source, /language, event_date/);
    assert.match(source, /tags, category_keys, status/);
    assert.match(source, /location_name, location_address/);
    assert.match(source, /is_location_specific, is_test_event/);
    assert.match(source, /COALESCE\(v_parent\.category_keys, ARRAY\[\]::text\[\]\), v_child_status/);
    assert.doesNotMatch(source, /v_parent\.tags, 'upcoming'/);
  }

  assert.match(wrapper, /v_parent_status IN \('archived', 'cancelled'\)/);
  assert.match(wrapper, /Archived or cancelled recurring parents cannot generate occurrences/);
});

test("admin Events UI exposes publish and unpublish actions without a generic status editor", () => {
  assert.match(adminEventsPanel, /callAdminRpc\(unpublish \? "admin_unpublish_event" : "admin_publish_event"/);
  assert.match(adminEventsPanel, /callAdminRpc\(unpublish \? "admin_unpublish_event_series" : "admin_publish_event_series"/);
  assert.match(adminEventsPanel, /rawStatus === 'draft'/);
  assert.match(adminEventsPanel, /rawStatus === 'upcoming'/);
  assert.match(adminEventsPanel, /computed === 'upcoming'/);
  assert.match(adminEventsPanel, /seriesIsLifecycleMutable/);
  assert.match(adminEventsPanel, /hasLoadedFutureDraftOccurrence/);
  assert.match(adminEventsPanel, /hasLoadedFutureUpcomingOccurrence/);
  assert.match(adminEventsPanel, /const canPublishSeries =/);
  assert.match(adminEventsPanel, /const canUnpublishSeries =/);
  assert.match(adminEventsPanel, /kind: "publish-series"/);
  assert.match(adminEventsPanel, /kind: "unpublish-series"/);
  assert.match(adminEventsPanel, /The backend blocks this if the event has confirmed or waitlisted registrations/);
  assert.match(adminEventsPanel, /invalidateAdminEventSurfaces/);

  assert.doesNotMatch(adminEventForm, /<SelectItem value="draft"/);
  assert.doesNotMatch(adminEventForm, /<SelectItem value="upcoming"/);
  assert.doesNotMatch(adminEventForm, /status:\s*event\?\.status/);
});

test("create modal supports save as draft without announcement notifications", () => {
  assert.match(adminEventForm, /type EventCreateStatus = "draft" \| "upcoming"/);
  assert.match(adminEventForm, /eventData\.status = createStatus/);
  assert.match(adminEventForm, /Save as Draft/);
  assert.match(adminEventForm, /const createdAsDraft = result\.status === "draft"/);
  assert.match(adminEventForm, /if \(!createdAsDraft\) await sendCreatedAnnouncement\(\)/);
  assert.match(adminEventForm, /event-notifications/);
  assert.ok(
    adminEventForm.indexOf('callAdminRpc("admin_generate_recurring_events"') <
      adminEventForm.indexOf("await sendCreatedAnnouncement()"),
    "recurring published creates must generate child occurrences before announcement emails",
  );
  assert.match(adminEventForm, /The event is not discoverable until it is published/);
  assert.match(adminEventForm, /invalidateAdminEventSurfaces/);
});

test("activity log and discovery surfaces recognize the lifecycle model", () => {
  assert.match(adminActivityLog, /"event\.publish": \{ label: "Event Published"/);
  assert.match(adminActivityLog, /"event\.unpublish": \{ label: "Event Unpublished"/);
  assert.match(adminActivityLog, /"event\.publish_series": \{ label: "Event Series Published"/);
  assert.match(adminActivityLog, /"event\.unpublish_series": \{ label: "Event Series Unpublished"/);

  assert.match(visibleEventsMigration, /e\.status != 'draft'/);
  assert.match(visibleEventsMigration, /e\.status IS DISTINCT FROM 'cancelled'/);
  assert.match(statusHardeningMigration, /lower\(COALESCE\(e\.status, 'upcoming'\)\) NOT IN \('draft', 'cancelled', 'archived', 'ended', 'completed'\)/);
  assert.match(statusHardeningMigration, /lower\(COALESCE\(e\.status, 'upcoming'\)\) IN \('ended', 'completed'\)/);
  assert.match(statusHardeningMigration, /lower\(COALESCE\(e\.status, 'upcoming'\)\) NOT IN \('draft', 'cancelled', 'ended', 'completed', 'archived'\)/);
  assert.match(discoverVisibility, /st === "draft"/);
  assert.match(discoverVisibility, /return false/);
});

test("event creation hardening closes backend and integration status gaps", () => {
  const validate = fnSection(statusHardeningMigration, "admin_validate_event_payload");
  const visible = fnSection(statusHardeningMigration, "get_visible_events");
  const otherCity = fnSection(statusHardeningMigration, "get_other_city_events");
  const reminders = fnSection(statusHardeningMigration, "send_event_reminders");
  const claimReminders = fnSection(statusHardeningMigration, "claim_due_event_reminder_queue_rows");
  const activeState = fnSection(statusHardeningMigration, "get_event_lobby_active_state");
  const register = fnSection(statusHardeningMigration, "register_for_event");
  const settle = fnSection(statusHardeningMigration, "settle_event_ticket_checkout");

  assert.match(validate, /p_is_create AND v_event_date IS NOT NULL AND v_event_date <= now\(\)/);
  assert.match(validate, /event_date must be in the future when creating events/);
  assert.match(statusHardeningMigration, /DROP POLICY IF EXISTS "Anyone can view events"/);
  assert.match(statusHardeningMigration, /lower\(COALESCE\(status, ''\)\) NOT IN \('draft', 'cancelled', 'archived', 'ended', 'completed'\)/);
  assert.match(statusHardeningMigration, /REVOKE ALL ON FUNCTION public\.get_visible_events\(uuid, double precision, double precision, boolean, double precision, double precision, double precision\) FROM PUBLIC, anon/);
  assert.match(statusHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.get_visible_events\(uuid, double precision, double precision, boolean, double precision, double precision, double precision\) TO authenticated, service_role/);
  assert.match(statusHardeningMigration, /REVOKE ALL ON FUNCTION public\.get_other_city_events\(uuid, double precision, double precision\) FROM PUBLIC, anon/);
  assert.match(statusHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.get_other_city_events\(uuid, double precision, double precision\) TO authenticated, service_role/);

  assert.match(visible, /lower\(COALESCE\(e\.status, 'upcoming'\)\) NOT IN \('draft', 'cancelled', 'archived', 'ended', 'completed'\)/);
  assert.match(visible, /lower\(COALESCE\(e\.status, 'upcoming'\)\) IN \('ended', 'completed'\)/);
  assert.match(visible, /WHEN lower\(COALESCE\(e\.status, ''\)\) = 'archived'/);
  assert.match(visible, /WHEN lower\(COALESCE\(e\.status, ''\)\) IN \('ended', 'completed'\) THEN 'ended'/);
  assert.match(otherCity, /auth\.uid\(\) IS NULL OR auth\.uid\(\) IS DISTINCT FROM p_user_id/);
  assert.match(otherCity, /NOT IN \('draft', 'cancelled', 'ended', 'completed', 'archived'\)/);

  assert.match(activeState, /v_status IN \('ended', 'completed'\)/);
  assert.match(activeState, /RETURN QUERY SELECT false, 'event_ended'::text/);
  assert.match(activeState, /v_status NOT IN \('upcoming', 'scheduled', 'live'\)/);

  assert.match(register, /register_for_event_20260601143000_terminal_base/);
  assert.match(register, /IN \('draft', 'cancelled', 'archived', 'ended', 'completed'\)/);
  assert.match(settle, /settle_event_ticket_checkout_20260601143000_terminal_base/);
  assert.match(settle, /IN \('draft', 'cancelled', 'archived', 'ended', 'completed'\)/);
  assert.match(settle, /'code', 'EVENT_CLOSED'/);
  assert.match(statusHardeningMigration, /REVOKE ALL ON FUNCTION public\.register_for_event_20260601143000_terminal_base\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(statusHardeningMigration, /REVOKE ALL ON FUNCTION public\.settle_event_ticket_checkout_20260601143000_terminal_base\(text, uuid, uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(createEventCheckout, /status === 'ended'/);
  assert.match(createEventCheckout, /status === 'completed'/);

  assert.match(reminders, /er\.admission_status = 'confirmed'/);
  assert.match(reminders, /COALESCE\(e\.is_test_event, false\) = false/);
  assert.match(reminders, /NOT IN \('draft', 'cancelled', 'archived', 'ended', 'completed'\)/);
  assert.match(statusHardeningMigration, /ADD COLUMN IF NOT EXISTS discarded_at timestamptz/);
  assert.match(claimReminders, /last_error_reason = 'event_not_notifiable'/);
  assert.match(claimReminders, /discarded_at = v_now/);
  assert.match(claimReminders, /JOIN public\.event_registrations er/);
  assert.match(claimReminders, /v_now < e\.event_date/);
});

test("generated Supabase types expose publish and unpublish RPC contracts", () => {
  assert.match(supabaseTypes, /admin_publish_event: \{/);
  assert.match(supabaseTypes, /admin_unpublish_event: \{/);
  assert.match(supabaseTypes, /admin_publish_event_series: \{/);
  assert.match(supabaseTypes, /admin_unpublish_event_series: \{/);
  assert.match(supabaseTypes, /p_event_id: string/);
  assert.match(supabaseTypes, /p_parent_event_id: string/);
});

test("admin lifecycle controls refresh user-facing event caches", () => {
  for (const source of [adminEventsPanel, adminEventControls, adminEventForm, batchEventImport]) {
    assert.match(source, /invalidateAdminEventSurfaces/);
  }

  for (const queryKey of [
    "admin-events",
    "events",
    "visible-events",
    "events-discover",
    "other-city-events",
    "next-event",
    "next-registered-event",
    "event-details",
    "registered-upcoming-events-invite",
    "event-deck",
  ]) {
    assert.match(adminEventInvalidation, new RegExp(`\\["${queryKey}"\\]`));
  }
});

test("web and native direct event details block draft or archived registration attempts", () => {
  assert.match(webEventUtils, /status === 'draft'/);
  assert.match(webEventUtils, /status === 'archived'/);
  assert.match(webEventUtils, /status === 'ended'/);
  assert.match(webEventUtils, /status === 'completed'/);
  assert.match(webEventUtils, /event\.archived_at/);
  assert.match(webEventUtils, /event\.ended_at/);
  assert.match(nativeEventsApi, /status === 'draft'/);
  assert.match(nativeEventsApi, /status === 'archived'/);
  assert.match(nativeEventsApi, /status === 'ended'/);
  assert.match(nativeEventsApi, /status === 'completed'/);
  assert.match(nativeEventsApi, /event\.archived_at/);
  assert.match(nativeEventsApi, /event\.ended_at/);
  assert.match(eventLifecycle, /rawTerminalStatus/);
  assert.match(eventLifecycle, /rawStatus === "ended" \|\| rawStatus === "completed"/);

  assert.match(webEventDetails, /const eventStatus = \(event\.status \?\? ""\)\.toLowerCase\(\)/);
  assert.match(webEventDetails, /eventStatus === "draft"/);
  assert.match(webEventDetails, /eventStatus === "archived"/);
  assert.match(webEventDetails, /eventStatus === "ended"/);
  assert.match(webEventDetails, /eventStatus === "completed"/);
  assert.match(webEventDetails, /Boolean\(event\.endedAt\)/);
  assert.match(webEventDetails, /Boolean\(event\.archivedAt\)/);
  assert.match(webEventDetails, /showEventPhoneNudge && !hasEventAdmission && !isUnavailableStatus/);
  assert.match(webEventDetails, /const purchaseCtaDisabled = soldOut \|\| eventEnded \|\| freeRegisterBusy \|\| isUnavailableStatus/);
  assert.match(webEventDetails, /onAccessPress=\{!isConfirmed && !isUnavailableStatus/);
  assert.match(webEventDetails, /!hasEventAdmission && !isUnavailableStatus/);
  assert.match(webEventDetails, /\.is\('ended_at', null\)/);
  assert.match(webEventDetails, /\.not\('status', 'in', '\(draft,cancelled,archived,ended,completed\)'\)/);
  assert.match(webEventReminders, /\.is\('archived_at', null\)/);
  assert.match(webEventReminders, /\.is\('ended_at', null\)/);
  assert.match(webEventReminders, /\.not\('status', 'in', '\(draft,cancelled,archived,ended,completed\)'\)/);

  assert.match(nativeEventDetails, /function getUnavailableEventState/);
  assert.match(nativeEventDetails, /status === 'draft'/);
  assert.match(nativeEventDetails, /status === 'archived'/);
  assert.match(nativeEventDetails, /status === 'ended'/);
  assert.match(nativeEventDetails, /status === 'completed'/);
  assert.match(nativeEventDetails, /Boolean\(event\?\.ended_at\)/);
  assert.match(nativeEventDetails, /Boolean\(event\?\.archived_at\)/);
  assert.match(nativeEventDetails, /if \(unavailable\.isUnavailable\)/);
  assert.match(nativeEventDetails, /showInviteSheet && !isUnavailableStatus/);
  assert.match(nativeEventDetails, /!isUnavailableStatus \? \(\s+<Pressable[\s\S]*Invite friends to this event/);
  assert.match(nativeEventDetails, /onAccessPress=\{!hasAdmission && !isUnavailableStatus/);
  assert.match(nativeEventDetails, /accessDisabled=\{isPurchasing \|\| isRegistering \|\| soldOut \|\| eventEnded \|\| isUnavailableStatus\}/);
  assert.match(nativeEventDetails, /!hasAdmission && !isUnavailableStatus/);
  assert.match(nativeEventDetails, /\.is\('ended_at', null\)/);
  assert.match(nativeEventDetails, /\.not\('status', 'in', '\(draft,cancelled,archived,ended,completed\)'\)/);
  assert.match(webPaymentSuccess, /select\("title, status, archived_at, ended_at"\)/);
  assert.match(webPaymentSuccess, /status === "ended"/);
  assert.match(webPaymentSuccess, /status === "completed"/);
  assert.match(webPaymentSuccess, /paymentStatus\?\.settlement\?\.code === "EVENT_CLOSED"/);
  assert.match(webPaymentSuccess, /!paymentClosedWithoutAdmission/);
  assert.match(webPaymentSuccess, /copy\.showViewEventAction[\s\S]*!eventRowClosed/);
  assert.match(nativePaymentSuccess, /select\('title, status, archived_at, ended_at'\)/);
  assert.match(nativePaymentSuccess, /status === 'ended'/);
  assert.match(nativePaymentSuccess, /status === 'completed'/);
  assert.match(nativePaymentSuccess, /paymentStatus\?\.settlement\?\.code === 'EVENT_CLOSED'/);
  assert.match(nativePaymentSuccess, /!paymentClosedWithoutAdmission/);
  assert.match(nativePaymentSuccess, /copy\.showViewEventAction[\s\S]*!eventRowClosed/);
});
