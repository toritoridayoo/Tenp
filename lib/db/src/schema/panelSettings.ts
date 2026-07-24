import { pgTable, serial, text, timestamp, jsonb, unique } from "drizzle-orm/pg-core";

export type StaffEntry = { id: string; type: "role" | "user" };

export const panelSettingsTable = pgTable(
  "panel_settings",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    panelType: text("panel_type").notNull(), // 'purchase' | 'support' | 'staff'
    staffIds: jsonb("staff_ids").$type<StaffEntry[]>().notNull().default([]),
    approvalPingIds: jsonb("approval_ping_ids").$type<StaffEntry[]>().notNull().default([]),
    ticketCategoryId: text("ticket_category_id"),
    logChannelId: text("log_channel_id"),
    approvalChannelId: text("approval_channel_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unq: unique("panel_settings_guild_panel_unq").on(t.guildId, t.panelType),
  }),
);

export type PanelSetting = typeof panelSettingsTable.$inferSelect;
