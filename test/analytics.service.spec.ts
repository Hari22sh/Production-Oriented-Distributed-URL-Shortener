import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { KafkaProducer } from '../src/analytics/kafka.producer';
import { KafkaConsumer } from '../src/analytics/kafka.consumer';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let mockKafkaProducer: any;
  let mockKafkaConsumer: any;

  beforeEach(async () => {
    mockKafkaProducer = {
      sendClickEvent: jest.fn().mockResolvedValue(true),
    };
    mockKafkaConsumer = {
      getStats: jest.fn().mockReturnValue(42),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: KafkaProducer, useValue: mockKafkaProducer },
        { provide: KafkaConsumer, useValue: mockKafkaConsumer },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should anonymize IPv4 address correctly', async () => {
    await service.recordClick(
      'code1',
      'https://example.com',
      '192.168.1.100',
      'Mozilla/5.0',
      'https://google.com'
    );

    expect(mockKafkaProducer.sendClickEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        shortCode: 'code1',
        originalUrl: 'https://example.com',
        ip: '192.168.1.xxx',
        userAgent: 'Mozilla/5.0',
      })
    );
  });

  it('should not throw or crash if Kafka producer fails', async () => {
    mockKafkaProducer.sendClickEvent.mockRejectedValue(new Error('Broker unreachable'));

    await expect(
      service.recordClick('code1', 'https://example.com', '10.0.0.1')
    ).resolves.not.toThrow();
  });

  it('should retrieve stats from consumer', () => {
    const stats = service.getClickStats('code1');
    expect(stats).toEqual({ shortCode: 'code1', totalClicks: 42 });
  });
});
