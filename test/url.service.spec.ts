import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException, GoneException } from '@nestjs/common';
import { UrlService } from '../src/url/url.service';
import { UrlEntity } from '../src/url/entities/url.entity';
import { SnowflakeService } from '../src/id-generator/snowflake.service';
import { Base62Service } from '../src/encoding/base62.service';
import { RedisService } from '../src/cache/redis.service';
import { URL_SAFETY_CHECKER } from '../src/safety/url-safety.interface';

describe('UrlService', () => {
  let service: UrlService;
  let mockUrlRepository: any;
  let mockSnowflakeService: any;
  let mockBase62Service: any;
  let mockRedisService: any;
  let mockUrlSafetyChecker: any;

  beforeEach(async () => {
    mockUrlRepository = {
      findOne: jest.fn(),
      create: jest.fn((entity) => entity),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    mockSnowflakeService = {
      nextId: jest.fn().mockReturnValue(1001n),
    };

    mockBase62Service = {
      encode: jest.fn().mockReturnValue('g8'),
      decode: jest.fn().mockReturnValue(1001n),
    };

    mockRedisService = {
      del: jest.fn().mockResolvedValue(true),
    };

    mockUrlSafetyChecker = {
      validateUrl: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlService,
        { provide: getRepositoryToken(UrlEntity), useValue: mockUrlRepository },
        { provide: SnowflakeService, useValue: mockSnowflakeService },
        { provide: Base62Service, useValue: mockBase62Service },
        { provide: RedisService, useValue: mockRedisService },
        { provide: URL_SAFETY_CHECKER, useValue: mockUrlSafetyChecker },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
      ],
    }).compile();

    service = module.get<UrlService>(UrlService);
  });

  it('should successfully create a new short URL', async () => {
    mockUrlRepository.findOne.mockResolvedValue(null);

    const result = await service.createUrl({
      originalUrl: 'https://example.com/test',
    });

    expect(result.shortCode).toBe('g8');
    expect(result.shortUrl).toBe('http://localhost:3000/g8');
    expect(mockUrlSafetyChecker.validateUrl).toHaveBeenCalledWith('https://example.com/test');
    expect(mockSnowflakeService.nextId).toHaveBeenCalled();
    expect(mockBase62Service.encode).toHaveBeenCalledWith(1001n);
    expect(mockUrlRepository.save).toHaveBeenCalled();
  });

  it('should return existing short code when creating duplicate URL (deduplication)', async () => {
    const existingEntity: Partial<UrlEntity> = {
      id: '1001',
      shortCode: 'g8',
      originalUrl: 'https://example.com/test',
      isActive: true,
      expiresAt: null,
    };
    mockUrlRepository.findOne.mockResolvedValue(existingEntity);

    const result = await service.createUrl({
      originalUrl: 'https://example.com/test',
    });

    expect(result.shortCode).toBe('g8');
    expect(mockSnowflakeService.nextId).not.toHaveBeenCalled();
  });

  it('should handle database duplicate key error during race conditions', async () => {
    mockUrlRepository.findOne.mockResolvedValueOnce(null); // Initial check returns null

    const duplicateError = new Error('duplicate key value violates unique constraint') as any;
    duplicateError.code = '23505';
    mockUrlRepository.save.mockRejectedValueOnce(duplicateError);

    const racedEntity: Partial<UrlEntity> = {
      id: '1001',
      shortCode: 'racedCode',
      originalUrl: 'https://example.com/test',
      isActive: true,
      expiresAt: null,
    };
    mockUrlRepository.findOne.mockResolvedValueOnce(racedEntity); // Second fetch returns raced record

    const result = await service.createUrl({
      originalUrl: 'https://example.com/test',
    });

    expect(result.shortCode).toBe('racedCode');
  });

  it('should throw BadRequestException for past expiration date', async () => {
    await expect(
      service.createUrl({
        originalUrl: 'https://example.com/test',
        expiresAt: '2020-01-01T00:00:00Z',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('should deactivate URL and clear Redis cache on deleteUrl', async () => {
    const entity: Partial<UrlEntity> = {
      shortCode: 'g8',
      isActive: true,
    };
    mockUrlRepository.findOne.mockResolvedValue(entity);

    const res = await service.deleteUrl('g8');

    expect(res.success).toBe(true);
    expect(entity.isActive).toBe(false);
    expect(mockRedisService.del).toHaveBeenCalledWith('g8');
  });

  it('should throw NotFoundException when deleting non-existent URL', async () => {
    mockUrlRepository.findOne.mockResolvedValue(null);

    await expect(service.deleteUrl('nonexistent')).rejects.toThrow(NotFoundException);
  });
});
