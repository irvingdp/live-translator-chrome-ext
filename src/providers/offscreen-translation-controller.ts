import type {
  ProviderErrorCode,
  TranslationRequest,
  TranslationResult,
} from './deepl';

const retryDelays = [250, 500, 1_000, 2_000] as const;
const maxConsecutiveFailures = 5;

export type TranslationAttemptResult =
  | { ok: true; text: string }
  | {
    error: ProviderErrorCode | 'cancelled' | 'translation_disabled';
    ok: false;
  };

interface OffscreenTranslationDependencies {
  delay(milliseconds: number, signal: AbortSignal): Promise<void>;
  translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult>;
}

export class OffscreenTranslationController {
  private active = new Map<string, AbortController>();
  private circuitOpen = false;
  private consecutiveFailures = 0;
  private queueTail: Promise<void> = Promise.resolve();
  private sessionId?: string;

  constructor(
    private readonly dependencies: OffscreenTranslationDependencies,
  ) {}

  startSession(sessionId: string): void {
    this.abortActive();
    this.sessionId = sessionId;
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
  }

  stopSession(sessionId: string): void {
    if (this.sessionId !== sessionId) return;

    this.abortActive();
    this.sessionId = undefined;
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
  }

  translate(
    sessionId: string,
    requestId: string,
    request: TranslationRequest,
  ): Promise<TranslationAttemptResult> {
    if (this.sessionId !== sessionId) return Promise.resolve(cancelled());
    if (this.circuitOpen) return Promise.resolve(translationDisabled());

    const abort = new AbortController();
    this.active.set(requestId, abort);

    const result = this.queueTail.then(() =>
      this.translateQueued(sessionId, request, abort),
    );
    this.queueTail = result.then(
      () => undefined,
      () => undefined,
    );

    return result.finally(() => {
      if (this.active.get(requestId) === abort) this.active.delete(requestId);
    });
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort();
  }

  private async translateQueued(
    sessionId: string,
    request: TranslationRequest,
    abort: AbortController,
  ): Promise<TranslationAttemptResult> {
    const failuresBeforeRequest = this.consecutiveFailures;
    if (this.isCancelled(sessionId, abort.signal)) return cancelled();
    if (this.circuitOpen) return translationDisabled();

    while (true) {
      try {
        const result = await this.dependencies.translate(request, abort.signal);
        if (this.isCancelled(sessionId, abort.signal)) return cancelled();

        this.consecutiveFailures = 0;
        return { ok: true, text: result.text };
      } catch (error) {
        if (this.isCancelled(sessionId, abort.signal) || isAbortError(error)) {
          this.restoreFailureBudget(sessionId, failuresBeforeRequest);
          return cancelled();
        }

        this.consecutiveFailures += 1;
        if (this.consecutiveFailures === maxConsecutiveFailures) {
          this.circuitOpen = true;
          return translationDisabled();
        }

        try {
          await this.dependencies.delay(
            retryDelays[this.consecutiveFailures - 1]!,
            abort.signal,
          );
        } catch (delayError) {
          if (this.isCancelled(sessionId, abort.signal) || isAbortError(delayError)) {
            this.restoreFailureBudget(sessionId, failuresBeforeRequest);
            return cancelled();
          }
          throw delayError;
        }
      }
    }
  }

  private abortActive(): void {
    for (const abort of this.active.values()) abort.abort();
    this.active.clear();
  }

  private isCancelled(sessionId: string, signal: AbortSignal): boolean {
    return signal.aborted || this.sessionId !== sessionId;
  }

  private restoreFailureBudget(
    sessionId: string,
    failuresBeforeRequest: number,
  ): void {
    if (this.sessionId === sessionId) {
      this.consecutiveFailures = failuresBeforeRequest;
    }
  }
}

function cancelled(): TranslationAttemptResult {
  return { error: 'cancelled', ok: false };
}

function translationDisabled(): TranslationAttemptResult {
  return { error: 'translation_disabled', ok: false };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
