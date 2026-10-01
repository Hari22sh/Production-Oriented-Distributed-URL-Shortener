import { Injectable, BadRequestException } from "@nestjs/common";
import { UrlSafetyChecker } from "./url-safety.interface";

@Injectable()
export class DefaultUrlSafetyService implements UrlSafetyChecker {
  private readonly blockedDomains = new Set<string>([
    "malware.com",
    "phishing.com",
    "bad-actor.net",
    "phishing.test",
    "malware.test",
  ]);

  async validateUrl(url: string): Promise<void> {
    if (!url || typeof url !== "string") {
      throw new BadRequestException("URL must be a non-empty string");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException("Invalid URL format");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new BadRequestException(
        "Only http and https protocols are supported",
      );
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    if (this.blockedDomains.has(hostname)) {
      throw new BadRequestException(
        `URL domain '${hostname}' is blocked due to security policies`,
      );
    }
  }
}
