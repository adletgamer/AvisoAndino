export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RetryOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

const USER_AGENT = 'AvisoAndino/1.0 (+https://github.com/adletgamer/AvisoAndino)';

export async function fetchWithRetry(url: string, options: RetryOptions = {}): Promise<Response> {
  const fetcher = options.fetch ?? fetch;
  const retries = options.retries ?? 2;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/html' },
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} al consultar ${new URL(url).hostname}`);
        if (response.status < 500 && response.status !== 429) throw Object.assign(error, { permanent: true });
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if ((error as { permanent?: boolean }).permanent || attempt === retries) throw error;
      await sleep(150 * 2 ** attempt + Math.floor(random() * 100));
    }
  }
  throw lastError;
}
