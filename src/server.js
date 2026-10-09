import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAsset, issueTitle, keepTitle, queueRequest } from "./asset.js";
import { loadVault, saveSlabPhotos, saveVault } from "./store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readBody(req, limit = 12_000_000) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pendingLabel(action) {
  if (action === "transfer") return "Pending transfer";
  if (action === "redeem") return "Pending redeem";
  return "";
}

function slabsFrom(record) {
  return Object.values(record.assets).map((asset) => ({
    ...asset,
    title: record.titles[`title:${asset.id}`] ?? null,
    requests: record.requests.filter((entry) => entry.assetId === asset.id),
  }));
}

function renderPage(record) {
  const titles = Object.values(record.titles);
  const untitled = Object.values(record.assets).filter((asset) => !record.titles[`title:${asset.id}`]);
  const titleCards = titles.map((title) => {
    const asset = record.assets[title.assetId];
    const encoded = encodeURIComponent(title.id);
    const photos = asset?.certId
      ? `<div class="photos"><img src="/media/${escapeHtml(asset.certId)}/front" alt="Front"><img src="/media/${escapeHtml(asset.certId)}/back" alt="Back"></div>`
      : "";
    const badges = record.requests
      .filter((entry) => entry.titleId === title.id && entry.status === "requested")
      .map((entry) => `<span class="badge">${escapeHtml(pendingLabel(entry.action))}</span>`)
      .join("");
    return `<article class="slab">
      ${photos}
      <div>
        <p class="cert">${escapeHtml(asset?.certId ?? "")}</p>
        <h2>${escapeHtml(asset?.story ?? title.assetId)}</h2>
        <p>${escapeHtml(asset?.custodianNote ?? "")}</p>
        <p class="held">Holder action: ${escapeHtml(title.action)}${title.burned ? " · burned" : ""}</p>
        <p class="badges">${badges}</p>
        <div class="actions">
          <button class="keep" data-path="/titles/${encoded}/keep">Keep</button>
          <button class="request" data-path="/titles/${encoded}/transfer">Transfer</button>
          <button class="request" data-path="/titles/${encoded}/redeem">Redeem</button>
        </div>
      </div>
    </article>`;
  }).join("");
  const waiting = untitled.map((asset) => `<p><button class="keep" data-issue="${escapeHtml(asset.id)}">Issue title</button> ${escapeHtml(asset.story)}</p>`).join("");
  const queued = record.requests.map((entry) => `<li>${escapeHtml(entry.action)} ${escapeHtml(entry.status)} · ${escapeHtml(entry.titleId)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Vault titles</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #241c16; color: #241c16; font-family: Palatino, "Palatino Linotype", "Iowan Old Style", serif; }
    main { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
    h1, .lede { color: #f3eadf; font-weight: 500; }
    h1 { letter-spacing: 0.08em; text-transform: uppercase; font-size: 1.1rem; }
    .panel, .slab { background: #f6f1e8; padding: 20px; margin: 16px 0; }
    .slab { display: grid; grid-template-columns: 180px 1fr; gap: 18px; }
    .photos { display: grid; gap: 8px; }
    img { width: 100%; background: #d9d0c3; min-height: 80px; object-fit: cover; }
    label { display: block; margin: 10px 0 4px; font-size: 0.85rem; }
    input, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 8px; background: #fffdf8; border: 1px solid #cfc4b4; }
    .cert, .held, .queue { font-family: ui-monospace, monospace; font-size: 0.78rem; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    button { font: inherit; padding: 8px 14px; cursor: pointer; }
    button.keep { background: #241c16; color: #f6f1e8; border: 0; }
    button.request { background: transparent; border: 1px solid #241c16; }
    .badge { display: inline-block; margin: 0 8px 0 0; padding: 2px 8px; border: 1px solid #8a5a2a; color: #8a5a2a; font-family: ui-monospace, monospace; font-size: 0.75rem; }
    @media (max-width: 640px) { .slab { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Vault titles</h1>
    <p class="lede">One recorded slab. One title. Keep writes the holder action. Transfer and redeem stay requested.</p>
    <p><button id="refresh" type="button">Refresh</button></p>
    <section class="panel">
      <h2>Enter a slab</h2>
      <form id="enter">
        <label>Asset id <input name="id" required></label>
        <label>Story <textarea name="story" required></textarea></label>
        <label>Custodian note <textarea name="custodianNote" required></textarea></label>
        <label>Archive <input name="archive" required></label>
        <label>Cert id <input name="certId" required></label>
        <label>Front <input name="front" type="file" accept="image/*" required></label>
        <label>Back <input name="back" type="file" accept="image/*" required></label>
        <p class="error" id="enter-error"></p>
        <button class="keep" type="submit">Record slab</button>
      </form>
      ${waiting}
    </section>
    <section>${titleCards || "<p class=\"lede\">No titles yet.</p>"}</section>
    <section class="panel">
      <h2>Requests</h2>
      <ul class="queue">${queued || "<li>none</li>"}</ul>
    </section>
  </main>
  <script>
    async function fileField(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    document.getElementById("enter").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      const body = {
        id: data.id, story: data.story, custodianNote: data.custodianNote,
        archive: data.archive, certId: data.certId,
        frontBase64: await fileField(data.front), backBase64: await fileField(data.back),
      };
      const response = await fetch("/assets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        document.getElementById("enter-error").textContent = await response.text();
        return;
      }
      location.reload();
    });
    for (const button of document.querySelectorAll("button[data-issue]")) {
      button.addEventListener("click", async () => {
        const response = await fetch("/titles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: button.dataset.issue }) });
        if (!response.ok) return;
        location.reload();
      });
    }
    document.getElementById("refresh").addEventListener("click", async () => {
      const response = await fetch("/api/vault");
      if (!response.ok) return;
      location.reload();
    });
    for (const button of document.querySelectorAll("button[data-path]")) {
      button.addEventListener("click", async () => {
        if (button.dataset.path.endsWith("/transfer") && !confirm("Queue a transfer request?")) return;
        if (button.dataset.path.endsWith("/redeem") && !confirm("Queue a redeem request?")) return;
        const response = await fetch(button.dataset.path, { method: "POST" });
        if (!response.ok) return;
        location.reload();
      });
    }
  </script>
</body>
</html>`;
}

function contentType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return "application/octet-stream";
}

