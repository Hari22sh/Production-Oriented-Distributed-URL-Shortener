import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UrlEntity } from './entities/url.entity';
import { UrlService } from './url.service';
import { UrlController } from './url.controller';
import { IdGeneratorModule } from '../id-generator/id-generator.module';
import { EncodingModule } from '../encoding/encoding.module';
import { CacheModule } from '../cache/cache.module';
import { SafetyModule } from '../safety/safety.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UrlEntity]),
    IdGeneratorModule,
    EncodingModule,
    CacheModule,
    SafetyModule,
    RateLimitModule,
    AnalyticsModule,
  ],
  controllers: [UrlController],
  providers: [UrlService],
  exports: [UrlService],
})
export class UrlModule {}
