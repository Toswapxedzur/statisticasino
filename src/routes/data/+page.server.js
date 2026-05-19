import { listTables } from "$lib/server/tables.js";

export async function load() {
  const tables = await listTables();
  return { tables };
}
