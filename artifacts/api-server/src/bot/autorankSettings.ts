import { db, autorankSettingsTable, guildFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Rcon } from "rcon-client";
import { logger } from "../lib/logger.js";
import type { ProductType } from "./ticketCreation.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type AutorankSettingsData = {
  rconHost:         string;
  rconPort:         number;
  rconPassword:     string;
  commandPermanent: string;
  command1month:    string;
  commandMedia:     string | null;
  rankRoleId:       string | null;
  mediaRankRoleId:  string | null;
};

// ── In-memory cache (5 min TTL) ───────────────────────────────────────────

interface AutorankCache {
  settings:     AutorankSettingsData | null;
  enabled:      boolean;
  mediaEnabled: boolean;
  expiresAt:    number;
}
const cache = new Map<string, AutorankCache>();
const TTL = 5 * 60 * 1000;

async function loadCache(guildId: string): Promise<AutorankCache> {
  const [settingsRows, flagRows] = await Promise.all([
    db.select().from(autorankSettingsTable).where(eq(autorankSettingsTable.guildId, guildId)),
    db
      .select({
        autorankEnabled:      guildFlagsTable.autorankEnabled,
        mediaAutorankEnabled: guildFlagsTable.mediaAutorankEnabled,
      })
      .from(guildFlagsTable)
      .where(eq(guildFlagsTable.guildId, guildId)),
  ]);

  const row = settingsRows[0];
  const settings: AutorankSettingsData | null = row
    ? {
        rconHost:         row.rconHost,
        rconPort:         row.rconPort,
        rconPassword:     row.rconPassword,
        commandPermanent: row.commandPermanent,
        command1month:    row.command1month,
        commandMedia:     row.commandMedia ?? null,
        rankRoleId:       row.rankRoleId ?? null,
        mediaRankRoleId:  row.mediaRankRoleId ?? null,
      }
    : null;

  const flags = flagRows[0];
  return {
    settings,
    enabled:      flags?.autorankEnabled      ?? false,
    mediaEnabled: flags?.mediaAutorankEnabled ?? false,
    expiresAt:    Date.now() + TTL,
  };
}

async function getCache(guildId: string): Promise<AutorankCache> {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) return cached;
  const fresh = await loadCache(guildId);
  cache.set(guildId, fresh);
  return fresh;
}

export function invalidateAutorankCache(guildId: string): void {
  cache.delete(guildId);
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function getAutorankSettings(guildId: string): Promise<AutorankSettingsData | null> {
  return (await getCache(guildId)).settings;
}

export async function isAutorankEnabled(guildId: string): Promise<boolean> {
  return (await getCache(guildId)).enabled;
}

export async function isMediaAutorankEnabled(guildId: string): Promise<boolean> {
  return (await getCache(guildId)).mediaEnabled;
}

// ── Rank autorank save ────────────────────────────────────────────────────

export async function saveAutorankSettings(
  guildId: string,
  data: Omit<AutorankSettingsData, "commandMedia" | "mediaRankRoleId">,
): Promise<void> {
  const existing = await db
    .select({ guildId: autorankSettingsTable.guildId })
    .from(autorankSettingsTable)
    .where(eq(autorankSettingsTable.guildId, guildId));

  if (existing.length > 0) {
    await db
      .update(autorankSettingsTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(autorankSettingsTable.guildId, guildId));
  } else {
    await db.insert(autorankSettingsTable).values({
      guildId, ...data, commandMedia: null, mediaRankRoleId: null,
    });
  }
  invalidateAutorankCache(guildId);
}

// ── Media autorank save ───────────────────────────────────────────────────

export async function saveMediaAutorankSettings(
  guildId:        string,
  rconHost:       string,
  rconPort:       number,
  rconPassword:   string,
  commandMedia:   string,
  mediaRankRoleId: string | null,
): Promise<void> {
  const existing = await db
    .select()
    .from(autorankSettingsTable)
    .where(eq(autorankSettingsTable.guildId, guildId));

  if (existing.length > 0) {
    // Preserve existing rank commands; only update RCON + commandMedia + mediaRankRoleId
    await db
      .update(autorankSettingsTable)
      .set({ rconHost, rconPort, rconPassword, commandMedia, mediaRankRoleId, updatedAt: new Date() })
      .where(eq(autorankSettingsTable.guildId, guildId));
  } else {
    await db.insert(autorankSettingsTable).values({
      guildId, rconHost, rconPort, rconPassword,
      commandPermanent: "", command1month: "", commandMedia, mediaRankRoleId,
    });
  }
  invalidateAutorankCache(guildId);
}

// ── Flag setters ──────────────────────────────────────────────────────────

async function upsertFlag(guildId: string, patch: Partial<{ autorankEnabled: boolean; mediaAutorankEnabled: boolean }>) {
  const existing = await db
    .select({ guildId: guildFlagsTable.guildId })
    .from(guildFlagsTable)
    .where(eq(guildFlagsTable.guildId, guildId));

  if (existing.length > 0) {
    await db.update(guildFlagsTable).set({ ...patch, updatedAt: new Date() }).where(eq(guildFlagsTable.guildId, guildId));
  } else {
    await db.insert(guildFlagsTable).values({ guildId, ...patch, updatedAt: new Date() });
  }
  invalidateAutorankCache(guildId);
}

export async function setAutorankEnabled(guildId: string, enabled: boolean): Promise<void> {
  await upsertFlag(guildId, { autorankEnabled: enabled });
}

export async function setMediaAutorankEnabled(guildId: string, enabled: boolean): Promise<void> {
  await upsertFlag(guildId, { mediaAutorankEnabled: enabled });
}

// ── RCON execution ─────────────────────────────────────────────────────────

async function runRcon(settings: Pick<AutorankSettingsData, "rconHost" | "rconPort" | "rconPassword">, command: string): Promise<string> {
  const rcon = new Rcon({
    host:     settings.rconHost,
    port:     settings.rconPort,
    password: settings.rconPassword,
    timeout:  10_000,
  });
  try {
    await rcon.connect();
    const response = await rcon.send(command);
    await rcon.end();
    logger.info({ command, response }, "RCON command executed");
    return response;
  } catch (err) {
    await rcon.end().catch(() => {});
    throw err;
  }
}

export async function grantMinecraftRank(
  mcid:     string,
  product:  ProductType,
  settings: AutorankSettingsData,
): Promise<string> {
  const template = product === "permanent" ? settings.commandPermanent : settings.command1month;
  const command  = template.replace(/\{mcid\}/gi, mcid);
  return runRcon(settings, command);
}

export async function grantMinecraftMediaRank(
  mcid:     string,
  settings: AutorankSettingsData,
): Promise<string> {
  if (!settings.commandMedia) throw new Error("commandMedia is not configured");
  const command = settings.commandMedia.replace(/\{mcid\}/gi, mcid);
  return runRcon(settings, command);
}
