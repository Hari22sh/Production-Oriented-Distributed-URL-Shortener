import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { KafkaProducer } from './kafka.producer';
import { KafkaConsumer } from './kafka.consumer';

@Module({
  providers: [AnalyticsService, KafkaProducer, KafkaConsumer],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
