import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { ClickEventDto } from './dto/click-event.dto';

@Injectable()
export class KafkaProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducer.name);
  private kafka!: Kafka;
  private producer!: Producer;
  private isConnected = false;
  private readonly enabled: boolean;
  private readonly topic: string;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('kafka.enabled') ?? true;
    this.topic = this.configService.get<string>('kafka.clickTopic') || 'url-click-events';
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Kafka producer is disabled via configuration.');
      return;
    }

    const brokers = this.configService.get<string[]>('kafka.brokers') || ['localhost:9092'];
    const clientId = this.configService.get<string>('kafka.clientId') || 'url-shortener-service';

    this.kafka = new Kafka({
      clientId,
      brokers,
      retry: {
        retries: 3,
        initialRetryTime: 300,
      },
    });

    this.producer = this.kafka.producer();

    try {
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log(`Kafka Producer connected to brokers: ${brokers.join(', ')}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to connect Kafka Producer: ${error.message}. Events will log fallback.`
      );
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.producer && this.isConnected) {
      await this.producer.disconnect().catch(() => {});
    }
  }

  async sendClickEvent(event: ClickEventDto): Promise<boolean> {
    if (!this.enabled || !this.isConnected) {
      this.logger.log(
        `[Kafka Disabled/Fallback] Click Event: shortCode=${event.shortCode}, timestamp=${event.timestamp}`
      );
      return false;
    }

    try {
      await this.producer.send({
        topic: this.topic,
        messages: [
          {
            key: event.shortCode,
            value: JSON.stringify(event),
            timestamp: Date.now().toString(),
          },
        ],
      });
      return true;
    } catch (error: any) {
      this.logger.error(
        `Failed to send Kafka click event for shortCode ${event.shortCode}: ${error.message}`
      );
      return false;
    }
  }
}
