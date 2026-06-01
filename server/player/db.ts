import type { Character, Dict, OxStatus, CharacterLicense, OxLicense, BanDetails } from "types";
import { CHARACTER_SLOTS } from "../../common/config";
import { CDB, formatDate } from "../db/chiliaddb";
import { OxPlayer } from "./class";

export async function GetUserIdFromIdentifier(identifier: string, offset?: number) {
  const users = await CDB.find<{ userId: number }>("users", { license2: identifier }, { sort: { field: "userId" } });
  return users[offset || 0]?.userId ?? null;
}

export async function CreateUser(username: string, { license2, steam, fivem, discord }: Dict<string>) {
  const userId = await CDB.insertOne("users", { username, license2, steam, fivem, discord }, "userId");
  if (!userId) throw new Error(`Failed to create user for ${license2}`);
  return userId;
}

export async function IsStateIdAvailable(stateId: string) {
  return !(await CDB.exists("characters", { stateId }));
}

export async function CreateCharacter(
  userId: number,
  stateId: string,
  firstName: string,
  lastName: string,
  gender: string,
  date: number,
  phoneNumber?: number,
) {
  const charId = await CDB.insertOne(
    "characters",
    {
      userId,
      stateId,
      firstName,
      lastName,
      gender,
      dateOfBirth: new Date(Number(date)).toISOString(),
      phoneNumber,
      lastPlayed: Date.now(),
      isDead: false,
      statuses: {},
    },
    "charId",
  );
  if (!charId) throw new Error(`Failed to create character for user ${userId}`);
  return charId;
}

export async function GetCharacters(userId: number) {
  const characters = await CDB.find<Character & { deleted?: number | string }>(
    "characters",
    { userId },
    { sort: { field: "charId" }, limit: CHARACTER_SLOTS },
  );

  return characters
    .filter((character) => !character.deleted)
    .map((character) => ({
      charId: character.charId,
      stateId: character.stateId,
      firstName: character.firstName,
      lastName: character.lastName,
      gender: character.gender,
      x: character.x,
      y: character.y,
      z: character.z,
      heading: character.heading,
      lastPlayed: formatDate(character.lastPlayed),
    }));
}

function saveOneCharacter(values: any[]) {
  const [x, y, z, heading, isDead, health, armour, statuses, charId] = values;

  return CDB.updateOne(
    "characters",
    { charId },
    { x, y, z, heading, isDead, lastPlayed: Date.now(), health, armour, statuses },
  );
}

export function SaveCharacterData(values: any[] | any[][], batch?: boolean) {
  return batch ? Promise.all((values as any[][]).map(saveOneCharacter)) : saveOneCharacter(values as any[]);
}

export async function DeleteCharacter(charId: number) {
  return CDB.updateOne("characters", { charId }, { deleted: Date.now() });
}

export async function GetCharacterMetadata(charId: number) {
  const row = await CDB.findOne<{
    isDead: boolean | number;
    gender: string;
    dateOfBirth: string;
    phoneNumber: string;
    health: number;
    armour: number;
    statuses: Dict<number>;
  }>("characters", { charId });

  if (!row) return null;

  return {
    isDead: row.isDead ? 1 : 0,
    gender: row.gender,
    dateOfBirth: formatDate(row.dateOfBirth),
    phoneNumber: row.phoneNumber,
    health: row.health,
    armour: row.armour,
    statuses: row.statuses || {},
  };
}

export function GetStatuses() {
  return CDB.find<OxStatus>("ox_statuses", undefined, { sort: { field: "name" } });
}

export function GetLicenses() {
  return CDB.find<Dict<OxLicense>>("ox_licenses", undefined, { sort: { field: "name" } });
}

export function GetLicense(name: string) {
  return CDB.findOne<OxLicense>("ox_licenses", { name });
}

export function GetCharacterLicenses(charId: number) {
  return CDB.find<{ name: string; data: CharacterLicense }>("character_licenses", { charId });
}

export function AddCharacterLicense(charId: number, name: string, data: CharacterLicense) {
  return CDB.insertOne("character_licenses", { charId, name, data });
}

export function RemoveCharacterLicense(charId: number, name: string) {
  return CDB.delete("character_licenses", { charId, name });
}

export async function UpdateCharacterLicense(charId: number, name: string, key: string, value: any) {
  const license = await CDB.findOne<{ data: CharacterLicense }>("character_licenses", { charId, name });
  if (!license) return 0;

  const data = { ...(license.data || {}) };
  if (value == null) delete data[key];
  else data[key] = value;

  return (await CDB.updateOne("character_licenses", { charId, name }, { data })) ? 1 : 0;
}

export async function GetCharIdFromStateId(stateId: string) {
  return (await CDB.findOne<{ charId: number }>("characters", { stateId }))?.charId ?? null;
}

export async function UpdateUserTokens(userId: number, tokens: string[]) {
  if (tokens.length === 0) return;

  await Promise.all(
    tokens.map(async (token) => {
      if (!(await CDB.exists("user_tokens", { userId, token }))) await CDB.insertOne("user_tokens", { userId, token });
    }),
  );
}

export async function IsUserBanned(userId: number): Promise<BanDetails | undefined> {
  const ban = await CDB.findOne<BanDetails>("banned_users", { userId });
  if (!ban) return;

  if (ban.unban_at && new Date(ban.unban_at).getTime() <= Date.now()) {
    await CDB.deleteOne("banned_users", { userId });
    return;
  }

  const token = (await CDB.findOne<{ token: string }>("user_tokens", { userId }))?.token;
  return { ...ban, token };
}

export async function BanUser(userId: number, reason?: string, hours?: number) {
  const banned_at = Date.now();
  const unban_at = hours ? banned_at + hours * 60 * 60 * 1000 : undefined;
  const success = await CDB.update(
    "banned_users",
    { userId },
    { userId, banned_at, unban_at, reason },
    { upsert: true },
  );

  if (!success) {
    console.error(`Failed to ban ${userId}`);
    return false;
  }

  const playerId = OxPlayer.getFromUserId(userId)?.source as string;

  if (playerId) DropPlayer(playerId, OxPlayer.formatBanReason({ userId, banned_at, unban_at, reason }));

  return true;
}

export async function UnbanUser(userId: number) {
  return CDB.delete("banned_users", { userId });
}
