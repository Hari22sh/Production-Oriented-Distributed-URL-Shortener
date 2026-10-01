export interface UrlSafetyChecker {
  validateUrl(url: string): Promise<void>;
}

export const URL_SAFETY_CHECKER = 'URL_SAFETY_CHECKER';