async function handle(req, res, options) {
  const url = new URL(req.url, "http://127.0.0.1");
  const record = () => loadVault(options.dbPath);
  const persist = (next) => saveVault(options.dbPath, next);

  if (req.method === "GET" && url.pathname === "/") {
    send(res, 200, renderPage(record()), "text/html; charset=utf-8");
    return;
  }
  if (req.method === "GET" && (url.pathname === "/record" || url.pathname === "/api/vault")) {
    const body = url.pathname === "/api/vault" ? { slabs: slabsFrom(record()) } : record();
    send(res, 200, JSON.stringify(body), "application/json");
    return;
  }
  const media = url.pathname.match(/^\/media\/([^/]+)\/(front|back)$/);
  if (req.method === "GET" && media) {
    const certId = decodeURIComponent(media[1]);
    const side = media[2];
    const asset = Object.values(record().assets).find((row) => row.certId === certId);
    const photoPath = side === "front" ? asset?.frontPhoto : asset?.backPhoto;
    const root = resolve(options.photoDir);
    if (!photoPath || !resolve(photoPath).startsWith(root)) {
      send(res, 404, "photo not found", "text/plain; charset=utf-8");
      return;
    }
    const bytes = readFileSync(photoPath);
    send(res, 200, bytes, contentType(bytes));
    return;
  }
  if (req.method === "POST" && url.pathname === "/assets") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const photos = saveSlabPhotos(options.photoDir, body.certId, {
      front: Buffer.from(body.frontBase64 ?? "", "base64"),
      back: Buffer.from(body.backBase64 ?? "", "base64"),
    });
    persist(createAsset(record(), { ...body, ...photos }));
    send(res, 201, "recorded", "text/plain; charset=utf-8");
    return;
  }
  if (req.method === "POST" && url.pathname === "/titles") {
    const raw = await readBody(req);
    const type = req.headers["content-type"] ?? "";
    const assetId = type.includes("application/json")
      ? JSON.parse(raw.toString() || "{}").assetId
      : new URLSearchParams(raw.toString()).get("assetId");
    persist(issueTitle(record(), assetId));
    send(res, 201, "issued", "text/plain; charset=utf-8");
    return;
  }
  const action = url.pathname.match(/^\/titles\/([^/]+)\/(keep|transfer|redeem)$/);
  if (req.method === "POST" && action) {
    const titleId = decodeURIComponent(action[1]);
    if (action[2] === "keep") {
      persist(keepTitle(record(), titleId));
      send(res, 200, "kept", "text/plain; charset=utf-8");
      return;
    }
    persist(queueRequest(record(), titleId, action[2]));
    send(res, 202, "requested", "text/plain; charset=utf-8");
    return;
  }
  send(res, 404, "not found", "text/plain; charset=utf-8");
}

export function startVaultServer({ dbPath, photoDir, host = "127.0.0.1", port = 0 }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  mkdirSync(photoDir, { recursive: true });
  const server = createServer((req, res) => {
    handle(req, res, { dbPath, photoDir }).catch((error) => {
      if (!res.headersSent) send(res, 400, error.message, "text/plain; charset=utf-8");
    });
  });
  return new Promise((resolveReady) => {
    server.listen(port, host, () => {
      resolveReady({
        port: server.address().port,
        close() {
          return new Promise((done) => server.close(done));
        },
      });
    });
  });
}

const launchedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (launchedDirectly) {
  const data = join(root, "data");
  startVaultServer({
    dbPath: join(data, "vault.sqlite"),
    photoDir: join(data, "photos"),
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 4177),
  }).then(({ port }) => {
    console.log(`vault-titles http://${process.env.HOST ?? "127.0.0.1"}:${port}`);
  });
}
