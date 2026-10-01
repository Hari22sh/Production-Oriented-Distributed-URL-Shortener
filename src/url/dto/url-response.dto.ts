import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UrlResponseDto {
  @ApiProperty({ example: 'a8Kd2' })
  shortCode!: string;

  @ApiProperty({ example: 'http://localhost:3000/a8Kd2' })
  shortUrl!: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00Z', nullable: true })
  expiresAt?: string | null;
}
