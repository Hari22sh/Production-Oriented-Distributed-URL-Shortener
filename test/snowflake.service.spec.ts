import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SnowflakeService, ClockMovedBackwardsException } from '../src/id-generator/snowflake.service';

describe('SnowflakeService', () => {
  let service: SnowflakeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SnowflakeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(1),
          },
        },
      ],
    }).compile();

    service = module.get<SnowflakeService>(SnowflakeService);
    service.onModuleInit();
  });

  it('should generate a valid bigint ID', () => {
    const id = service.nextId();
    expect(typeof id).toBe('bigint');
    expect(id).toBeGreaterThan(0n);
  });

  it('should generate strictly unique IDs in rapid sequential calls', () => {
    const ids = new Set<bigint>();
    const count = 10000;
    for (let i = 0; i < count; i++) {
      ids.add(service.nextId());
    }
    expect(ids.size).toBe(count);
  });

  it('should generate unique IDs concurrently', async () => {
    const count = 1000;
    const promises = Array.from({ length: count }, () =>
      Promise.resolve(service.nextId())
    );
    const results = await Promise.all(promises);
    const uniqueIds = new Set(results);
    expect(uniqueIds.size).toBe(count);
  });

  it('should handle sequence rollover in the same millisecond', () => {
    const ids = new Set<bigint>();
    // Force many calls in immediate loop
    for (let i = 0; i < 5000; i++) {
      ids.add(service.nextId());
    }
    expect(ids.size).toBe(5000);
  });

  it('should generate different IDs for different worker IDs', async () => {
    const module1: TestingModule = await Test.createTestingModule({
      providers: [
        SnowflakeService,
        {
          provide: ConfigService,
          useValue: { get: () => 1 },
        },
      ],
    }).compile();

    const module2: TestingModule = await Test.createTestingModule({
      providers: [
        SnowflakeService,
        {
          provide: ConfigService,
          useValue: { get: () => 2 },
        },
      ],
    }).compile();

    const service1 = module1.get<SnowflakeService>(SnowflakeService);
    const service2 = module2.get<SnowflakeService>(SnowflakeService);

    service1.onModuleInit();
    service2.onModuleInit();

    const id1 = service1.nextId();
    const id2 = service2.nextId();

    expect(id1).not.toEqual(id2);
  });

  it('should throw ClockMovedBackwardsException when system clock drifts backwards significantly', () => {
    // Mock timeGen to simulate clock rollback
    const now = Date.now();
    jest.spyOn(service as any, 'timeGen')
      .mockReturnValueOnce(BigInt(now))
      .mockReturnValueOnce(BigInt(now - 1000)); // Clock jumped back 1s

    service.nextId(); // First call sets lastTimestamp
    expect(() => service.nextId()).toThrow(ClockMovedBackwardsException);
  });
});
