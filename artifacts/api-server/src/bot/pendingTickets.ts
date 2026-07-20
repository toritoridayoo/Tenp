/**
 * In-memory store for pending ticket data.
 * Entries expire after 10 minutes.
 */

const EXPIRY_MS = 10 * 60 * 1000;

// ── Rank pending ──────────────────────────────────────────────────────────

interface RankPendingData {
  mcid: string;
  purchaseId: string;
  expiresAt: number;
}
const rankPending = new Map<string, RankPendingData>();

export function setRankPending(userId: string, data: Pick<RankPendingData, "mcid" | "purchaseId">) {
  rankPending.set(userId, { ...data, expiresAt: Date.now() + EXPIRY_MS });
}
export function getRankPending(userId: string): Pick<RankPendingData, "mcid" | "purchaseId"> | null {
  const d = rankPending.get(userId);
  if (!d || d.expiresAt < Date.now()) { rankPending.delete(userId); return null; }
  return { mcid: d.mcid, purchaseId: d.purchaseId };
}
export function clearRankPending(userId: string) { rankPending.delete(userId); }

// ── Key pending ───────────────────────────────────────────────────────────

export interface KeyItem {
  purchaseId: string;
  keyType: string;
  quantity: number;
}

interface KeyPendingData {
  mcid: string;
  items: KeyItem[];
  currentPurchaseId?: string;
  keyType?: string;
  expiresAt: number;
}
const keyPending = new Map<string, KeyPendingData>();

export function setKeyPending(userId: string, mcid: string, firstPurchaseId: string) {
  keyPending.set(userId, {
    mcid,
    items: [],
    currentPurchaseId: firstPurchaseId,
    expiresAt: Date.now() + EXPIRY_MS,
  });
}
export function setKeyCurrentPurchaseId(userId: string, purchaseId: string) {
  const d = keyPending.get(userId);
  if (d) d.currentPurchaseId = purchaseId;
}
export function setKeyType(userId: string, keyType: string) {
  const d = keyPending.get(userId);
  if (d) d.keyType = keyType;
}
/** Push the current in-progress item into items[]. Returns false if data is incomplete. */
export function pushKeyItem(userId: string, quantity: number): boolean {
  const d = keyPending.get(userId);
  if (!d || !d.currentPurchaseId || !d.keyType) return false;
  d.items.push({ purchaseId: d.currentPurchaseId, keyType: d.keyType, quantity });
  d.currentPurchaseId = undefined;
  d.keyType = undefined;
  return true;
}
export function getKeyPending(userId: string): Omit<KeyPendingData, "expiresAt"> | null {
  const d = keyPending.get(userId);
  if (!d || d.expiresAt < Date.now()) { keyPending.delete(userId); return null; }
  return { mcid: d.mcid, items: d.items, currentPurchaseId: d.currentPurchaseId, keyType: d.keyType };
}
export function clearKeyPending(userId: string) { keyPending.delete(userId); }

// ── Media pending ─────────────────────────────────────────────────────────

interface MediaPendingData {
  mcid: string;
  youtubeUrl: string;
  expiresAt: number;
}
const mediaPending = new Map<string, MediaPendingData>();

export function setMediaPending(userId: string, data: Pick<MediaPendingData, "mcid" | "youtubeUrl">) {
  mediaPending.set(userId, { ...data, expiresAt: Date.now() + EXPIRY_MS });
}
export function getMediaPending(userId: string): Pick<MediaPendingData, "mcid" | "youtubeUrl"> | null {
  const d = mediaPending.get(userId);
  if (!d || d.expiresAt < Date.now()) { mediaPending.delete(userId); return null; }
  return { mcid: d.mcid, youtubeUrl: d.youtubeUrl };
}
export function clearMediaPending(userId: string) { mediaPending.delete(userId); }

// ── Cleanup ───────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [id, d] of rankPending) if (d.expiresAt < now) rankPending.delete(id);
  for (const [id, d] of keyPending)  if (d.expiresAt < now) keyPending.delete(id);
  for (const [id, d] of mediaPending) if (d.expiresAt < now) mediaPending.delete(id);
}, 60_000);
