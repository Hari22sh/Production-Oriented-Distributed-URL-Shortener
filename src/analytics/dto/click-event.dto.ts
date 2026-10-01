export interface ClickEventDto {
  shortCode: string;
  originalUrl: string;
  timestamp: string;
  userAgent?: string;
  referrer?: string;
  ip?: string;
}
