import { Injectable, Logger } from '@nestjs/common';
import { KafkaProducer } from './kafka.producer';
import { KafkaConsumer } from './kafka.consumer';
import { ClickEventDto } from './dto/click-event.dto';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly kafkaProducer: KafkaProducer,
    private readonly kafkaConsumer: KafkaConsumer
  ) {}

  /**
   * Asynchronously publishes a click event to Kafka.
   * Guaranteed not to throw or block the redirect path.
   */
  async recordClick(
    shortCode: string,
    originalUrl: string,
    rawIp?: string,
    userAgent?: string,
    referrer?: string
  ): Promise<void> {
    try {
      const anonymizedIp = this.anonymizeIp(rawIp);
      const event: ClickEventDto = {
        shortCode,
        originalUrl,
        timestamp: new Date().toISOString(),
        userAgent,
        referrer,
        ip: anonymizedIp,
      };

      // Fire-and-forget async event publishing
      this.kafkaProducer.sendClickEvent(event).catch((err) => {
        this.logger.error(`Async click recording error: ${err.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Failed to construct click event: ${error.message}`);
    }
  }

  /**
   * Retrieves accumulated click stats from the consumer (demonstration feature).
   */
  getClickStats(shortCode: string): { shortCode: string; totalClicks: number } {
    const totalClicks = this.kafkaConsumer.getStats(shortCode);
    return { shortCode, totalClicks };
  }

  /**
   * Anonymizes IP address for data privacy compliance.
   * IPv4: 192.168.1.100 -> 192.168.1.xxx
   * IPv6: 2001:db8:85a3::8a2e:370:7334 -> 2001:db8:85a3::xxxx
   */
  private anonymizeIp(ip?: string): string {
    if (!ip) return '0.0.0.0';
    if (ip.includes('.')) {
      const parts = ip.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
      }
    }
    if (ip.includes(':')) {
      const parts = ip.split(':');
      if (parts.length > 3) {
        return `${parts.slice(0, 3).join(':')}::xxxx`;
      }
    }
    return 'xxx.xxx.xxx.xxx';
  }
}
