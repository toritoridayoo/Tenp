import { db, autorankSettingsTable, guildFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Rcon } from "rcon-client";
import { logger } from "../lib/logger.js";
import type { ProductType } from "./ticketCreation.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type RconTarget = {
  host:     string;
  port:     number;
  password: string;
};

export type AutorankSettingsData = {
  velocity:             RconTarget | null;
  lobby:                RconTarget | null;
  cmdPermanentVelocity: string | null;
  cmdPermanentLobby:    string | null;
  cmd1monthVelocity:    string | null;
  cmd1monthLobby:       string | null;
  cmdMediaVelocity:     string | null;
  cmdMediaLobby:        string | null;
  rankRoleId:           string | null;
  mediaRankRoleId:      string | null;
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
  let settings: AutorankSettingsData | null = null;
  if (row) {
    const velocity: RconTarget | null =
      row.velocityHost && row.velocityPort != null && row.velocityPassword
        ? { host: row.velocityHost, port: row.velocityPort, password: row.velocityPassword }
        : null;
    const lobby: RconTarget | null =
      row.lobbyHost && row.lobbyPort != null && row.lobbyPassword
        ? { host: row.lobbyHost, port: row.lobbyPort, password: row.lobbyPassword }
        : null;
    settings = {
      velocity,
      lobby,
      cmdPermanentVelocity: row.cmdPermanentVelocity ?? null,
      cmdPermanentLobby:    row.cmdPermanentLobby    ?? null,
      cmd1monthVelocity:    row.cmd1monthVelocity    ?? null,
      cmd1monthLobby:       row.cmd1monthLobby       ?? null,
      cmdMediaVelocity:     row.cmdMediaVelocity     ?? null,
      cmdMediaLobby:        row.cmdMediaLobby        ?? null,
      rankRoleId:           row.rankRoleId           ?? null,
      mediaRankRoleId:      row.mediaRankRoleId      ?? null,
    };
  }

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

// ── Upsert helper ─────────────────────────────────────────────────────────

async function upsertAutorankRow(guildId: string, patch: Partial<Omit<typeof autorankSettingsTable.$inferInsert, "guildId">>) {
  const existing = await db
    .select({ guildId: autorankSettingsTable.guildId })
    .from(autorankSettingsTable)
    .where(eq(autorankSettingsTable.guildId, guildId));

  if (existing.length > 0) {
    await db
      .update(autorankSettingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(autorankSettingsTable.guildId, guildId));
  } else {
    await db.insert(autorankSettingsTable).values({ guildId, ...patch });
  }
  invalidateAutorankCache(guildId);
}

// ── RCON settings save ────────────────────────────────────────────────────

export async function saveRconSettings(
  guildId:          string,
  velocityHost:     string,
  velocityPort:     number,
  velocityPassword: string,
  lobbyHost:        string,
  lobbyPort:        number,
  lobbyPassword:    string,
): Promise<void> {
  await upsertAutorankRow(guildId, {
    velocityHost, velocityPort, velocityPassword,
    lobbyHost, lobbyPort, lobbyPassword,
  });
}

// ── Rank commands save ────────────────────────────────────────────────────

export async function saveRankCommands(
  guildId:              string,
  cmdPermanentVelocity: string,
  cmdPermanentLobby:    string,
  cmd1monthVelocity:    string,
  cmd1monthLobby:       string,
  rankRoleId:           string | null,
): Promise<void> {
  await upsertAutorankRow(guildId, {
    cmdPermanentVelocity, cmdPermanentLobby,
    cmd1monthVelocity,    cmd1monthLobby,
    rankRoleId,
  });
}

// ── Media commands save ───────────────────────────────────────────────────

export async function saveMediaCommands(
  guildId:          string,
  cmdMediaVelocity: string,
  cmdMediaLobby:    string,
  mediaRankRoleId:  string | null,
): Promise<void> {
  await upsertAutorankRow(guildId, { cmdMediaVelocity, cmdMediaLobby, mediaRankRoleId });
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

async function runRcon(target: RconTarget, command: string): Promise<string> {
  const rcon = new Rcon({
    host:     target.host,
    port:     target.port,
    password: target.password,
    timeout:  10_000,
  });
  try {
    await rcon.connect();
    const response = await rcon.send(command);
    await rcon.end();
    logger.info({ host: target.host, port: target.port, command, response }, "RCON command executed");
    return response;
  } catch (err) {
    await rcon.end().catch(() => {});
    throw err;
  }
}

// ── Rank grant (Velocity + Lobby in parallel) ─────────────────────────────

export type GrantResult = {
  velocityOk:    boolean;
  velocityError: string | null;
  lobbyOk:       boolean;
  lobbyError:    string | null;
};

export async function grantMinecraftRank(
  mcid:     string,
  product:  ProductType,
  settings: AutorankSettingsData,
): Promise<GrantResult> {
  const isPermament = product === "permanent";
  const cmdVelocity = (isPermament ? settings.cmdPermanentVelocity : settings.cmd1monthVelocity)?.replace(/\{mcid\}/gi, mcid) ?? null;
  const cmdLobby    = (isPermament ? settings.cmdPermanentLobby    : settings.cmd1monthLobby   )?.replace(/\{mcid\}/gi, mcid) ?? null;

  const [velResult, lobbyResult] = await Promise.all([
    settings.velocity && cmdVelocity
      ? runRcon(settings.velocity, cmdVelocity).then(() => null).catch((e: unknown) => String(e))
      : Promise.resolve(settings.velocity && cmdVelocity ? null : "未設定"),
    settings.lobby && cmdLobby
      ? runRcon(settings.lobby, cmdLobby).then(() => null).catch((e: unknown) => String(e))
      : Promise.resolve(settings.lobby && cmdLobby ? null : "未設定"),
  ]);

  return {
    velocityOk:    velResult === null,
    velocityError: velResult,
    lobbyOk:       lobbyResult === null,
    lobbyError:    lobbyResult,
  };
}

// ── Media rank grant ──────────────────────────────────────────────────────

export async function grantMinecraftMediaRank(
  mcid:     string,
  settings: AutorankSettingsData,
): Promise<GrantResult> {
  const cmdVelocity = settings.cmdMediaVelocity?.replace(/\{mcid\}/gi, mcid) ?? null;
  const cmdLobby    = settings.cmdMediaLobby?.replace(/\{mcid\}/gi, mcid)    ?? null;

  const [velResult, lobbyResult] = await Promise.all([
    settings.velocity && cmdVelocity
      ? runRcon(settings.velocity, cmdVelocity).then(() => null).catch((e: unknown) => String(e))
      : Promise.resolve("未設定"),
    settings.lobby && cmdLobby
      ? runRcon(settings.lobby, cmdLobby).then(() => null).catch((e: unknown) => String(e))
      : Promise.resolve("未設定"),
  ]);

  return {
    velocityOk:    velResult === null,
    velocityError: velResult,
    lobbyOk:       lobbyResult === null,
    lobbyError:    lobbyResult,
  };
}

// ── Grant result → human-readable note ───────────────────────────────────

export function buildRconNote(result: GrantResult): string {
  const vel   = result.velocityOk ? "✅ Velocity: 成功" : `⚠️ Velocity: ${result.velocityError ?? "エラー"}`;
  const lobby = result.lobbyOk    ? "✅ Lobby: 成功"    : `⚠️ Lobby: ${result.lobbyError    ?? "エラー"}`;
  return `${vel}\n${lobby}`;
}
