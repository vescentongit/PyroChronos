import { Prisma, PrismaClient } from "@prisma/client";
import { getDb } from "./db";
import type { Sql } from "./research-store";

function adapter(client: Prisma.TransactionClient | PrismaClient): Sql {
  return {
    async query(sql, params = []) {
      return client.$queryRawUnsafe(sql, ...params) as Promise<Record<string, any>[]>;
    },
    async transaction(fn) {
      if (!("$transaction" in client)) throw new Error("Nested transactions are unsupported");
      return client.$transaction(tx => fn(adapter(tx)));
    },
  };
}
export const researchDb = () => adapter(getDb());
