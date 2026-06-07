import { CDB } from '../db/chiliaddb';
import type { VehicleProperties } from '@overextended/ox_lib';
import { DEFAULT_VEHICLE_STORE } from 'config';

export type VehicleRow = {
  id: number;
  owner?: number;
  group?: string;
  plate: string;
  vin: string;
  model: string;
  data: { properties?: Partial<VehicleProperties> | string; [key: string]: any } | string;
};

if (DEFAULT_VEHICLE_STORE)
  setImmediate(() => CDB.update('vehicles', { stored: null }, { stored: DEFAULT_VEHICLE_STORE }));

export async function IsPlateAvailable(plate: string) {
  return !(await CDB.exists('vehicles', { plate }));
}

export async function IsVinAvailable(plate: string) {
  return !(await CDB.exists('vehicles', { vin: plate }));
}

export async function GetStoredVehicleFromId(id: number | string, column = 'id') {
  const row = await CDB.findOne<VehicleRow & { stored?: string | null }>('vehicles', { [column]: id });

  if (!row?.stored || !row.data) return null;

  return row as VehicleRow & { stored?: string };
}

export async function SetVehicleColumn(id: number | void, column: string, value: any) {
  if (!id) return;

  return CDB.updateOne('vehicles', { id }, { [column]: value });
}

function saveOneVehicle(values: any[]) {
  const [stored, data, id] = values;
  return CDB.updateOne('vehicles', { id }, { stored, data });
}

export function SaveVehicleData(values: any, batch?: boolean) {
  return batch ? Promise.all((values as any[][]).map(saveOneVehicle)) : saveOneVehicle(values as any[]);
}

export async function CreateNewVehicle(
  plate: string,
  vin: string,
  owner: number | null,
  group: string | null,
  model: string,
  vehicleClass: number,
  data: object,
  stored: string | null,
) {
  const id = await CDB.insertOne(
    'vehicles',
    { plate, vin, owner, group, model, class: vehicleClass, data, stored },
    'id',
  );
  if (!id) throw new Error(`Failed to create vehicle ${plate}/${vin}`);
  return id;
}

export async function DeleteVehicle(id: number) {
  return CDB.deleteOne('vehicles', { id });
}
