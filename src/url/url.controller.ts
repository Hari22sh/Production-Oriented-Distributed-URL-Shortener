import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { UrlService } from './url.service';
import { CreateUrlDto } from './dto/create-url.dto';
import { UrlResponseDto } from './dto/url-response.dto';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { AnalyticsService } from '../analytics/analytics.service';

@ApiTags('URLs')
@Controller('api/v1/urls')
export class UrlController {
  constructor(
    private readonly urlService: UrlService,
    private readonly analyticsService: AnalyticsService
  ) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new short URL' })
  @ApiResponse({
    status: 210,
    description: 'URL shortened successfully',
    type: UrlResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input or safety check failed' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async createUrl(@Body() dto: CreateUrlDto): Promise<UrlResponseDto> {
    return this.urlService.createUrl(dto);
  }

  @Get(':shortCode')
  @ApiOperation({ summary: 'Get URL metadata by short code' })
  @ApiParam({ name: 'shortCode', example: 'a8Kd2' })
  @ApiResponse({ status: 200, description: 'URL metadata returned' })
  @ApiResponse({ status: 404, description: 'Short code not found' })
  @ApiResponse({ status: 410, description: 'Short code expired' })
  async getUrl(@Param('shortCode') shortCode: string) {
    return this.urlService.getUrlByShortCode(shortCode);
  }

  @Delete(':shortCode')
  @ApiOperation({ summary: 'Delete/deactivate a short URL' })
  @ApiParam({ name: 'shortCode', example: 'a8Kd2' })
  @ApiResponse({ status: 200, description: 'URL deactivated and cache cleared' })
  @ApiResponse({ status: 404, description: 'Short code not found' })
  async deleteUrl(@Param('shortCode') shortCode: string) {
    return this.urlService.deleteUrl(shortCode);
  }

  @Get(':shortCode/stats')
  @ApiOperation({ summary: 'Get click analytics for a short URL' })
  @ApiParam({ name: 'shortCode', example: 'a8Kd2' })
  @ApiResponse({ status: 200, description: 'Click stats returned' })
  async getStats(@Param('shortCode') shortCode: string) {
    return this.analyticsService.getClickStats(shortCode);
  }
}
