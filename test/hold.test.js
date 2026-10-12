import assert from "node:assert/strict";
import test from "node:test";
import { cancelRequest, createAsset, emptyRecord, issueTitle, keepTitle, queueRequest } from "../src/asset.js";

const slab = {
  id: "slab-1",
  story: "1952 Topps Mickey Mantle, the vaulted slab",
  custodianNote: "Sleeve 14, seal checked on intake.",
  archive: "archive/slab-1",
};

function issued() {
  return issueTitle(createAsset(emptyRecord(), slab), "slab-1");
}

test("keep sets the holder action and leaves the title unburned", () => {
  const kept = keepTitle(issued(), "title:slab-1");
  assert.equal(kept.titles["title:slab-1"].action, "keep");
  assert.equal(kept.titles["title:slab-1"].burned, false);
  assert.deepEqual(kept.requests, []);
});

test("transfer and redeem queue requests and leave the title on keep", () => {
  const prior = issued();
  const transferred = queueRequest(prior, "title:slab-1", "transfer");
  const redeemed = queueRequest(transferred, "title:slab-1", "redeem");

  assert.equal(redeemed.titles["title:slab-1"].action, "keep");
  assert.equal(redeemed.titles["title:slab-1"].burned, false);
  assert.deepEqual(redeemed.redemptions, []);
  assert.deepEqual(redeemed.requests, [
    { id: transferred.requests[0].id, titleId: "title:slab-1", assetId: "slab-1", action: "transfer", status: "requested" },
    { id: redeemed.requests[1].id, titleId: "title:slab-1", assetId: "slab-1", action: "redeem", status: "requested" },
  ]);
  assert.match(redeemed.requests[0].id, /^[0-9a-f-]{36}$/);
  assert.notEqual(redeemed.requests[0].id, redeemed.requests[1].id);
  assert.deepEqual(prior.requests, []);
  assert.equal(prior.titles["title:slab-1"].burned, false);
});

test("a queued request cannot be keep, and a missing title cannot be queued", () => {
  const prior = issued();
  assert.throws(() => queueRequest(prior, "title:slab-1", "keep"), /queued request/);
  assert.throws(() => queueRequest(prior, "title:missing", "transfer"), /title not found/);
});

test("active requests deduplicate by title and action, and cancelled requests can be retried", () => {
  const first = queueRequest(issued(), "title:slab-1", "transfer");
  assert.throws(() => queueRequest(first, "title:slab-1", "transfer"), /active transfer request already exists/);
  const cancelled = cancelRequest(first, first.requests[0].id);
  assert.equal(cancelled.requests[0].status, "cancelled");
  assert.equal(cancelled.titles["title:slab-1"].action, "keep");
  assert.equal(cancelled.titles["title:slab-1"].burned, false);
  assert.deepEqual(first.requests[0].status, "requested");
  assert.throws(() => cancelRequest(cancelled, first.requests[0].id), /request is not active/);
  assert.deepEqual(cancelled.requests[0].status, "cancelled");
  assert.throws(() => cancelRequest(cancelled, "missing-request"), /request not found/);
  const retried = queueRequest(cancelled, "title:slab-1", "transfer");
  assert.notEqual(retried.requests[1].id, first.requests[0].id);
  assert.equal(retried.requests[1].status, "requested");
});
