import { Pool } from "pg";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://localhost:5432/ainext_poc",
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;
