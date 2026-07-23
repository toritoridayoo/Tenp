import { db, guildFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── In-memory cache (5 min TTL) ───────────────────────────────────────────

const cache = new Map<string, { open: boolean; expiresAt: number }>();
const TTL = 5 * 60 * 1000;

export async function isStaffAppOpen(guildId: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.open;

  const rows = await db
    .select({ staffAppOpen: guildFlagsTable.staffAppOpen })
    .from(guildFlagsTable)
    .where(eq(guildFlagsTable.guildId, guildId));

  // デフォルトは true（レコードがなければ応募受付中）
  const open = rows.length > 0 ? rows[0]!.staffAppOpen : true;
  cache.set(guildId, { open, expiresAt: now + TTL });
  return open;
}

export async function setStaffAppOpen(guildId: string, open: boolean): Promise<void> {
  const existing = await db
    .select({ guildId: guildFlagsTable.guildId })
    .from(guildFlagsTable)
    .where(eq(guildFlagsTable.guildId, guildId));

  if (existing.length > 0) {
    await db
      .update(guildFlagsTable)
      .set({ staffAppOpen: open, updatedAt: new Date() })
      .where(eq(guildFlagsTable.guildId, guildId));
  } else {
    await db.insert(guildFlagsTable).values({ guildId, staffAppOpen: open, updatedAt: new Date() });
  }

  // キャッシュ更新
  cache.set(guildId, { open, expiresAt: Date.now() + TTL });
}
