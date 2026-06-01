import { getRandomInt } from "@overextended/ox_lib";
import { OxAccount } from "accounts/class";
import { CDB } from "db/chiliaddb";
import { OxPlayer } from "player/class";
import type { OxAccountMetadata, OxAccountUserMetadata, OxCreateInvoice } from "types";
import locales from "../../common/locales";
import { CanPerformAction } from "./roles";

async function GenerateAccountId() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  const baseId = Number(year + month) * 1e3;

  while (true) {
    const accountId = getRandomInt(10, 99) * 1e7 + baseId + getRandomInt(0, 9999);
    if (await IsAccountIdAvailable(accountId)) return accountId;
  }
}

async function addTransaction(document: Record<string, any>) {
  return CDB.insertOne("accounts_transactions", { ...document, date: Date.now() }, "id");
}

export async function UpdateBalance(
  accountId: number,
  amount: number,
  action: "add" | "remove",
  overdraw: boolean,
  message?: string,
  note?: string,
  actorId?: number,
): Promise<{ success: boolean; message?: string }> {
  amount = Number.parseInt(String(amount));

  if (isNaN(amount)) return { success: false, message: "amount_not_number" };
  if (amount <= 0) return { success: false, message: "invalid_amount" };

  const account = await SelectAccount(accountId);
  if (!account) return { success: false, message: "no_balance" };

  const addAction = action === "add";
  const newBalance = addAction ? account.balance + amount : account.balance - amount;

  if (!addAction && !overdraw && newBalance < 0) return { success: false, message: "insufficient_balance" };

  const success = await CDB.updateOne("accounts", { id: accountId }, { balance: newBalance });
  if (!success) return { success: false, message: "insufficient_balance" };

  !message && (message = locales(action === "add" ? "deposit" : "withdraw"));

  const didUpdate = await addTransaction({
    actorId: actorId || null,
    fromId: addAction ? null : accountId,
    toId: addAction ? accountId : null,
    amount,
    message,
    note,
    fromBalance: addAction ? null : newBalance,
    toBalance: addAction ? newBalance : null,
  });

  if (!didUpdate) return { success: false, message: "something_went_wrong" };

  emit("ox:updatedBalance", { accountId, amount, action });

  return { success: true };
}

export async function PerformTransaction(
  fromId: number,
  toId: number,
  amount: number,
  overdraw: boolean,
  message?: string,
  note?: string,
  actorId?: number,
): Promise<{ success: boolean; message?: string }> {
  amount = Number.parseInt(String(amount));

  if (isNaN(amount)) return { success: false, message: "amount_not_number" };
  if (amount <= 0) return { success: false, message: "invalid_amount" };

  const fromAccount = await SelectAccount(fromId);
  const toAccount = await SelectAccount(toId);

  if (!fromAccount || !toAccount) return { success: false, message: "no_balance" };
  if (!overdraw && fromAccount.balance - amount < 0) return { success: false, message: "insufficient_balance" };

  const fromBalance = fromAccount.balance - amount;
  const toBalance = toAccount.balance + amount;
  const removedBalance = await CDB.updateOne("accounts", { id: fromId }, { balance: fromBalance });
  const addedBalance = removedBalance && (await CDB.updateOne("accounts", { id: toId }, { balance: toBalance }));

  if (addedBalance) {
    await addTransaction({
      actorId,
      fromId,
      toId,
      amount,
      message: message ?? locales("transfer"),
      note,
      fromBalance,
      toBalance,
    });

    emit("ox:transferredMoney", { fromId, toId, amount });

    return { success: true };
  }

  return { success: false, message: "something_went_wrong" };
}

export function SelectAccounts(column: "owner" | "group" | "id", id: number | string) {
  return CDB.find<OxAccountMetadata>("accounts", { [column]: id });
}

export async function SelectDefaultAccountId(column: "owner" | "group" | "id", id: number | string) {
  return (await CDB.findOne<OxAccountMetadata>("accounts", { [column]: id, isDefault: true }))?.id ?? null;
}

