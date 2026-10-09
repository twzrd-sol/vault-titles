# Vault titles architecture

The record is local. No chain transaction runs, and this repository holds no custody keys.

## Store

`data/vault.sqlite` is created by `npm start`. `src/store.js` replaces the rows on every save.

| Table | Columns |
|---|---|
| assets | id, story, custodian_note, archive, cert_id, front_photo, back_photo |
| titles | id, asset_id, burned, action |
| redemptions | title_id, asset_id, action, status |
| requests | title_id, asset_id, action, status |

Photo bytes are files, not blobs: `data/photos/<cert-id>/front` and `back`. The asset row stores those paths.

## HTTP

The process listens on `HOST` or `127.0.0.1`, port `PORT` or `4177`.

| Method | Path | Effect |
|---|---|---|
| GET | `/` | HTML from the current SQLite record |
| GET | `/api/vault` | `{ slabs: [...] }` with each asset, its title, and its requests |
| GET | `/record` | The raw record |
| GET | `/media/:certId/front` or `back` | The stored photo, only if the path stays under the photo directory |
| POST | `/assets` | JSON body with story, custodian note, archive, cert id, and base64 front and back photos |
| POST | `/titles` | `{ assetId }` issues the one title |
| POST | `/titles/:id/keep` | Sets the holder action to keep |
| POST | `/titles/:id/transfer` | Queues a request. The title stays on keep and is not burned |
| POST | `/titles/:id/redeem` | Queues a request the same way |

## Page

Enter a slab, then issue its title. Keep writes the title. Transfer and redeem ask for confirmation, then show `Pending transfer` or `Pending redeem`. Refresh calls `GET /api/vault` and reloads the page from SQLite.
