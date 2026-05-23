import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type AgentOrmClient = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

export function createOrmClient(connectionUrl: string): AgentOrmClient {
  const pool = new Pool({ connectionString: connectionUrl });
  return drizzle(pool, { schema }) as AgentOrmClient;
}

export { schema };
