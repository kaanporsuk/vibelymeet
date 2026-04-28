import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_ROOM_ACTIONS,
  classifyDailyRoomInvokeFailure,
  isRetryableDailyRoomFailure,
} from "./dailyRoomFailure";

test("classifies Daily auth failures as non-retryable provider auth failures", async () => {
  const failure = await classifyDailyRoomInvokeFailure({
    action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
    data: { code: "DAILY_AUTH_FAILED" },
    response: new Response(JSON.stringify({ code: "DAILY_AUTH_FAILED" }), { status: 502 }),
  });

  assert.equal(failure.kind, "DAILY_AUTH_FAILED");
  assert.equal(failure.serverCode, "DAILY_AUTH_FAILED");
  assert.equal(failure.httpStatus, 502);
  assert.equal(failure.retryable, false);
});

test("classifies Daily rate limits as retryable", async () => {
  const failure = await classifyDailyRoomInvokeFailure({
    action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
    data: { code: "DAILY_RATE_LIMIT" },
    response: new Response(JSON.stringify({ code: "DAILY_RATE_LIMIT" }), { status: 503 }),
  });

  assert.equal(failure.kind, "DAILY_RATE_LIMIT");
  assert.equal(failure.retryable, true);
  assert.equal(isRetryableDailyRoomFailure("DAILY_RATE_LIMIT"), true);
});

test("classifies Daily provider unavailable responses as retryable", async () => {
  const failure = await classifyDailyRoomInvokeFailure({
    action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
    data: { code: "DAILY_PROVIDER_UNAVAILABLE" },
    response: new Response(JSON.stringify({ code: "DAILY_PROVIDER_UNAVAILABLE" }), { status: 503 }),
  });

  assert.equal(failure.kind, "DAILY_PROVIDER_UNAVAILABLE");
  assert.equal(failure.retryable, true);
  assert.equal(isRetryableDailyRoomFailure("DAILY_PROVIDER_UNAVAILABLE"), true);
});

test("classifies provider rejected Daily requests as non-retryable", async () => {
  const failure = await classifyDailyRoomInvokeFailure({
    action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
    data: { code: "DAILY_REQUEST_REJECTED" },
    response: new Response(JSON.stringify({ code: "DAILY_REQUEST_REJECTED" }), { status: 502 }),
  });

  assert.equal(failure.kind, "DAILY_REQUEST_REJECTED");
  assert.equal(failure.retryable, false);
});

test("classifies provider-atomic persistence failures as retryable", async () => {
  const roomPersist = await classifyDailyRoomInvokeFailure({
    action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
    data: { code: "DB_ROOM_PERSIST_FAILED" },
    response: new Response(JSON.stringify({ code: "DB_ROOM_PERSIST_FAILED" }), { status: 503 }),
  });
  assert.equal(roomPersist.kind, "DB_ROOM_PERSIST_FAILED");
  assert.equal(roomPersist.retryable, true);

  const registrationPersist = await classifyDailyRoomInvokeFailure({
    action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
    data: { code: "REGISTRATION_PERSIST_FAILED" },
    response: new Response(JSON.stringify({ code: "REGISTRATION_PERSIST_FAILED" }), { status: 503 }),
  });
  assert.equal(registrationPersist.kind, "REGISTRATION_PERSIST_FAILED");
  assert.equal(registrationPersist.retryable, true);
});
