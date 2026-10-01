import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { Request } from 'express';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Identify client by IP address or custom header
    const ip =
      (request.headers['x-forwarded-for'] as string) ||
      request.socket.remoteAddress ||
      'unknown-client';

    const clientIdentifier = ip.split(',')[0].trim();
    const { limited, remaining } = await this.rateLimitService.isRateLimited(clientIdentifier);

    const response = context.switchToHttp().getResponse();
    if (response && response.setHeader) {
      response.setHeader('X-RateLimit-Remaining', remaining.toString());
    }

    if (limited) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    return true;
  }
}
