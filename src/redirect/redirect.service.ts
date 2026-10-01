import {
  Injectable,
  Logger,
  NotFoundException,
  GoneException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UrlEntity } from "../url/entities/url.entity";
import { RedisService, CachedUrlData } from "../cache/redis.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { SingleFlight } from "../common/utils/single-flight";

@Injectable()
export class RedirectService {
  private readonly logger = new Logger(RedirectService.name);
  private readonly singleFlight = new SingleFlight();

  constructor(
    @InjectRepository(UrlEntity)
    private readonly urlRepository: Repository<UrlEntity>,
    private readonly redisService: RedisService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  /**
   * Resolves a shortCode to its destination originalUrl.
   * Uses Redis Cache-Aside, SingleFlight request coalescing for stampede protection,
   * expiration validation, and async Kafka click event recording.
   */
  async resolveRedirect(
    shortCode: string,
    ip?: string,
    userAgent?: string,
    referrer?: string,
  ): Promise<string> {
    // 1. Check Redis Cache
    const cachedData = await this.redisService.get(shortCode);

    if (cachedData) {
      this.logger.debug(`Cache HIT for shortCode: '${shortCode}'`);

      // Validate cached expiration & active status
      this.validateUrlStatus(
        shortCode,
        cachedData.expiresAt,
        cachedData.isActive,
      );

      // 2. Asynchronously publish click event to Kafka (non-blocking)
      this.analyticsService.recordClick(
        shortCode,
        cachedData.originalUrl,
        ip,
        userAgent,
        referrer,
      );

      return cachedData.originalUrl;
    }

    this.logger.debug(
      `Cache MISS for shortCode: '${shortCode}'. Fetching from PostgreSQL with SingleFlight.`,
    );

    // 3. Cache Miss: Coalesce DB queries using SingleFlight to prevent Cache Stampede
    const urlData = await this.singleFlight.do(
      `fetch:${shortCode}`,
      async () => {
        // Re-check Redis inside single-flight in case a concurrent request already populated cache
        const rechecked = await this.redisService.get(shortCode);
        if (rechecked) {
          return rechecked;
        }

        const entity = await this.urlRepository.findOne({
          where: { shortCode },
        });

        if (!entity || !entity.isActive) {
          throw new NotFoundException(
            `Short code '${shortCode}' not found or deactivated`,
          );
        }

        const expiresAtIso = entity.expiresAt
          ? entity.expiresAt.toISOString()
          : null;
        this.validateUrlStatus(shortCode, expiresAtIso, entity.isActive);

        const cachePayload: CachedUrlData = {
          originalUrl: entity.originalUrl,
          expiresAt: expiresAtIso,
          isActive: entity.isActive,
        };

        // Populate Redis Cache asynchronously
        await this.redisService.set(shortCode, cachePayload);

        return cachePayload;
      },
    );

    // 4. Record click analytics asynchronously
    this.analyticsService.recordClick(
      shortCode,
      urlData.originalUrl,
      ip,
      userAgent,
      referrer,
    );

    return urlData.originalUrl;
  }

  private validateUrlStatus(
    shortCode: string,
    expiresAt?: string | null,
    isActive?: boolean,
  ): void {
    if (isActive === false) {
      throw new NotFoundException(`Short code '${shortCode}' is deactivated`);
    }

    if (expiresAt) {
      const expiresMs = new Date(expiresAt).getTime();
      if (!isNaN(expiresMs) && expiresMs <= Date.now()) {
        // Asynchronously clear expired cache key
        this.redisService.del(shortCode).catch(() => {});
        throw new GoneException(`Short code '${shortCode}' has expired`);
      }
    }
  }
}
