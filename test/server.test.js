import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startVaultServer } from "../src/server.js";

const slab = {
  id: "slab-1",
  story: "1952 Topps Mickey Mantle, the vaulted slab",
  custodianNote: "Sleeve 14, seal checked on intake.",
  archive: "archive/slab-1",
  certId: "cert-100",
  frontBase64: Buffer.from("front-bytes").toString("base64"),
  backBase64: Buffer.from("back-bytes").toString("base64"),
};

test("the page lists a title and only keep writes the holder action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-page-"));
  const server = await startVaultServer({
    dbPath: join(dir, "vault.sqlite"),
    photoDir: join(dir, "photos"),
    host: "127.0.0.1",
    port: 0,
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const created = await fetch(`${base}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slab),
    });
    assert.equal(created.status, 201);
    const issued = await fetch(`${base}/titles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: "slab-1" }),
    });
    assert.equal(issued.status, 201);

    const page = await fetch(`${base}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /1952 Topps Mickey Mantle/);
    assert.match(html, /cert-100/);
    assert.match(html, />Keep</);
    assert.match(html, />Transfer</);
    assert.match(html, />Redeem</);
    assert.match(html, /\/media\/cert-100\/front/);

    const photo = await fetch(`${base}/media/cert-100/front`);
    assert.equal(photo.status, 200);
    assert.equal(await photo.text(), "front-bytes");

    const kept = await fetch(`${base}/titles/${encodeURIComponent("title:slab-1")}/keep`, { method: "POST" });
    assert.equal(kept.status, 200);
    const transfer = await fetch(`${base}/titles/${encodeURIComponent("title:slab-1")}/transfer`, { method: "POST" });
    assert.equal(transfer.status, 202);
    const redeem = await fetch(`${base}/titles/${encodeURIComponent("title:slab-1")}/redeem`, { method: "POST" });
    assert.equal(redeem.status, 202);

    const record = await fetch(`${base}/record`).then((response) => response.json());
    assert.equal(record.titles["title:slab-1"].action, "keep");
    assert.equal(record.titles["title:slab-1"].burned, false);
    assert.deepEqual(record.requests.map((entry) => entry.action), ["transfer", "redeem"]);
    assert.deepEqual(record.redemptions, []);

    const after = await fetch(`${base}/`).then((response) => response.text());
    assert.match(after, /transfer/);
    assert.match(after, /requested/);
  } finally {
    await server.close();
  }
});
