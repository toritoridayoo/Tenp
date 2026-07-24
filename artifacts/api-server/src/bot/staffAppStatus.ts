import { db, guildFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── In-memory cache (5 min TTL) ───────────────────────────────────────────

interface FlagCache {
  staffAppOpen: boolean;
  requestCloseEnabled: boolean;
  expiresAt: number;
}
const cache = new Map<string, FlagCache>();
const TTL = 5 * 60 * 1000;

async function getFlags(guildId: string): Promise<{ staffAppOpen: boolean; requestCloseEnabled: boolean }> {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) return cached;

  const rows = await db
    .select({ staffAppOpen: guildFlagsTable.staffAppOpen, requestCloseEnabled: guildFlagsTable.requestCloseEnabled })
    .from(guildFlagsTable)
    .where(eq(guildFlagsTable.guildId, guildId));

  const flags = rows.length > 0
    ? { staffAppOpen: rows[0]!.staffAppOpen, requestCloseEnabled: rows[0]!.requestCloseEnabled }
    : { staffAppOpen: true, requestCloseEnabled: true };

  cache.set(guildId, { ...flags, expiresAt: now + TTL });
  return flags;
}

async function upsertFlags(guildId: string, patch: Partial<{ staffAppOpen: boolean; requestCloseEnabled: boolean }>) {
  const existing = await db
    .select({ guildId: guildFlagsTable.guildId })
    .from(guildFlagsTable)
    .where(eq(guildFlagsTable.guildId, guildId));

  if (existing.length > 0) {
    await db.update(guildFlagsTable).set({ ...patch, updatedAt: new Date() }).where(eq(guildFlagsTable.guildId, guildId));
  } else {
    await db.insert(guildFlagsTable).values({ guildId, ...patch, updatedAt: new Date() });
  }
  cache.delete(guildId); // invalidate so next read is fresh
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function isStaffAppOpen(guildId: string): Promise<boolean> {
  return (await getFlags(guildId)).staffAppOpen;
}

export async function setStaffAppOpen(guildId: string, open: boolean): Promise<void> {
  await upsertFlags(guildId, { staffAppOpen: open });
}

export async function isRequestCloseEnabled(guildId: string): Promise<boolean> {
  return (await getFlags(guildId)).requestCloseEnabled;
}

export async function setRequestCloseEnabled(guildId: string, enabled: boolean): Promise<void> {
  await upsertFlags(guildId, { requestCloseEnabled: enabled });
}
