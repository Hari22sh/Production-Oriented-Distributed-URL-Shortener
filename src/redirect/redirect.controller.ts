import { Controller, Get, Param, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RedirectService } from './redirect.service';

@ApiTags('Redirect')
@Controller()
export class RedirectController {
  constructor(private readonly redirectService: RedirectService) {}

  @Get(':shortCode')
  @HttpCode(HttpStatus.FOUND)
  @ApiOperation({
    summary: 'Redirect short code to original destination URL (HTTP 302)',
  })
  @ApiParam({ name: 'shortCode', example: 'a8Kd2' })
  @ApiResponse({ status: 302, description: 'Redirecting to target URL' })
  @ApiResponse({ status: 404, description: 'Short code not found' })
  @ApiResponse({ status: 410, description: 'Short code expired' })
  async redirect(@Param('shortCode') shortCode: string, @Req() req: Request, @Res() res: Response) {
    // Exclude system route prefixes if any
    if (shortCode === 'health' || shortCode === 'favicon.ico' || shortCode.startsWith('api')) {
      return res.status(404).json({ message: 'Not found' });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    const referrer = req.headers['referer'] || req.headers['referrer'];

    const targetUrl = await this.redirectService.resolveRedirect(
      shortCode,
      ip,
      userAgent as string | undefined,
      referrer as string | undefined
    );

    // Perform HTTP 302 Found redirect
    return res.redirect(HttpStatus.FOUND, targetUrl);
  }
}
