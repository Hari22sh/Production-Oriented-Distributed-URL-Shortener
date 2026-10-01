import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface CachedUrlData {
  originalUrl: string;
  expiresAt?: string | null;
  isActive: boolean;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private readonly defaultTtlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    this.defaultTtlSeconds =
      this.configService.get<number>('redis.ttlSeconds') ?? 86400;
  }

  onModuleInit() {
    const host = this.configService.get<string>('redis.host') || 'localhost';
    const port = this.configService.get<number>('redis.port') || 6379;
    const password = this.configService.get<string>('redis.password');

    this.client = new Redis({
      host,
      port,
      password,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`, err.stack);
    });

    this.client.on('connect', () => {
      this.logger.log(`Connected to Redis at ${host}:${port}`);
    });

    // Attempt initial connection asynchronously
    this.client.connect().catch((err) => {
      this.logger.warn(`Failed to connect to Redis initially: ${err.message}. Operations will fallback to DB.`);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
  }

  public getClient(): Redis {
    return this.client;
  }

  /**
   * Retrieves URL data from Redis cache.
   */
  async get(shortCode: string): Promise<CachedUrlData | null> {
    try {
      const key = this.getCacheKey(shortCode);
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as CachedUrlData;
    } catch (error: any) {
      this.logger.error(`Redis GET error for key ${shortCode}: ${error.message}`);
      return null;
    }
  }

  /**
   * Stores URL data in Redis cache with TTL.
   */
  async set(
    shortCode: string,
    data: CachedUrlData,
    customTtlSeconds?: number
  ): Promise<boolean> {
    try {
      const key = this.getCacheKey(shortCode);
      let ttl = customTtlSeconds ?? this.defaultTtlSeconds;

      // Adjust TTL if URL expires sooner than default TTL
      if (data.expiresAt) {
        const expiresMs = new Date(data.expiresAt).getTime();
        const nowMs = Date.now();
        const remainingSeconds = Math.floor((expiresMs - nowMs) / 1000);

        if (remainingSeconds <= 0) {
          // Already expired, do not cache
          return false;
        }

        ttl = Math.min(ttl, remainingSeconds);
      }

      await this.client.set(key, JSON.stringify(data), 'EX', ttl);
      return true;
    } catch (error: any) {
      this.logger.error(`Redis SET error for key ${shortCode}: ${error.message}`);
      return false;
    }
  }

  /**
   * Invalidates Redis cache key with retry handling.
   */
  async del(shortCode: string, maxRetries = 3): Promise<boolean> {
    const key = this.getCacheKey(shortCode);
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await this.client.del(key);
        this.logger.log(`Successfully invalidated Redis cache key: ${key}`);
        return true;
      } catch (error: any) {
        attempt++;
        this.logger.warn(
          `Attempt ${attempt}/${maxRetries} to delete Redis key ${key} failed: ${error.message}`
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        }
      }
    }

    this.logger.error(
      `Failed to invalidate Redis cache key ${key} after ${maxRetries} attempts`
    );
    return false;
  }

  private getCacheKey(shortCode: string): string {
    return `url:${shortCode}`;
  }
}
