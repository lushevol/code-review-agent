import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "ratan-orm";
import { DrizzleService } from "./drizzle.service";
@Global()
@Module({
  providers: [
    {
      provide: "DRIZZLE_ORM",
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connectionString = configService.get<string>("DATABASE_URL");
        const pool = new Pool({
          connectionString,
          ssl: {
            rejectUnauthorized: false, // Adjust based on your SSL requirements
          },
        });
        return drizzle(pool, { schema, logger: false });
      },
    },
    DrizzleService,
  ],
  exports: [DrizzleService],
})
export class DrizzleModule {}
