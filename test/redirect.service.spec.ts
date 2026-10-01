import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, GoneException } from '@nestjs/common';
import { RedirectService } from '../src/redirect/redirect.service';
import { UrlEntity } from '../src/url/entities/url.entity';
import { RedisService } from '../src/cache/redis.service';
import { AnalyticsService } from '../src/analytics/analytics.service';

describe('RedirectService', () => {
  let service: RedirectService;
  let mockUrlRepository: any;
  let mockRedisService: any;
  let mockAnalyticsService: any;

  beforeEach(async () => {
    mockUrlRepository = {
      findOne: jest.fn(),
    };

    mockRedisService = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(true),
      del: jest.fn().mockResolvedValue(true),
    };

    mockAnalyticsService = {
      recordClick: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedirectService,
        { provide: getRepositoryToken(UrlEntity), useValue: mockUrlRepository },
        { provide: RedisService, useValue: mockRedisService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
      ],
    }).compile();

    service = module.get<RedirectService>(RedirectService);
  });

  it('should return destination URL on Redis HIT without querying PostgreSQL', async () => {
    mockRedisService.get.mockResolvedValue({
      originalUrl: 'https://example.com/cached',
      isActive: true,
      expiresAt: null,
    });

    const target = await service.resolveRedirect('a8Kd2');

    expect(target).toBe('https://example.com/cached');
    expect(mockRedisService.get).toHaveBeenCalledWith('a8Kd2');
    expect(mockUrlRepository.findOne).not.toHaveBeenCalled();
    expect(mockAnalyticsService.recordClick).toHaveBeenCalledWith(
      'a8Kd2',
      'https://example.com/cached',
      undefined,
      undefined,
      undefined
    );
  });

  it('should query PostgreSQL on Redis MISS and populate Redis cache', async () => {
    mockRedisService.get.mockResolvedValue(null);

    const dbEntity: Partial<UrlEntity> = {
      shortCode: 'a8Kd2',
      originalUrl: 'https://example.com/db',
      isActive: true,
      expiresAt: null,
    };
    mockUrlRepository.findOne.mockResolvedValue(dbEntity);

    const target = await service.resolveRedirect('a8Kd2');

    expect(target).toBe('https://example.com/db');
    expect(mockUrlRepository.findOne).toHaveBeenCalledWith({
      where: { shortCode: 'a8Kd2' },
    });
    expect(mockRedisService.set).toHaveBeenCalledWith('a8Kd2', {
      originalUrl: 'https://example.com/db',
      expiresAt: null,
      isActive: true,
    });
    expect(mockAnalyticsService.recordClick).toHaveBeenCalled();
  });

  it('should throw GoneException when resolving expired URL', async () => {
    const expiredDate = new Date(Date.now() - 10000).toISOString();
    mockRedisService.get.mockResolvedValue({
      originalUrl: 'https://example.com/expired',
      isActive: true,
      expiresAt: expiredDate,
    });

    await expect(service.resolveRedirect('expiredCode')).rejects.toThrow(GoneException);
  });

  it('should throw NotFoundException when resolving deactivated URL', async () => {
    mockRedisService.get.mockResolvedValue({
      originalUrl: 'https://example.com/inactive',
      isActive: false,
      expiresAt: null,
    });

    await expect(service.resolveRedirect('inactiveCode')).rejects.toThrow(NotFoundException);
  });

  it('should coalesce concurrent requests using SingleFlight on cache miss', async () => {
    mockRedisService.get.mockResolvedValue(null);

    const dbEntity: Partial<UrlEntity> = {
      shortCode: 'coalesceTest',
      originalUrl: 'https://example.com/coalesce',
      isActive: true,
      expiresAt: null,
    };
    mockUrlRepository.findOne.mockResolvedValue(dbEntity);

    // Call resolveRedirect 10 times concurrently
    const promises = Array.from({ length: 10 }, () =>
      service.resolveRedirect('coalesceTest')
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(10);
    results.forEach((url) => expect(url).toBe('https://example.com/coalesce'));
    // Verify PostgreSQL was queried only ONCE despite 10 concurrent requests!
    expect(mockUrlRepository.findOne).toHaveBeenCalledTimes(1);
  });
});
