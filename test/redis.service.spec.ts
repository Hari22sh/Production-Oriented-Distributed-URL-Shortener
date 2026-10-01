import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../src/cache/redis.service';

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: any;

  beforeEach(async () => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key) => {
              if (key === 'redis.ttlSeconds') return 86400;
              if (key === 'redis.host') return 'localhost';
              if (key === 'redis.port') return 6379;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    (service as any).client = mockRedisClient;
  });

  it('should parse and return JSON data on get', async () => {
    const dataPayload = { originalUrl: 'https://example.com', isActive: true };
    mockRedisClient.get.mockResolvedValue(JSON.stringify(dataPayload));

    const result = await service.get('code1');
    expect(result).toEqual(dataPayload);
  });

  it('should return null on cache miss', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const result = await service.get('code1');
    expect(result).toBeNull();
  });

  it('should calculate TTL and store JSON payload on set', async () => {
    mockRedisClient.set.mockResolvedValue('OK');
    const payload = { originalUrl: 'https://example.com', isActive: true };

    const success = await service.set('code1', payload);
    expect(success).toBe(true);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      'url:code1',
      JSON.stringify(payload),
      'EX',
      86400
    );
  });

  it('should invalidate cache key on del', async () => {
    mockRedisClient.del.mockResolvedValue(1);
    const res = await service.del('code1');
    expect(res).toBe(true);
    expect(mockRedisClient.del).toHaveBeenCalledWith('url:code1');
  });

  it('should retry deletion on error up to maxRetries', async () => {
    mockRedisClient.del
      .mockRejectedValueOnce(new Error('Redis timeout'))
      .mockResolvedValueOnce(1);

    const res = await service.del('code1', 3);
    expect(res).toBe(true);
    expect(mockRedisClient.del).toHaveBeenCalledTimes(2);
  });
});