export function SelectAccount(id: number) {
  return CDB.findOne<OxAccountMetadata>("accounts", { id });
}

export async function IsAccountIdAvailable(id: number) {
  return !(await CDB.exists("accounts", { id }));
}

export async function CreateNewAccount(owner: string | number, label: string, isDefault?: boolean) {
  const accountId = await GenerateAccountId();
  const column = typeof owner === "string" ? "group" : "owner";
  const result = await CDB.insertOne("accounts", {
    id: accountId,
    label,
    [column]: owner,
    balance: 0,
    type: column === "group" ? "group" : "personal",
    isDefault: isDefault || false,
  });

  if (result && column === "owner") await CDB.insertOne("accounts_access", { accountId, charId: owner, role: "owner" });

  return accountId;
}

export async function DeleteAccount(accountId: number): Promise<{ success: boolean; message?: string }> {
  const success = await CDB.updateOne("accounts", { id: accountId }, { type: "inactive" });

  if (!success) return { success: false, message: "something_went_wrong" };

  return { success: true };
}

export async function SelectAccountRole(accountId: number, charId: number) {
  return (await CDB.findOne<OxAccountUserMetadata>("accounts_access", { accountId, charId }))?.role ?? null;
}

export async function DepositMoney(
  playerId: number,
  accountId: number,
  amount: number,
  message?: string,
  note?: string,
): Promise<{ success: boolean; message?: string }> {
  amount = Number.parseInt(String(amount));

  if (isNaN(amount)) return { success: false, message: "amount_not_number" };
  if (amount <= 0) return { success: false, message: "invalid_amount" };

  const player = OxPlayer.get(playerId);
  if (!player?.charId) return { success: false, message: "no_charid" };

  const money = exports.ox_inventory.GetItemCount(playerId, "money");
  if (amount > money) return { success: false, message: "insufficient_funds" };

  const account = await SelectAccount(accountId);
  if (!account) return { success: false, message: "no_balance" };

  const role = await SelectAccountRole(accountId, player.charId);
  if (!(await CanPerformAction(player, accountId, role, "deposit"))) return { success: false, message: "no_access" };

  const balance = account.balance + amount;
  const affectedRows = await CDB.updateOne("accounts", { id: accountId }, { balance });

  if (!affectedRows || !exports.ox_inventory.RemoveItem(playerId, "money", amount)) {
    return { success: false, message: "something_went_wrong" };
  }

  await addTransaction({
    actorId: player.charId,
    fromId: null,
    toId: accountId,
    amount,
    message: message ?? locales("deposit"),
    note,
    fromBalance: null,
    toBalance: balance,
  });

  emit("ox:depositedMoney", { playerId, accountId, amount });

  return { success: true };
}

export async function WithdrawMoney(
  playerId: number,
  accountId: number,
  amount: number,
  message?: string,
  note?: string,
): Promise<{ success: boolean; message?: string }> {
  amount = Number.parseInt(String(amount));

  if (isNaN(amount)) return { success: false, message: "amount_not_number" };
  if (amount <= 0) return { success: false, message: "invalid_amount" };

  const player = OxPlayer.get(playerId);
  if (!player?.charId) return { success: false, message: "no_charId" };

  const role = await SelectAccountRole(accountId, player.charId);
  if (!(await CanPerformAction(player, accountId, role, "withdraw"))) return { success: false, message: "no_access" };

  const account = await SelectAccount(accountId);
  if (!account) return { success: false, message: "no_balance" };

  const balance = account.balance - amount;
  if (balance < 0) return { success: false, message: "insufficient_balance" };

  const affectedRows = await CDB.updateOne("accounts", { id: accountId }, { balance });

  if (!affectedRows || !exports.ox_inventory.AddItem(playerId, "money", amount)) {
    return { success: false, message: "something_went_wrong" };
  }

  await addTransaction({
    actorId: player.charId,
    fromId: accountId,
    toId: null,
    amount,
    message: message ?? locales("withdraw"),
    note,
    fromBalance: balance,
    toBalance: null,
  });

  emit("ox:withdrewMoney", { playerId, accountId, amount });

  return { success: true };
}

