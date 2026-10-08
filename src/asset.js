/** Holder actions live in the model. v0 does not perform them on chain. */
export const holderActions = Object.freeze(["keep", "transfer", "redeem"]);

export function emptyRecord() {
  return { assets: {}, titles: {}, redemptions: [], requests: [] };
}

/** Title id is a pure function of the asset id. */
export function titleIdFor(assetId) {
  if (typeof assetId !== "string" || assetId.length === 0) {
    throw new Error("asset id is required");
  }
  return `title:${assetId}`;
}

function copyRecord(state) {
  if (
    !state ||
    typeof state.assets !== "object" ||
    state.assets === null ||
    typeof state.titles !== "object" ||
    state.titles === null ||
    !Array.isArray(state.redemptions) ||
    !Array.isArray(state.requests)
  ) {
    throw new Error("record state is required");
  }
  return {
    assets: Object.fromEntries(
      Object.entries(state.assets).map(([id, asset]) => [id, { ...asset }]),
    ),
    titles: Object.fromEntries(
      Object.entries(state.titles).map(([id, title]) => [id, { ...title }]),
    ),
    redemptions: state.redemptions.map((entry) => ({ ...entry })),
    requests: state.requests.map((entry) => ({ ...entry })),
  };
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

/**
 * Enter a record: a named asset story, a custodian note, and an archive.
 * Entering the record does not issue a title.
 */
export function createAsset(state, input) {
  const next = copyRecord(state);
  const source = input ?? {};
  const id = requireText(source.id, "asset id");
  const story = requireText(source.story, "named asset story");
  const custodianNote = requireText(source.custodianNote, "custodian note");
  const archive = requireText(source.archive, "archive");
  if (next.assets[id]) {
    throw new Error("asset is already recorded");
  }
  const asset = { id, story, custodianNote, archive };
  if (source.certId != null) asset.certId = requireText(source.certId, "cert id");
  if (source.frontPhoto != null) asset.frontPhoto = requireText(source.frontPhoto, "front photo");
  if (source.backPhoto != null) asset.backPhoto = requireText(source.backPhoto, "back photo");
  next.assets[id] = asset;
  return next;
}

function titleForAsset(state, assetId) {
  const expected = titleIdFor(assetId);
  if (state.titles[expected]) return state.titles[expected];
  return Object.values(state.titles).find((title) => title.assetId === assetId);
}

/**
 * Issue the single title for a recorded asset.
 * A second call for the same asset throws.
 */
export function issueTitle(state, assetId) {
  const next = copyRecord(state);
  if (!next.assets[assetId]) {
    throw new Error("asset is not recorded");
  }
  if (titleForAsset(next, assetId)) {
    throw new Error("a title already exists for this asset");
  }
  const id = titleIdFor(assetId);
  next.titles[id] = {
    id,
    assetId,
    burned: false,
    action: "keep",
  };
  return next;
}

/**
 * Record a redemption request and burn the title.
 * Does not create another asset.
 */
export function requestRedeem(state, titleId) {
  const next = copyRecord(state);
  const title = next.titles[titleId];
  if (!title) {
    throw new Error("title not found");
  }
  if (title.burned) {
    throw new Error("title is already burned");
  }
  const assetIds = Object.keys(next.assets);
  next.titles[titleId] = { ...title, burned: true, action: "redeem" };
  next.redemptions.push({
    titleId,
    assetId: title.assetId,
    action: "redeem",
    status: "requested",
  });
  if (Object.keys(next.assets).join("\0") !== assetIds.join("\0")) {
    throw new Error("redeem must not create an asset");
  }
  return next;
}

/** Set the holder action to keep. This is the only holder button that writes the title. */
export function keepTitle(state, titleId) {
  const next = copyRecord(state);
  const title = next.titles[titleId];
  if (!title) {
    throw new Error("title not found");
  }
  if (title.burned) {
    throw new Error("title is already burned");
  }
  next.titles[titleId] = { ...title, action: "keep", burned: false };
  return next;
}

/**
 * Queue a transfer or redeem request.
 * The title stays on keep and is not burned.
 */
export function queueRequest(state, titleId, action) {
  const next = copyRecord(state);
  const title = next.titles[titleId];
  if (!title) {
    throw new Error("title not found");
  }
  if (action !== "transfer" && action !== "redeem") {
    throw new Error("queued request must be transfer or redeem");
  }
  if (title.burned) {
    throw new Error("title is already burned");
  }
  next.requests.push({
    titleId,
    assetId: title.assetId,
    action,
    status: "requested",
  });
  return next;
}
