import {
  pgTable,
  text,
  serial,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roleGrantsTable = pgTable("role_grants", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  roleId: text("role_id").notNull(),
  purchaseId: text("purchase_id").notNull(),
  permanent: boolean("permanent").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  grantedBy: text("granted_by").notNull(),
  ticketChannelId: text("ticket_channel_id"),
  removed: boolean("removed").notNull().default(false),
  removedAt: timestamp("removed_at", { withTimezone: true }),
});

export const insertRoleGrantSchema = createInsertSchema(roleGrantsTable).omit({
  id: true,
  grantedAt: true,
});
export type InsertRoleGrant = z.infer<typeof insertRoleGrantSchema>;
export type RoleGrant = typeof roleGrantsTable.$inferSelect;
