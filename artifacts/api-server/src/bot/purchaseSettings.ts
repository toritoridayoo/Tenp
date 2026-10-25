import { db, guildFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type RankPurchaseMode = "booth" | "amazon";

export async function getRankPurchaseMode(guildId: string): Promise<RankPurchaseMode> {
  const rows = await db
    .select({ mode: guildFlagsTable.rankPurchaseMode })
    .from(guildFlagsTable)
    .where(eq(guildFlagsTable.guildId, guildId))
    .limit(1);

  return rows[0]?.mode === "amazon" ? "amazon" : "booth";
}

export async function setRankPurchaseMode(guildId: string, mode: RankPurchaseMode): Promise<void> {
  await db
    .insert(guildFlagsTable)
    .values({ guildId, rankPurchaseMode: mode, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: guildFlagsTable.guildId,
      set: { rankPurchaseMode: mode, updatedAt: new Date() },
    });
}
