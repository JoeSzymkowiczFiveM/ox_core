import { CDB } from "db/chiliaddb";
import type { DbGroup } from "types";

export function SelectGroups() {
  return CDB.find<DbGroup>("ox_groups", undefined, { sort: { field: "name" } });
}

export async function InsertGroup({ name, label, type, colour, hasAccount, grades, accountRoles }: DbGroup) {
  const existing = await CDB.exists("ox_groups", { name });
  if (existing) return true;

  return !!(await CDB.insertOne("ox_groups", { name, label, type, colour, hasAccount, grades, accountRoles }));
}

export function RemoveGroup(groupName: string) {
  return CDB.delete("ox_groups", { name: groupName });
}

export async function AddCharacterGroup(charId: number, name: string, grade: number) {
  return !!(await CDB.insertOne("character_groups", { charId, name, grade, isActive: false }));
}

export async function UpdateCharacterGroup(charId: number, name: string, grade: number) {
  return CDB.updateOne("character_groups", { charId, name }, { grade });
}

export async function RemoveCharacterGroup(charId: number, name: string) {
  return CDB.deleteOne("character_groups", { charId, name });
}

export function GetCharacterGroups(charId: number) {
  return CDB.find<{ name: string; grade: number; isActive: boolean }>("character_groups", { charId });
}

export async function SetActiveGroup(charId: number, groupName?: string) {
  await CDB.update("character_groups", { charId, isActive: true }, { isActive: false });

  if (groupName) await CDB.updateOne("character_groups", { charId, name: groupName }, { isActive: true });
}
