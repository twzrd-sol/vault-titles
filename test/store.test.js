import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    { id: queued.requests[0].id, titleId: "title:slab-1", assetId: "slab-1", action: "transfer", status: "requested" },
  ]);
  assert.deepEqual(loaded.redemptions, []);

  const duplicateCert = structuredClone(loaded);
  duplicateCert.assets["slab-2"] = { ...duplicateCert.assets["slab-1"], id: "slab-2" };
  assert.throws(() => saveVault(dbPath, duplicateCert), /cert id is already recorded/);
  assert.deepEqual(loadVault(dbPath), loaded);

  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TRIGGER reject_slab_2 BEFORE INSERT ON assets WHEN NEW.id = 'slab-2'
    BEGIN SELECT RAISE(ABORT, 'forced persistence failure'); END`);
  db.close();
  const rejectedState = structuredClone(loaded);
  rejectedState.assets["slab-2"] = { ...rejectedState.assets["slab-1"], id: "slab-2", certId: "cert-200" };
  assert.throws(() => saveVault(dbPath, rejectedState), /forced persistence failure/);
  assert.deepEqual(loadVault(dbPath), loaded);
  const triggerDb = new DatabaseSync(dbPath);
  triggerDb.exec("DROP TRIGGER reject_slab_2");
  triggerDb.close();
  saveVault(dbPath, loaded);
  assert.deepEqual(loadVault(dbPath), loaded);
});

test("photo validation and an existing cert directory preserve current bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-photo-preserve-"));
  const original = {
    front: Buffer.from("original-front"),
    back: Buffer.from("original-back"),
  };
  const photos = saveSlabPhotos(dir, "cert-100", original);
  assert.throws(() => saveSlabPhotos(dir, "cert-new", { front: Buffer.alloc(0), back: Buffer.from("back") }), /front and back photos are required/);
  assert.throws(() => saveSlabPhotos(dir, "cert-new", { front: Buffer.from("front") }), /front and back photos are required/);
  assert.throws(() => saveSlabPhotos(dir, "cert-100", { front: Buffer.from("replacement-front"), back: Buffer.from("replacement-back") }));
  assert.equal(readFileSync(photos.frontPhoto).toString(), "original-front");
  assert.equal(readFileSync(photos.backPhoto).toString(), "original-back");
});

test("request IDs are added to existing local request rows and survive a save", () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-legacy-requests-"));
  const dbPath = join(dir, "vault.sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE requests (title_id TEXT NOT NULL, asset_id TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL);
    INSERT INTO requests VALUES ('title:slab-1', 'slab-1', 'transfer', 'requested');
  `);
  legacy.close();

  const loaded = loadVault(dbPath);
  assert.equal(loaded.requests.length, 1);
  assert.equal(loaded.requests[0].id, "legacy-request:1");
  saveVault(dbPath, loaded);
  assert.deepEqual(loadVault(dbPath).requests, loaded.requests);
});

test("empty and nonempty destination directories are never replaced", () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-existing-destinations-"));
  const empty = join(dir, "cert-empty");
  const nonempty = join(dir, "cert-nonempty");
  mkdirSync(empty);
  mkdirSync(nonempty);
  writeFileSync(join(nonempty, "original"), "keep me");

  const files = { front: Buffer.from("front"), back: Buffer.from("back") };
  assert.throws(() => saveSlabPhotos(dir, "cert-empty", files), /EEXIST/);
  assert.throws(() => saveSlabPhotos(dir, "cert-nonempty", files), /EEXIST/);
  assert.deepEqual(readdirSync(empty), []);
  assert.deepEqual(readdirSync(nonempty), ["original"]);
  assert.equal(readFileSync(join(nonempty, "original")).toString(), "keep me");
});

test("a photo write failure removes only files and directory owned by that write", () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-photo-write-failure-"));
  const existing = join(dir, "cert-existing");
  mkdirSync(existing);
  writeFileSync(join(existing, "original"), "keep me");
  let writes = 0;
  const writePhoto = (fd, bytes) => {
    writes += 1;
    if (writes === 2) throw new Error("forced photo write failure");
    writeFileSync(fd, bytes);
  };

  assert.throws(
    () => saveSlabPhotos(dir, "cert-new", { front: Buffer.from("front"), back: Buffer.from("back") }, { writePhoto }),
    /forced photo write failure/,
  );
  assert.equal(existsSync(join(dir, "cert-new")), false);
  assert.deepEqual(readdirSync(existing), ["original"]);
  assert.equal(readFileSync(join(existing, "original")).toString(), "keep me");
});
