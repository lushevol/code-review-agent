import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import "winston-daily-rotate-file";
import { ThrottlerModule } from "@nestjs/throttler";
import { RatanCodeReviewAgentModule } from "./ratan-code-review-agent/ratan-code-review-agent.module";

@Module({
  imports: [
    RatanCodeReviewAgentModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 10,
        },
      ],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `../../.env`,
    }),
  ],
})
export class AppModule {}
