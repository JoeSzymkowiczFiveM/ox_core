import type { Dict, OxAccountPermissions, OxLicense, OxStatus } from "types";

declare const exports: any;

type Query = Dict<any>;

type ChiliadFindOptions = {
  limit?: number;
  excludeIndexes?: boolean;
  excludeFields?: Dict<boolean>;
  includeFields?: Dict<boolean>;
  sort?: { field: string; order?: "asc" | "desc" };
};

const COLLECTIONS = [
  "users",
  "characters",
  "user_tokens",
  "banned_users",
  "ox_statuses",
  "ox_licenses",
  "character_licenses",
  "ox_groups",
  "character_groups",
  "accounts",
  "accounts_access",
  "accounts_transactions",
  "accounts_invoices",
  "vehicles",
] as const;

let readyPromise: Promise<void> | undefined;

const defaultStatuses: OxStatus[] = [
  { name: "hunger", default: 0, onTick: 0.02 },
  { name: "thirst", default: 0, onTick: 0.05 },
  { name: "stress", default: 0, onTick: -0.1 },
];

const defaultLicenses: OxLicense[] = [
  { name: "weapon", label: "Weapon License" },
  { name: "driver", label: "Driver's License" },
];

export const defaultAccountRoles: (OxAccountPermissions & { name: string; id: number })[] = [
  {
    id: 1,
    name: "viewer",
    deposit: false,
    withdraw: false,
    addUser: false,
    removeUser: false,
    manageUser: false,
    transferOwnership: false,
    viewHistory: false,
    manageAccount: false,
    closeAccount: false,
    sendInvoice: false,
    payInvoice: false,
  },
  {
    id: 2,
    name: "contributor",
    deposit: true,
    withdraw: false,
    addUser: false,
    removeUser: false,
    manageUser: false,
    transferOwnership: false,
    viewHistory: false,
    manageAccount: false,
    closeAccount: false,
    sendInvoice: false,
    payInvoice: false,
  },
  {
    id: 3,
    name: "manager",
    deposit: true,
    withdraw: true,
    addUser: true,
    removeUser: true,
    manageUser: true,
    transferOwnership: false,
    viewHistory: true,
    manageAccount: true,
    closeAccount: false,
    sendInvoice: true,
    payInvoice: true,
  },
  {
    id: 4,
    name: "owner",
    deposit: true,
    withdraw: true,
    addUser: true,
    removeUser: true,
    manageUser: true,
    transferOwnership: true,
    viewHistory: true,
    manageAccount: true,
    closeAccount: true,
    sendInvoice: true,
    payInvoice: true,
  },
];

function cdb() {
  return exports.chiliaddb;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}

async function waitUntilLoaded() {
  while (GetResourceState("chiliaddb") !== "started" || !cdb()?.loaded()) {
    await wait(50);
  }
}

async function ensureCollection(collection: string) {
  if (!cdb().collectionExists(collection)) cdb().createCollection(collection);
}

async function seedStaticData() {
  for (const status of defaultStatuses) {
    cdb().update({
      collection: "ox_statuses",
      query: { name: status.name },
      update: status,
      options: { upsert: true },
    });
  }

  for (const license of defaultLicenses) {
    cdb().update({
      collection: "ox_licenses",
      query: { name: license.name },
      update: license,
      options: { upsert: true },
    });
  }
}

async function ensureIndexes() {
  const indexes: { collection: string; fields: string[]; unique?: boolean }[] = [
    { collection: "users", fields: ["license2"] },
    { collection: "characters", fields: ["stateId"], unique: true },
    { collection: "characters", fields: ["userId"] },
    { collection: "character_groups", fields: ["charId", "name"], unique: true },
    { collection: "character_licenses", fields: ["charId", "name"], unique: true },
    { collection: "accounts", fields: ["owner"] },
    { collection: "accounts", fields: ["group"] },
    { collection: "accounts_access", fields: ["accountId", "charId"], unique: true },
    { collection: "vehicles", fields: ["plate"], unique: true },
    { collection: "vehicles", fields: ["vin"], unique: true },
    { collection: "user_tokens", fields: ["userId", "token"], unique: true },
    { collection: "banned_users", fields: ["userId"], unique: true },
  ];

  for (const index of indexes) cdb().ensureIndex(index);
}

export async function Ready() {
  readyPromise ??= (async () => {
    await waitUntilLoaded();
    for (const collection of COLLECTIONS) await ensureCollection(collection);
    await ensureIndexes();
    await seedStaticData();
    console.log("^2ChiliadDB datastore connection established for ox_core!^0");
  })();

  return readyPromise;
}

export function formatDate(value?: string | number | Date) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export const CDB = {
  async find<T = any>(collection: string, query?: Query, options?: ChiliadFindOptions): Promise<T[]> {
    await Ready();
    const result = cdb().find({ collection, query, options: { excludeIndexes: true, ...options } });
    if (!result || result === false) return [];
    return Array.isArray(result) ? result : Object.values(result);
  },

  async findRaw<T = any>(collection: string, query?: Query, options?: ChiliadFindOptions): Promise<Record<number, T>> {
    await Ready();
    const result = cdb().find({ collection, query, options });
    return result && result !== false ? result : {};
  },

  async findOne<T = any>(collection: string, query?: Query, options?: ChiliadFindOptions): Promise<T | null> {
    await Ready();
    const result = cdb().findOne({ collection, query, options });
    return result && result !== false ? result : null;
  },

  async exists(collection: string, query: Query): Promise<boolean> {
    await Ready();
    return cdb().exists({ collection, query }) === true;
  },

  async insertOne<T extends Dict<any>>(collection: string, document: T, selfInsertId?: string | string[]) {
    await Ready();
    return cdb().insertOne({ collection, document, options: selfInsertId ? { selfInsertId } : undefined }) as
      | number
      | false;
  },

  async update(collection: string, query: Query, update: Query, options?: Query): Promise<number> {
    await Ready();
    const result = cdb().update({ collection, query, update, options });
    return Array.isArray(result) ? result.length : result ? 1 : 0;
  },

  async updateOne(collection: string, query: Query, update: Query): Promise<boolean> {
    await Ready();
    return !!cdb().updateOne({ collection, query, update });
  },

  async replaceOne(collection: string, query: Query, document: Query): Promise<boolean> {
    await Ready();
    return !!cdb().replaceOne({ collection, query, document });
  },

  async delete(collection: string, query: Query): Promise<number> {
    await Ready();
    const result = cdb().delete({ collection, query });
    return Array.isArray(result) ? result.length : result ? 1 : 0;
  },

  async deleteOne(collection: string, query: Query): Promise<boolean> {
    await Ready();
    return !!cdb().deleteOne({ collection, query });
  },
};

Ready();
