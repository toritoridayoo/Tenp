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
};

// ── In-memory cache (5 min TTL) ───────────────────────────────────────────

interface AutorankCache {
  settings: AutorankSettingsData | null;
  enabled:  boolean;
  expiresAt: number;
}
const cache = new Map<string, AutorankCache>();
const TTL = 5 * 60 * 1000;

async function loadCache(guildId: string): Promise<AutorankCache> {
  const [settingsRows, flagRows] = await Promise.all([
    db.select().from(autorankSettingsTable).where(eq(autorankSettingsTable.guildId, guildId)),
    db
      .select({ autorankEnabled: guildFlagsTable.autorankEnabled })
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
      }
    : null;

  const enabled = flagRows[0]?.autorankEnabled ?? false;
  return { settings, enabled, expiresAt: Date.now() + TTL };
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

export async function saveAutorankSettings(
  guildId: string,
  data: AutorankSettingsData,
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
    await db.insert(autorankSettingsTable).values({ guildId, ...data });
  }
  invalidateAutorankCache(guildId);
}

export async function setAutorankEnabled(guildId: string, enabled: boolean): Promise<void> {
  const existing = await db
    .select({ guildId: guildFlagsTable.guildId })
    .from(guildFlagsTable)
    .where(eq(guildFlagsTable.guildId, guildId));

  if (existing.length > 0) {
    await db
      .update(guildFlagsTable)
      .set({ autorankEnabled: enabled, updatedAt: new Date() })
      .where(eq(guildFlagsTable.guildId, guildId));
  } else {
    await db.insert(guildFlagsTable).values({ guildId, autorankEnabled: enabled, updatedAt: new Date() });
  }
  invalidateAutorankCache(guildId);
}

// ── RCON execution ─────────────────────────────────────────────────────────

export async function grantMinecraftRank(
  mcid:     string,
  product:  ProductType,
  settings: AutorankSettingsData,
): Promise<string> {
  const template = product === "permanent" ? settings.commandPermanent : settings.command1month;
  const command  = template.replace(/\{mcid\}/gi, mcid);

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
    logger.info({ mcid, command, response }, "RCON rank command executed");
    return response;
  } catch (err) {
    await rcon.end().catch(() => {});
    throw err;
  }
}
