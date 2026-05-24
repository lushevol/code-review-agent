import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./db/schema";

config({ path: "../../.env" });

export const createOrmClient = (connectionString: string) => {
  const pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
  });
  return drizzle(pool, { schema, logger: false });
};

export default createOrmClient(process.env.DATABASE_URL!);
