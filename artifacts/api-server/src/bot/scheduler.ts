import { Client } from "discord.js";
import { db } from "@workspace/db";
import { roleGrantsTable } from "@workspace/db";
import { and, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { botConfig } from "./config.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function startScheduler(client: Client) {
  logger.info("Role expiry scheduler started");

  // Run immediately on start, then every 5 minutes
  void checkExpiredRoles(client);
  setInterval(() => void checkExpiredRoles(client), CHECK_INTERVAL_MS);
}

async function checkExpiredRoles(client: Client) {
  try {
    const now = new Date();

    // Find expired, non-removed role grants
    const expiredGrants = await db
      .select()
      .from(roleGrantsTable)
      .where(
        and(
          eq(roleGrantsTable.removed, false),
          eq(roleGrantsTable.permanent, false),
          isNotNull(roleGrantsTable.expiresAt),
          lte(roleGrantsTable.expiresAt, now)
        )
      );

    if (expiredGrants.length === 0) return;

    logger.info({ count: expiredGrants.length }, "Processing expired role grants");

    const guild = await client.guilds.fetch(botConfig.guildId).catch(() => null);
    if (!guild) {
      logger.error("Could not fetch guild for role removal");
      return;
    }

    for (const grant of expiredGrants) {
      try {
        const member = await guild.members.fetch(grant.userId).catch(() => null);
        const otherActiveGrants = await db
          .select({ id: roleGrantsTable.id })
          .from(roleGrantsTable)
          .where(
            and(
              eq(roleGrantsTable.guildId, grant.guildId),
              eq(roleGrantsTable.userId, grant.userId),
              eq(roleGrantsTable.roleId, grant.roleId),
              eq(roleGrantsTable.removed, false),
              or(
                eq(roleGrantsTable.permanent, true),
                isNull(roleGrantsTable.expiresAt),
                gt(roleGrantsTable.expiresAt, now),
              ),
            ),
          )
          .limit(1);

        if (member) {
          if (otherActiveGrants.length === 0) {
            await member.roles.remove(grant.roleId, "ランク付与期間終了");
            logger.info(
              { userId: grant.userId, grantId: grant.id },
              "Expired role removed"
            );
          } else {
            logger.info(
              { userId: grant.userId, grantId: grant.id },
              "Expired grant ended; another active grant keeps the role"
            );
          }
        } else {
          logger.warn(
            { userId: grant.userId, grantId: grant.id },
            "Member not found for expired role removal (may have left)"
          );
        }

        // Mark as removed regardless of whether we found the member
        await db
          .update(roleGrantsTable)
          .set({ removed: true, removedAt: now })
          .where(eq(roleGrantsTable.id, grant.id));
      } catch (err) {
        logger.error({ err, grantId: grant.id }, "Failed to remove expired role");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error in role expiry scheduler");
  }
}
