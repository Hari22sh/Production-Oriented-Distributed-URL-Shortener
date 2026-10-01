import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer } from 'kafkajs';
import { ClickEventDto } from './dto/click-event.dto';

@Injectable()
export class KafkaConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumer.name);
  private kafka!: Kafka;
  private consumer!: Consumer;
  private isConnected = false;
  private readonly enabled: boolean;
  private readonly topic: string;
  private readonly groupId: string;

  // In-memory stats counter for analytics demonstration
  private readonly clickCounts = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('kafka.enabled') ?? true;
    this.topic =
      this.configService.get<string>('kafka.clickTopic') || 'url-click-events';
    this.groupId =
      this.configService.get<string>('kafka.groupId') || 'url-shortener-group';
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Kafka consumer is disabled via configuration.');
      return;
    }

    const brokers = this.configService.get<string[]>('kafka.brokers') || ['localhost:9092'];
    const clientId = `${this.configService.get<string>('kafka.clientId')}-consumer`;

    this.kafka = new Kafka({
      clientId,
      brokers,
    });

    this.consumer = this.kafka.consumer({ groupId: this.groupId });

    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });
      this.isConnected = true;

      this.logger.log(`Kafka Consumer connected and subscribed to topic: ${this.topic}`);

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          if (!message.value) return;
          try {
            const clickEvent: ClickEventDto = JSON.parse(message.value.toString());
            this.handleClickEvent(clickEvent);
          } catch (err: any) {
            this.logger.error(`Error parsing Kafka click event: ${err.message}`);
          }
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to connect Kafka Consumer: ${error.message}`);
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.consumer && this.isConnected) {
      await this.consumer.disconnect().catch(() => {});
    }
  }

  private handleClickEvent(event: ClickEventDto) {
    const current = this.clickCounts.get(event.shortCode) || 0;
    const updated = current + 1;
    this.clickCounts.set(event.shortCode, updated);

    this.logger.log(
      `[Kafka Consumer Processed] Click on shortCode '${event.shortCode}' (Total clicks: ${updated}). IP: ${event.ip}`
    );
  }

  public getStats(shortCode: string): number {
    return this.clickCounts.get(shortCode) || 0;
  }
}
