import assert from "node:assert/strict";
import test from "node:test";

import { postgrestQuotedInList } from "./postgrestFilters";

test("formats escaped quoted lists for PostgREST in filters", () => {
  assert.equal(
    postgrestQuotedInList(["client-1", 'quote"slash\\id']),
    '("client-1","quote\\"slash\\\\id")',
  );
});
