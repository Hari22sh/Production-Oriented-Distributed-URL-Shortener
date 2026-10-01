import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUrl, IsOptional, IsDateString } from 'class-validator';

export class CreateUrlDto {
  @ApiProperty({
    description: 'The long original URL to be shortened',
    example: 'https://example.com/some/very/long/url',
  })
  @IsUrl({}, { message: 'originalUrl must be a valid HTTP/HTTPS URL' })
  originalUrl!: string;

  @ApiPropertyOptional({
    description: 'Optional expiration timestamp in ISO format',
    example: '2027-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'expiresAt must be a valid ISO 8601 date string' })
  expiresAt?: string;
}
