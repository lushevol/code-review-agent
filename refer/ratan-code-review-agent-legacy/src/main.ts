import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as CookieParser from "cookie-parser";
import { WinstonModule } from "nest-winston";
import { format, transports } from "winston";
import { AppModule } from "./app.module";
import "winston-daily-rotate-file";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    snapshot: true,
    logger: WinstonModule.createLogger({
      transports: [
        // file on daily rotation (error only)
        new transports.DailyRotateFile({
          // %DATE will be replaced by the current date
          filename: `logs/%DATE%-error.log`,
          level: "error",
          format: format.combine(format.timestamp(), format.json()),
          datePattern: "YYYY-MM-DD",
          zippedArchive: false, // don't want to zip our logs
          maxFiles: "30d", // will keep log until they are older than 30 days
        }),
        // same for all levels
        new transports.DailyRotateFile({
          filename: `logs/%DATE%-combined.log`,
          format: format.combine(format.timestamp(), format.json()),
          datePattern: "YYYY-MM-DD",
          zippedArchive: false,
          maxFiles: "30d",
        }),
        new transports.Console({
          format: format.combine(
            format.cli(),
            format.splat(),
            format.timestamp(),
            format.printf((info) => {
              return `${info.timestamp} ${info.level}: ${info.message}`;
            }),
          ),
        }),
      ],
    }),
  });
  app.useGlobalPipes(new ValidationPipe());
  app.use(CookieParser());

  await app.listen(1215, "0.0.0.0");
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
