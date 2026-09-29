export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface CacheEntry {
  expiresAt: number;
  value: number | undefined;
}

const cache = new Map<string, CacheEntry>();

export const openMeteoUrl = (lats: number[], lons: number[]): string =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
  `&daily=temperature_2m_min&timezone=America%2FLima&forecast_days=3`;

export async function fetchMinimumTemperature(
  lat: number,
  lon: number,
  fetcher: FetchLike = fetch,
  now = Date.now(),
): Promise<number | undefined> {
  const key = `${Math.round(lat * 10) / 10},${Math.round(lon * 10) / 10}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const response = await fetcher(openMeteoUrl([lat], [lon]), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const json: unknown = await response.json();
    const object = Array.isArray(json) ? json[0] : json;
    const temperatures = (object as { daily?: { temperature_2m_min?: unknown } })?.daily?.temperature_2m_min;
    if (!Array.isArray(temperatures)) throw new Error('Respuesta Open-Meteo inválida');
    const numeric = temperatures.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const value = numeric.length ? Math.round(Math.min(...numeric)) : undefined;
    cache.set(key, { value, expiresAt: now + 3 * 60 * 60 * 1000 });
    return value;
  } catch {
    cache.set(key, { value: undefined, expiresAt: now + 5 * 60 * 1000 });
    return undefined;
  }
}
