import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [CacheModule],
  controllers: [HealthController],
})
export class HealthModule {}
