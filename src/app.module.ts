import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import configuration from "./config/configuration";
import { UrlEntity } from "./url/entities/url.entity";
import { UrlModule } from "./url/url.module";
import { RedirectModule } from "./redirect/redirect.module";
import { HealthModule } from "./health/health.module";
import { RateLimitModule } from "./rate-limit/rate-limit.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { CacheModule } from "./cache/cache.module";
import { IdGeneratorModule } from "./id-generator/id-generator.module";
import { EncodingModule } from "./encoding/encoding.module";
import { SafetyModule } from "./safety/safety.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        host: configService.get<string>("database.host"),
        port: configService.get<number>("database.port"),
        username: configService.get<string>("database.username"),
        password: configService.get<string>("database.password"),
        database: configService.get<string>("database.database"),
        entities: [UrlEntity],
        synchronize: true, // Auto-sync DB schema in dev mode
        logging: false,
      }),
    }),
    CacheModule,
    IdGeneratorModule,
    EncodingModule,
    SafetyModule,
    RateLimitModule,
    AnalyticsModule,
    UrlModule,
    RedirectModule,
    HealthModule,
  ],
})
export class AppModule {}
