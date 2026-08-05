import { describe, expect, it } from 'vitest';

import { TranslationCoordinator } from '../../src/core/translation-coordinator';

describe('TranslationCoordinator', () => {
  it('rejects a response that resolves after a newer segment revision', async () => {
    const resolvers: Array<(text: string) => void> = [];
    const translate = (_text: string, _signal: AbortSignal) =>
      new Promise<string>((resolve) => resolvers.push(resolve));
    const coordinator = new TranslationCoordinator(translate);

    const oldRequest = coordinator.translate({
      revision: 1,
      segmentId: 'segment-1',
      text: 'Old phrase',
    });
    const newRequest = coordinator.translate({
      revision: 2,
      segmentId: 'segment-1',
      text: 'New phrase',
    });

    resolvers[1]!('新的翻譯');
    await expect(newRequest).resolves.toEqual({
      revision: 2,
      segmentId: 'segment-1',
      text: '新的翻譯',
    });

    resolvers[0]!('舊的翻譯');
    await expect(oldRequest).resolves.toBeUndefined();
  });

  it('aborts the previous in-flight request for the same segment', async () => {
    const signals: AbortSignal[] = [];
    const translate = (_text: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => undefined);
    };
    const coordinator = new TranslationCoordinator(translate);

    void coordinator.translate({
      revision: 1,
      segmentId: 'segment-1',
      text: 'Old phrase',
    });
    void coordinator.translate({
      revision: 2,
      segmentId: 'segment-1',
      text: 'New phrase',
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});
