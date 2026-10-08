import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAsset, emptyRecord, issueTitle, queueRequest } from "../src/asset.js";
import { loadVault, saveSlabPhotos, saveVault } from "../src/store.js";

const slab = {
  id: "slab-1",
  story: "1952 Topps Mickey Mantle, the vaulted slab",
  custodianNote: "Sleeve 14, seal checked on intake.",
  archive: "archive/slab-1",
  certId: "cert-100",
};

test("photo files are stored under the cert id and the saved record reloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-titles-"));
  const photos = saveSlabPhotos(dir, "cert-100", {
    front: Buffer.from("front-bytes"),
    back: Buffer.from("back-bytes"),
  });
  assert.match(photos.frontPhoto, /cert-100/);
  assert.match(photos.backPhoto, /cert-100/);
  assert.equal(readFileSync(photos.frontPhoto).toString(), "front-bytes");
  assert.equal(readFileSync(photos.backPhoto).toString(), "back-bytes");

  const entered = createAsset(emptyRecord(), {
    ...slab,
    frontPhoto: photos.frontPhoto,
    backPhoto: photos.backPhoto,
  });
  assert.equal(entered.assets["slab-1"].certId, "cert-100");
  assert.equal(entered.assets["slab-1"].frontPhoto, photos.frontPhoto);
  assert.equal(entered.assets["slab-1"].backPhoto, photos.backPhoto);

  const queued = queueRequest(issueTitle(entered, "slab-1"), "title:slab-1", "transfer");
  const dbPath = join(dir, "vault.sqlite");
  saveVault(dbPath, queued);
  const loaded = loadVault(dbPath);

  assert.equal(loaded.assets["slab-1"].certId, "cert-100");
  assert.equal(loaded.assets["slab-1"].frontPhoto, photos.frontPhoto);
  assert.equal(loaded.assets["slab-1"].story, slab.story);
  assert.equal(loaded.titles["title:slab-1"].action, "keep");
  assert.equal(loaded.titles["title:slab-1"].burned, false);
  assert.deepEqual(loaded.requests, [
    { titleId: "title:slab-1", assetId: "slab-1", action: "transfer", status: "requested" },
  ]);
  assert.deepEqual(loaded.redemptions, []);
});