export async function UpdateAccountAccess(
  accountId: number,
  id: number,
  role?: string,
): Promise<{ success: boolean; message?: string }> {
  const success = role
    ? await CDB.update("accounts_access", { accountId, charId: id }, { accountId, charId: id, role }, { upsert: true })
    : await CDB.delete("accounts_access", { accountId, charId: id });

  if (!success) return { success: false, message: "something_went_wrong" };

  return { success: true };
}

export async function UpdateInvoice(
  invoiceId: number,
  charId: number,
): Promise<{ success: boolean; message?: string }> {
  const player = OxPlayer.getFromCharId(charId);

  if (!player?.charId) return { success: false, message: "no_charId" };

  const invoice = await CDB.findOne<{
    id: number;
    amount: number;
    payerId?: number;
    fromAccount: number;
    toAccount: number;
  }>("accounts_invoices", { id: invoiceId });

  if (!invoice) return { success: false, message: "no_invoice" };
  if (invoice.payerId) return { success: false, message: "invoice_paid" };

  const account = await OxAccount.get(invoice.toAccount);
  const hasPermission = await account?.playerHasPermission(player.source as number, "payInvoice");

  if (!hasPermission) return { success: false, message: "no_permission" };

  const updateReceiver = await UpdateBalance(
    invoice.toAccount,
    invoice.amount,
    "remove",
    false,
    locales("invoice_payment"),
    undefined,
    charId,
  );

  if (!updateReceiver.success) return { success: false, message: "no_balance" };

  const updateSender = await UpdateBalance(
    invoice.fromAccount,
    invoice.amount,
    "add",
    false,
    locales("invoice_payment"),
    undefined,
    charId,
  );

  if (!updateSender.success) return { success: false, message: "no_balance" };

  const invoiceUpdated = await CDB.updateOne(
    "accounts_invoices",
    { id: invoiceId },
    { payerId: player.charId, paidAt: Date.now() },
  );

  if (!invoiceUpdated) return { success: false, message: "invoice_not_updated" };

  invoice.payerId = charId;

  emit("ox:invoicePaid", invoice);

  return { success: true };
}

export async function CreateInvoice({
  actorId,
  fromAccount,
  toAccount,
  amount,
  message,
  dueDate,
}: OxCreateInvoice): Promise<{ success: boolean; message?: string }> {
  if (isNaN(amount)) return { success: false, message: "amount_not_number" };
  if (amount <= 0) return { success: false, message: "invalid_amount" };

  if (actorId) {
    const player = OxPlayer.getFromCharId(actorId);

    if (!player?.charId) return { success: false, message: "no_charid" };

    const account = await OxAccount.get(fromAccount);
    const hasPermission = await account?.playerHasPermission(player.source as number, "sendInvoice");

    if (!hasPermission) return { success: false, message: "no_permission" };
  }

  const targetAccount = await OxAccount.get(toAccount);

  if (!targetAccount) return { success: false, message: "no_target_account" };

  const success = await CDB.insertOne(
    "accounts_invoices",
    {
      actorId,
      fromAccount,
      toAccount,
      amount,
      message,
      dueDate: new Date(dueDate).getTime(),
      sentAt: Date.now(),
    },
    "id",
  );

  if (!success) return { success: false, message: "invoice_insert_error" };

  return { success: true };
}

export async function DeleteInvoice(invoiceId: number): Promise<{ success: boolean; message?: string }> {
  const success = await CDB.deleteOne("accounts_invoices", { id: invoiceId });

  if (!success) return { success: false, message: "invoice_delete_error" };

  return { success: true };
}

export async function SetAccountType(accountId: number, type: string): Promise<{ success: boolean; message?: string }> {
  const success = await CDB.updateOne("accounts", { id: accountId }, { type });

  if (!success) return { success: false, message: "update_account_error" };

  return { success: true };
}
