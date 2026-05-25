export const DEFAULT_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const normalizeBrowserUserAgent = (value?: string | null): string => {
  const userAgent = value?.trim();
  if (!userAgent) return DEFAULT_BROWSER_USER_AGENT;
  if (!/Mozilla\/\d(?:\.\d)?/i.test(userAgent)) return DEFAULT_BROWSER_USER_AGENT;
  if (!/(Chrome|Firefox|Safari|Edg|OPR)\/\d/i.test(userAgent)) return DEFAULT_BROWSER_USER_AGENT;
  return userAgent;
};

const baseBrowserHeaders = (userAgent = DEFAULT_BROWSER_USER_AGENT): Record<string, string> => ({
  'User-Agent': normalizeBrowserUserAgent(userAgent),
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'cross-site',
  'Upgrade-Insecure-Requests': '1',
});

export const browserDocumentHeaders = (userAgent = DEFAULT_BROWSER_USER_AGENT): Record<string, string> => ({
  ...baseBrowserHeaders(userAgent),
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
});

export const browserJsonHeaders = (userAgent = DEFAULT_BROWSER_USER_AGENT): Record<string, string> => ({
  ...baseBrowserHeaders(userAgent),
  Accept: 'application/json,text/plain;q=0.9,*/*;q=0.5',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
});

export const browserMediaHeaders = (userAgent = DEFAULT_BROWSER_USER_AGENT): Record<string, string> => ({
  ...baseBrowserHeaders(userAgent),
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
});