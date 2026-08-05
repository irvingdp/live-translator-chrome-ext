export type ProviderErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'provider_unavailable'
  | 'invalid_response';

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly status?: number,
  ) {
    super(`DeepL request failed: ${code}`);
    this.name = 'ProviderError';
  }
}

export interface TranslationRequest {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
}

export interface TranslationResult {
  detectedSourceLanguage?: string;
  text: string;
}

export function resolveDeepLEndpoint(apiKey: string): string {
  return apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

function errorForStatus(status: number): ProviderError {
  if (status === 403) return new ProviderError('invalid_credentials', status);
  if (status === 429) return new ProviderError('rate_limited', status);
  if (status === 456) return new ProviderError('quota_exceeded', status);
  return new ProviderError('provider_unavailable', status);
}

interface DeepLResponse {
  translations?: Array<{
    detected_source_language?: string;
    text?: string;
  }>;
}

export class DeepLClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    const response = await this.fetcher(resolveDeepLEndpoint(request.apiKey), {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${request.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_type: 'latency_optimized',
        source_lang: request.sourceLanguage,
        target_lang: request.targetLanguage,
        text: [request.text],
      }),
      signal,
    });

    if (!response.ok) throw errorForStatus(response.status);

    let payload: DeepLResponse;
    try {
      payload = (await response.json()) as DeepLResponse;
    } catch {
      throw new ProviderError('invalid_response');
    }
    const translation = payload.translations?.[0];
    if (typeof translation?.text !== 'string' || !translation.text) {
      throw new ProviderError('invalid_response');
    }

    return {
      detectedSourceLanguage: translation.detected_source_language,
      text: translation.text,
    };
  }
}
