import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly windowSeconds: number;
  private readonly maxRequests: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService
  ) {
    this.windowSeconds = this.configService.get<number>('rateLimit.windowSeconds') ?? 60;
    this.maxRequests = this.configService.get<number>('rateLimit.maxRequests') ?? 30;
  }

  async isRateLimited(identifier: string): Promise<{ limited: boolean; remaining: number }> {
    try {
      const redis = this.redisService.getClient();
      if (!redis || redis.status !== 'ready') {
        // Fallback if Redis is down
        return { limited: false, remaining: this.maxRequests };
      }

      const key = `ratelimit:${identifier}`;
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, this.windowSeconds);
      }

      if (count > this.maxRequests) {
        return { limited: true, remaining: 0 };
      }

      return { limited: false, remaining: this.maxRequests - count };
    } catch (error: any) {
      this.logger.error(`RateLimit error for ${identifier}: ${error.message}`);
      return { limited: false, remaining: this.maxRequests };
    }
  }
}
