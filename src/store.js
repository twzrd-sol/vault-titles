import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyRecord } from "./asset.js";

function certFolder(certId) {
  if (typeof certId !== "string" || certId.length === 0 || certId.includes("/") || certId.includes("\\") || certId.includes("..")) {
    throw new Error("cert id is required");
  }
  return certId;
}

/** Write front and back bytes under a directory named for the cert id. */
export function saveSlabPhotos(dir, certId, files) {
  const folder = join(dir, certFolder(certId));
  mkdirSync(folder, { recursive: true });
  const front = files?.front;
  const back = files?.back;
  if (!front || !back) throw new Error("front and back photos are required");
  const frontPhoto = join(folder, "front");
  const backPhoto = join(folder, "back");
  writeFileSync(frontPhoto, front);
  writeFileSync(backPhoto, back);
  return { frontPhoto, backPhoto };
}

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      story TEXT NOT NULL,
      custodian_note TEXT NOT NULL,
      archive TEXT NOT NULL,
      cert_id TEXT,
      front_photo TEXT,
      back_photo TEXT
    );
    CREATE TABLE IF NOT EXISTS titles (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      burned INTEGER NOT NULL,
      action TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS redemptions (
      title_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      title_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  return db;
}

/** Replace the stored record with this one. */
export function saveVault(dbPath, state) {
  const db = openDb(dbPath);
  const insertAsset = db.prepare(
    `INSERT INTO assets (id, story, custodian_note, archive, cert_id, front_photo, back_photo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTitle = db.prepare(
    `INSERT INTO titles (id, asset_id, burned, action) VALUES (?, ?, ?, ?)`,
  );
  const insertRedemption = db.prepare(
    `INSERT INTO redemptions (title_id, asset_id, action, status) VALUES (?, ?, ?, ?)`,
  );
  const insertRequest = db.prepare(
    `INSERT INTO requests (title_id, asset_id, action, status) VALUES (?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  db.exec("DELETE FROM requests; DELETE FROM redemptions; DELETE FROM titles; DELETE FROM assets;");
  for (const asset of Object.values(state.assets)) {
    insertAsset.run(
      asset.id,
      asset.story,
      asset.custodianNote,
      asset.archive,
      asset.certId ?? null,
      asset.frontPhoto ?? null,
      asset.backPhoto ?? null,
    );
  }
  for (const title of Object.values(state.titles)) {
    insertTitle.run(title.id, title.assetId, title.burned ? 1 : 0, title.action);
  }
  for (const entry of state.redemptions) {
    insertRedemption.run(entry.titleId, entry.assetId, entry.action, entry.status);
  }
  for (const entry of state.requests) {
    insertRequest.run(entry.titleId, entry.assetId, entry.action, entry.status);
  }
  db.exec("COMMIT");
  db.close();
}

/** Load the record. A missing file still opens as an empty vault. */
export function loadVault(dbPath) {
  const db = openDb(dbPath);
  const record = emptyRecord();
  for (const row of db.prepare("SELECT * FROM assets").all()) {
    const asset = {
      id: row.id,
      story: row.story,
      custodianNote: row.custodian_note,
      archive: row.archive,
    };
    if (row.cert_id != null) asset.certId = row.cert_id;
    if (row.front_photo != null) asset.frontPhoto = row.front_photo;
    if (row.back_photo != null) asset.backPhoto = row.back_photo;
    record.assets[asset.id] = asset;
  }
  for (const row of db.prepare("SELECT * FROM titles").all()) {
    record.titles[row.id] = {
      id: row.id,
      assetId: row.asset_id,
      burned: row.burned === 1,
      action: row.action,
    };
  }
  for (const row of db.prepare("SELECT title_id, asset_id, action, status FROM redemptions").all()) {
    record.redemptions.push({
      titleId: row.title_id,
      assetId: row.asset_id,
      action: row.action,
      status: row.status,
    });
  }
  for (const row of db.prepare("SELECT title_id, asset_id, action, status FROM requests").all()) {
    record.requests.push({
      titleId: row.title_id,
      assetId: row.asset_id,
      action: row.action,
      status: row.status,
    });
  }
  db.close();
  return record;
}
