import { defaultAccountRoles } from "db/chiliaddb";
import type { OxAccountPermissions, OxAccountRole } from "types";
import { SelectAccount } from "./db";
import { GetGroup } from "groups";
import type { OxPlayer } from "player/class";

const accountRoles = {} as Record<string, OxAccountPermissions>;

const blacklistedGroupActions = {
  addUser: true,
  removeUser: true,
  manageUser: true,
  transferOwnership: true,
  manageAccount: true,
  closeAccount: true,
} as Record<keyof OxAccountPermissions, true>;

export function CheckRolePermission(roleName: OxAccountRole | null, permission: keyof OxAccountPermissions) {
  if (!roleName) return;

  return accountRoles?.[roleName.toLowerCase()]?.[permission];
}

export async function CanPerformAction(
  player: OxPlayer,
  accountId: number,
  role: OxAccountRole | null,
  action: keyof OxAccountPermissions,
) {
  if (CheckRolePermission(role, action)) return true;

  const groupName = (await SelectAccount(accountId))?.group;

  if (groupName) {
    if (action in blacklistedGroupActions) return false;

    const group = GetGroup(groupName);
    const groupRole = group.accountRoles[player.getGroup(groupName)];

    if (CheckRolePermission(groupRole, action)) return true;
  }

  return false;
}

async function LoadRoles() {
  const roles = defaultAccountRoles;

  roles.forEach(({ id, name, ...permissions }) => {
    const roleName = name.toLowerCase() as OxAccountRole;

    accountRoles[roleName] = permissions;
    GlobalState[`accountRole.${roleName}`] = permissions;
  });

  GlobalState["accountRoles"] = Object.keys(accountRoles);
}

setImmediate(LoadRoles);
