import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimitGuard } from '../src/rate-limit/rate-limit.guard';
import { RateLimitService } from '../src/rate-limit/rate-limit.service';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let mockRateLimitService: any;

  beforeEach(async () => {
    mockRateLimitService = {
      isRateLimited: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: RateLimitService, useValue: mockRateLimitService },
      ],
    }).compile();

    guard = module.get<RateLimitGuard>(RateLimitGuard);
  });

  const createMockContext = (ip = '127.0.0.1'): ExecutionContext => {
    const mockRequest = {
      headers: {},
      socket: { remoteAddress: ip },
    };
    const mockResponse = {
      setHeader: jest.fn(),
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as any;
  };

  it('should allow request when within rate limit', async () => {
    mockRateLimitService.isRateLimited.mockResolvedValue({
      limited: false,
      remaining: 25,
    });

    const context = createMockContext();
    const canActivate = await guard.canActivate(context);

    expect(canActivate).toBe(true);
  });

  it('should throw HttpException 429 when rate limit is exceeded', async () => {
    mockRateLimitService.isRateLimited.mockResolvedValue({
      limited: true,
      remaining: 0,
    });

    const context = createMockContext();
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
  });
});
