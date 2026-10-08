import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedAccount, runReadOnly } from "../dist/cli.js";

test("account access fails closed without an explicit allowlist", () => {
  assert.equal(isAuthorizedAccount("1", undefined), false);
  assert.equal(isAuthorizedAccount("1", ""), false);
  assert.equal(isAuthorizedAccount("1", "2,3"), false);
  assert.equal(isAuthorizedAccount("1", "1,2"), true);
  assert.equal(isAuthorizedAccount("-1", "1"), false);
});

test("write commands are never allowed", async () => {
  await assert.rejects(() => runReadOnly(["hosts", "restart"], ["1", "2"]), /allowlist/);
});

test("unsafe identifiers are rejected before CLI launch", async () => {
  await assert.rejects(() => runReadOnly(["host-pools", "list"], ["1;rm -rf /"]), /Invalid identifier/);
});
