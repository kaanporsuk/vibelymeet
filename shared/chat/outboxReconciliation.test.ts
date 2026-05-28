import assert from "node:assert/strict";
import test from "node:test";

import {
  isRawMessageDisplayReadyForOutboxCompletion,
  shouldPruneOutboxItemAfterServerReconcile,
} from "./outboxReconciliation";

test("prunes an outbox row when its server message id is hydrated", () => {
  assert.equal(
    shouldPruneOutboxItemAfterServerReconcile(
      { id: "client-1", serverMessageId: "message-1" },
      {
        serverMessageIds: new Set(["message-1"]),
        completedClientRequestIds: new Set(),
      },
    ),
    true,
  );
});

test("prunes an outbox row when its client request id is completed by a server row", () => {
  assert.equal(
    shouldPruneOutboxItemAfterServerReconcile(
      { id: "voice-client-1" },
      {
        serverMessageIds: new Set(),
        completedClientRequestIds: new Set(["voice-client-1"]),
      },
    ),
    true,
  );
});

test("keeps an outbox row when a matching server image is not display ready yet", () => {
  assert.equal(
    shouldPruneOutboxItemAfterServerReconcile(
      { id: "photo-client-1", serverMessageId: "message-1", payload: { kind: "image" } },
      {
        serverMessageIds: new Set(["message-1"]),
        completedClientRequestIds: new Set(),
      },
    ),
    false,
  );
});

test("prunes an image outbox row once the server image is display ready", () => {
  assert.equal(
    shouldPruneOutboxItemAfterServerReconcile(
      { id: "photo-client-1", serverMessageId: "message-1", payload: { kind: "image" } },
      {
        serverMessageIds: new Set(["message-1"]),
        completedClientRequestIds: new Set(["photo-client-1"]),
      },
    ),
    true,
  );
});

test("raw message display readiness waits for renderable chat image urls", () => {
  assert.equal(
    isRawMessageDisplayReadyForOutboxCompletion({
      content: "",
      structured_payload: {
        v: 2,
        kind: "chat_image",
        provider: "bunny_storage",
        media_ref: "photos/private/photo.webp",
      },
    }),
    false,
  );

  assert.equal(
    isRawMessageDisplayReadyForOutboxCompletion({
      content: "__IMAGE__|https://cdn.example.com/photo.webp",
      structured_payload: null,
    }),
    true,
  );
});

test("raw non-image messages are display ready for outbox completion", () => {
  assert.equal(
    isRawMessageDisplayReadyForOutboxCompletion({
      content: "hello",
      structured_payload: null,
    }),
    true,
  );
});
