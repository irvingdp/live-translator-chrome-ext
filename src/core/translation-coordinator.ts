export interface TranslationJob {
  revision: number;
  segmentId: string;
  text: string;
}

export interface CoordinatedTranslation extends TranslationJob {}

export type TranslateText = (
  text: string,
  signal: AbortSignal,
) => Promise<string>;

interface InFlightRequest {
  controller: AbortController;
  revision: number;
}

export class TranslationCoordinator {
  private readonly inFlight = new Map<string, InFlightRequest>();

  constructor(private readonly translateText: TranslateText) {}

  dispose(): void {
    for (const request of this.inFlight.values()) request.controller.abort();
    this.inFlight.clear();
  }

  async translate(
    job: TranslationJob,
  ): Promise<CoordinatedTranslation | undefined> {
    const previous = this.inFlight.get(job.segmentId);
    if (previous && job.revision <= previous.revision) return undefined;
    previous?.controller.abort();

    const request: InFlightRequest = {
      controller: new AbortController(),
      revision: job.revision,
    };
    this.inFlight.set(job.segmentId, request);

    try {
      const text = await this.translateText(
        job.text,
        request.controller.signal,
      );
      if (this.inFlight.get(job.segmentId) !== request) return undefined;
      this.inFlight.delete(job.segmentId);
      return { ...job, text };
    } catch (error) {
      if (
        request.controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return undefined;
      }
      if (this.inFlight.get(job.segmentId) === request) {
        this.inFlight.delete(job.segmentId);
      }
      throw error;
    }
  }
}
