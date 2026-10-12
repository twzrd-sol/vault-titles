# Vault titles architecture

The record is local. No chain transaction runs, and this repository holds no custody keys.

## Store

`data/vault.sqlite` is created by `npm start`. `src/store.js` replaces the rows on every save.

| Table | Columns |
|---|---|
| assets | id, story, custodian_note, archive, cert_id, front_photo, back_photo |
| titles | id, asset_id, burned, action |
| redemptions | title_id, asset_id, action, status |
| requests | request_id, title_id, asset_id, action, status |

Each transfer or redeem request gets a UUID. When an older vault database is opened, rows without IDs receive stable `legacy-request:<rowid>` IDs in a SQLite transaction. An active request is one with status `requested`; the same title cannot have two active requests for the same action. Cancelling changes that request's status to `cancelled`, leaving the title on keep and unburned. A cancelled request remains in the record, and a new request of that action can be created.

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
| POST | `/requests/:requestId/cancel` | Cancels an active request by its request ID; keeps the title unchanged |

## Page

Enter a slab, then issue its title. Keep writes the title. Transfer and redeem ask for confirmation, then show `Pending transfer` or `Pending redeem`. The request list displays each request ID's action and status; active requests have a Cancel button, and cancelled requests remain visible. Refresh calls `GET /api/vault` and reloads the page from SQLite.
