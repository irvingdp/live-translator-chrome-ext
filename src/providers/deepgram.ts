import type { TranscriptEvent } from '../core/transcript-stabilizer';

export function buildDeepgramUrl(language: string): string {
  const url = new URL('wss://api.deepgram.com/v1/listen');
  const parameters: Record<string, string> = {
    channels: '1',
    encoding: 'linear16',
    endpointing: '200',
    interim_results: 'true',
    language,
    model: 'nova-3',
    punctuate: 'true',
    sample_rate: '16000',
    smart_format: 'true',
    utterance_end_ms: '1000',
    vad_events: 'true',
  };
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function deepgramProtocols(apiKey: string): [string, string] {
  return ['token', apiKey];
}

interface DeepgramResultsMessage {
  channel?: {
    alternatives?: Array<{ transcript?: unknown }>;
  };
  is_final?: unknown;
  metadata?: { request_id?: unknown };
  request_id?: unknown;
  start?: unknown;
  type?: unknown;
}

export class DeepgramMessageParser {
  private readonly revisions = new Map<string, number>();

  parse(rawMessage: string): TranscriptEvent | undefined {
    let message: DeepgramResultsMessage;
    try {
      message = JSON.parse(rawMessage) as DeepgramResultsMessage;
    } catch {
      return undefined;
    }

    if (message.type !== 'Results') return undefined;
    const transcript = message.channel?.alternatives?.[0]?.transcript;
    if (typeof transcript !== 'string' || !transcript.trim()) return undefined;

    const requestId =
      typeof message.request_id === 'string'
        ? message.request_id
        : typeof message.metadata?.request_id === 'string'
          ? message.metadata.request_id
          : 'stream';
    const start = typeof message.start === 'number' ? message.start : 0;
    const segmentId = `${requestId}:${start.toFixed(3)}`;
    const revision = (this.revisions.get(segmentId) ?? 0) + 1;
    this.revisions.set(segmentId, revision);

    return {
      isFinal: message.is_final === true,
      revision,
      segmentId,
      text: transcript.trim(),
    };
  }
}
