# vault-titles

A person enters one recorded real-world asset, and that asset can carry exactly one title.

Radiolab is the way into the record: a named asset story, a custodian note, and an archive. Entering the record stores those three and issues nothing.

Collector Crypt, Solflare Packs, and Jupiter Gacha are the title shape: one token is the title to one vaulted slab. Here the title is 1:1 with one recorded asset. The holder can keep it, transfer the title, or redeem it by burning the title and requesting shipment. This version has no pack opening, odds, buyback, or platform token, and no yield, APY, staking, or gambling loop.

v0 is the record itself: `createAsset`, `issueTitle`, and `requestRedeem`. The title id is deterministic from the asset id. A second title for the same asset throws. Redemption marks that title burned and stores a shipment request. No chain transaction runs tonight, and the repository holds no custody keys.

After launch, resume on-chain issuance of the same 1:1 title, transfer of a live title, and fulfillment of a recorded redemption shipment.

## Local vault

The record is a SQLite file in `data/vault.sqlite`. Front and back photos are files under `data/photos/<cert-id>/`. Keep writes the holder action. Transfer and redeem are stored as requests, shown as Pending transfer and Pending redeem, and do not burn the title. `GET /api/vault` returns the slab list. Refresh re-reads that list. Schema and routes: `docs/architecture.md`.

```bash
npm test
npm start
HOST=100.111.36.55 npm start
```

`npm start` listens on `127.0.0.1:4177`. `HOST` changes the bind address, so the same port is reachable on the tailnet.
