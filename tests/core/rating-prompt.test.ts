import { describe, expect, it } from 'vitest';

import {
  INITIAL_RATING_PROMPT,
  finish,
  normalizeRatingPrompt,
  recordAuthorizedTab,
  recordSessionStart,
  shouldPrompt,
  snooze,
  type RatingPromptState,
} from '../../src/core/rating-prompt';

const useTabs = (state: RatingPromptState, ...tabIds: number[]) =>
  tabIds.reduce(recordAuthorizedTab, state);

describe('rating prompt', () => {
  it('ignores tabs authorized before captions have ever started', () => {
    const state = useTabs(INITIAL_RATING_PROMPT, 1, 2, 3);

    expect(state.tabCount).toBe(0);
    expect(shouldPrompt(state)).toBe(false);
  });

  it('asks on the second distinct tab after the first session', () => {
    const first = recordSessionStart(INITIAL_RATING_PROMPT, 10);
    expect(shouldPrompt(first)).toBe(false);

    // Reopening the popup on the same tab does not count.
    expect(shouldPrompt(recordAuthorizedTab(first, 10))).toBe(false);
    expect(shouldPrompt(recordAuthorizedTab(first, 11))).toBe(true);
  });

  it('after "later", asks again only at the fifth tab, then never', () => {
    let state = snooze(useTabs(recordSessionStart(INITIAL_RATING_PROMPT, 1), 2));
    expect(state.status).toBe('snoozed');

    state = useTabs(state, 3, 4);
    expect(shouldPrompt(state)).toBe(false);
    state = useTabs(state, 5);
    expect(shouldPrompt(state)).toBe(true);

    state = snooze(state);
    expect(state.status).toBe('done');
    expect(shouldPrompt(useTabs(state, 6, 7, 8))).toBe(false);
  });

  it('never asks again once rated or told not to', () => {
    const state = finish(useTabs(recordSessionStart(INITIAL_RATING_PROMPT, 1), 2));

    expect(shouldPrompt(useTabs(state, 3, 4, 5, 6))).toBe(false);
  });

  it('recovers from missing or corrupt storage', () => {
    expect(normalizeRatingPrompt(undefined)).toEqual(INITIAL_RATING_PROMPT);
    expect(
      normalizeRatingPrompt({ started: 'yes', status: 'weird', tabCount: -3, recentTabIds: ['x', 4] }),
    ).toEqual({ ...INITIAL_RATING_PROMPT, recentTabIds: [4] });
  });
});
