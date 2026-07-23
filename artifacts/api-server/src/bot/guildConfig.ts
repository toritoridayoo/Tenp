import { db, panelSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { botConfig } from "./config.js";
import type { GuildMember } from "discord.js";

export type StaffEntry = { id: string; type: "role" | "user" };

export type PanelCtx = {
  categoryId: string;
  staffIds: StaffEntry[];
  logChannelId: string;
  approvalChannelId: string;
};

export type GuildSettings = Partial<Record<"purchase" | "support" | "staff", PanelCtx>>;

// ── In-memory cache ────────────────────────────────────────────────────────

const cache = new Map<string, { settings: GuildSettings; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.settings;

  const rows = await db
    .select()
    .from(panelSettingsTable)
    .where(eq(panelSettingsTable.guildId, guildId));

  const settings: GuildSettings = {};
  for (const row of rows) {
    const key = row.panelType as "purchase" | "support" | "staff";
    settings[key] = {
      staffIds: (row.staffIds ?? []) as StaffEntry[],
      categoryId: row.ticketCategoryId ?? "",
      logChannelId: row.logChannelId ?? "",
      approvalChannelId: row.approvalChannelId ?? "",
    };
  }

  cache.set(guildId, { settings, expiresAt: now + CACHE_TTL });
  return settings;
}

export function invalidateGuildCache(guildId: string): void {
  cache.delete(guildId);
}

// ── Staff check (DB + env var fallback) ───────────────────────────────────

export async function isStaffInGuild(
  member: GuildMember | null,
  guildId: string,
): Promise<boolean> {
  if (!member) return false;

  // env var fallback
  if (botConfig.staffRoleId && member.roles.cache.has(botConfig.staffRoleId)) return true;
  if (botConfig.subStaffRoleId && member.roles.cache.has(botConfig.subStaffRoleId)) return true;

  // DB check
  const settings = await getGuildSettings(guildId);
  for (const panel of Object.values(settings)) {
    if (!panel) continue;
    for (const entry of panel.staffIds) {
      if (entry.type === "role" && member.roles.cache.has(entry.id)) return true;
      if (entry.type === "user" && member.id === entry.id) return true;
    }
  }
  return false;
}

// ── Convenience getters (DB → env var fallback) ────────────────────────────

export function getPurchaseCtx(s: GuildSettings): PanelCtx {
  return {
    categoryId: s.purchase?.categoryId || botConfig.ticketChannelId,
    staffIds: s.purchase?.staffIds?.length
      ? s.purchase.staffIds
      : buildEnvStaffIds(),
    logChannelId: s.purchase?.logChannelId || botConfig.ticketLogChannelId,
    approvalChannelId: s.purchase?.approvalChannelId || botConfig.approvalChannelId,
  };
}

export function getSupportCtx(s: GuildSettings): PanelCtx {
  return {
    categoryId: s.support?.categoryId || botConfig.supportTicketCategoryId,
    staffIds: s.support?.staffIds?.length
      ? s.support.staffIds
      : buildEnvStaffIds(),
    logChannelId:
      s.support?.logChannelId ||
      botConfig.supportLogChannelId ||
      botConfig.ticketLogChannelId,
    approvalChannelId: "",
  };
}

function buildEnvStaffIds(): StaffEntry[] {
  const ids: StaffEntry[] = [];
  if (botConfig.staffRoleId) ids.push({ id: botConfig.staffRoleId, type: "role" });
  if (botConfig.subStaffRoleId) ids.push({ id: botConfig.subStaffRoleId, type: "role" });
  return ids;
}
