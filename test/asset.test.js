import assert from "node:assert/strict";
import test from "node:test";
import {
  createAsset,
  emptyRecord,
  holderActions,
  issueTitle,
  requestRedeem,
} from "../src/asset.js";

const slab = {
  id: "slab-1",
  story: "1952 Topps Mickey Mantle, the vaulted slab",
  custodianNote: "Sleeve 14, seal checked on intake.",
  archive: "archive/slab-1",
};

test("holder actions in the model are keep, transfer, and redeem", () => {
  assert.deepEqual(holderActions, ["keep", "transfer", "redeem"]);
});

test("entering a record stores the story, custodian note, and archive and does not issue a title", () => {
  const entered = createAsset(emptyRecord(), slab);
  assert.deepEqual(entered.assets["slab-1"], slab);
  assert.deepEqual(entered.titles, {});
  assert.deepEqual(entered.redemptions, []);
});

test("issueTitle id is deterministic from the asset id and a second issue throws", () => {
  const entered = createAsset(emptyRecord(), slab);
  const issued = issueTitle(entered, "slab-1");
  const again = issueTitle(createAsset(emptyRecord(), slab), "slab-1");

  assert.deepEqual(issued.titles["title:slab-1"], {
    id: "title:slab-1",
    assetId: "slab-1",
    burned: false,
    action: "keep",
  });
  assert.equal(Object.keys(again.titles)[0], "title:slab-1");
  assert.throws(
    () => issueTitle(issued, "slab-1"),
    /a title already exists for this asset/,
  );
});

test("requestRedeem burns the title, records the request, and does not create a second asset", () => {
  const issued = issueTitle(createAsset(emptyRecord(), slab), "slab-1");
  const assetsBefore = structuredClone(issued.assets);
  const redeemed = requestRedeem(issued, "title:slab-1");

  assert.equal(redeemed.titles["title:slab-1"].burned, true);
  assert.equal(redeemed.titles["title:slab-1"].action, "redeem");
  assert.deepEqual(redeemed.assets, assetsBefore);
  assert.equal(Object.keys(redeemed.assets).length, 1);
  assert.deepEqual(redeemed.redemptions, [
    {
      titleId: "title:slab-1",
      assetId: "slab-1",
      action: "redeem",
      status: "requested",
    },
  ]);
  assert.throws(
    () => issueTitle(redeemed, "slab-1"),
    /a title already exists for this asset/,
  );
  assert.throws(
    () => requestRedeem(redeemed, "title:slab-1"),
    /title is already burned/,
  );
});

test("createAsset, issueTitle, and requestRedeem leave the prior record unchanged", () => {
  const blank = emptyRecord();
  const entered = createAsset(blank, slab);
  const issued = issueTitle(entered, "slab-1");
  requestRedeem(issued, "title:slab-1");

  assert.deepEqual(blank, emptyRecord());
  assert.deepEqual(entered.titles, {});
  assert.equal(issued.titles["title:slab-1"].burned, false);
  assert.deepEqual(issued.redemptions, []);
});
