import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  GoneException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { UrlEntity } from "./entities/url.entity";
import { CreateUrlDto } from "./dto/create-url.dto";
import { UrlResponseDto } from "./dto/url-response.dto";
import { SnowflakeService } from "../id-generator/snowflake.service";
import { Base62Service } from "../encoding/base62.service";
import { RedisService } from "../cache/redis.service";
import {
  URL_SAFETY_CHECKER,
  UrlSafetyChecker,
} from "../safety/url-safety.interface";

@Injectable()
export class UrlService {
  private readonly logger = new Logger(UrlService.name);
  private readonly baseUrl: string;

  constructor(
    @InjectRepository(UrlEntity)
    private readonly urlRepository: Repository<UrlEntity>,
    private readonly snowflakeService: SnowflakeService,
    private readonly base62Service: Base62Service,
    private readonly redisService: RedisService,
    @Inject(URL_SAFETY_CHECKER)
    private readonly urlSafetyChecker: UrlSafetyChecker,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl =
      this.configService.get<string>("baseUrl") || "http://localhost:3000";
  }

  /**
   * Shortens a URL using Snowflake ID generation, Base62 encoding, and DB deduplication.
   */
  async createUrl(dto: CreateUrlDto): Promise<UrlResponseDto> {
    await this.urlSafetyChecker.validateUrl(dto.originalUrl);

    let expiresAtDate: Date | null = null;
    if (dto.expiresAt) {
      expiresAtDate = new Date(dto.expiresAt);
      if (isNaN(expiresAtDate.getTime())) {
        throw new BadRequestException("Invalid expiresAt date format");
      }
      if (expiresAtDate.getTime() <= Date.now()) {
        throw new BadRequestException("Expiration time must be in the future");
      }
    }

    // 1. Deduplication check: return existing active, non-expired URL mapping
    const existing = await this.urlRepository.findOne({
      where: { originalUrl: dto.originalUrl, isActive: true },
    });

    if (existing) {
      const isExpired =
        existing.expiresAt && existing.expiresAt.getTime() <= Date.now();
      if (!isExpired) {
        return this.formatResponse(existing.shortCode, existing.expiresAt);
      }
    }

    // 2. Generate Snowflake ID & Base62 encoding
    const numericId = this.snowflakeService.nextId();
    const shortCode = this.base62Service.encode(numericId);

    const urlEntity = this.urlRepository.create({
      id: numericId.toString(),
      shortCode,
      originalUrl: dto.originalUrl,
      expiresAt: expiresAtDate,
      isActive: true,
    });

    try {
      await this.urlRepository.save(urlEntity);
      this.logger.log(
        `Created short URL: shortCode=${shortCode}, originalUrl=${dto.originalUrl}`,
      );

      return this.formatResponse(shortCode, expiresAtDate);
    } catch (error: any) {
      // Catch duplicate key constraint violation (PostgreSQL 23505) under race conditions
      if (error.code === "23505" || error.message?.includes("duplicate key")) {
        this.logger.warn(
          `Concurrent insert collision for originalUrl '${dto.originalUrl}'. Fetching existing record.`,
        );
        const racedRecord = await this.urlRepository.findOne({
          where: { originalUrl: dto.originalUrl },
        });

        if (racedRecord && racedRecord.isActive) {
          return this.formatResponse(
            racedRecord.shortCode,
            racedRecord.expiresAt,
          );
        }
      }
      throw error;
    }
  }

  /**
   * Retrieves URL record details by shortCode.
   */
  async getUrlByShortCode(shortCode: string): Promise<UrlEntity> {
    const urlRecord = await this.urlRepository.findOne({
      where: { shortCode },
    });

    if (!urlRecord || !urlRecord.isActive) {
      throw new NotFoundException(
        `Short code '${shortCode}' not found or deactivated`,
      );
    }

    if (urlRecord.expiresAt && urlRecord.expiresAt.getTime() <= Date.now()) {
      throw new GoneException(`Short code '${shortCode}' has expired`);
    }

    return urlRecord;
  }

  /**
   * Deactivates/Deletes a short URL record and invalidates Redis cache.
   */
  async deleteUrl(
    shortCode: string,
  ): Promise<{ success: boolean; message: string }> {
    const urlRecord = await this.urlRepository.findOne({
      where: { shortCode },
    });

    if (!urlRecord || !urlRecord.isActive) {
      throw new NotFoundException(
        `Short code '${shortCode}' not found or already deactivated`,
      );
    }

    // 1. Soft delete in DB
    urlRecord.isActive = false;
    await this.urlRepository.save(urlRecord);

    // 2. Invalidate Redis key
    await this.redisService.del(shortCode);

    this.logger.log(
      `Deactivated short code '${shortCode}' and invalidated Redis cache.`,
    );
    return {
      success: true,
      message: `Short code '${shortCode}' deactivated successfully`,
    };
  }

  private formatResponse(
    shortCode: string,
    expiresAt?: Date | null,
  ): UrlResponseDto {
    return {
      shortCode,
      shortUrl: `${this.baseUrl}/${shortCode}`,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    };
  }
}
