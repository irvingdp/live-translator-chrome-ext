// Decides when the popup asks for a rating.
//
// The ask comes once the extension has proven itself: the user has started
// captions at least once, and then authorized a second, different tab. "Later"
// pushes the ask out to the fifth tab; after that, or after any rating or a
// "don't ask again", it never comes back.

export const RATING_PROMPT_KEY = 'ratingPrompt';
export const FIRST_PROMPT_AT = 2;
export const SNOOZED_PROMPT_AT = 5;
// Enough to tell recent tabs apart; tab ids are only unique per browser run.
const REMEMBERED_TABS = 20;

export type RatingPromptStatus = 'pending' | 'snoozed' | 'done';

export interface RatingPromptState {
  /** Set the first time a captioning session starts. */
  started: boolean;
  /** Distinct tabs used since then. */
  tabCount: number;
  /** Most recent tab ids, used to avoid counting a tab twice. */
  recentTabIds: number[];
  status: RatingPromptStatus;
}

export const INITIAL_RATING_PROMPT: RatingPromptState = {
  started: false,
  tabCount: 0,
  recentTabIds: [],
  status: 'pending',
};

export function normalizeRatingPrompt(value: unknown): RatingPromptState {
  if (!value || typeof value !== 'object') return INITIAL_RATING_PROMPT;
  const raw = value as Partial<RatingPromptState>;
  const status: RatingPromptStatus =
    raw.status === 'snoozed' || raw.status === 'done' ? raw.status : 'pending';
  return {
    started: raw.started === true,
    tabCount:
      typeof raw.tabCount === 'number' && Number.isFinite(raw.tabCount) && raw.tabCount > 0
        ? Math.floor(raw.tabCount)
        : 0,
    recentTabIds: Array.isArray(raw.recentTabIds)
      ? raw.recentTabIds.filter((id): id is number => Number.isInteger(id)).slice(-REMEMBERED_TABS)
      : [],
    status,
  };
}

function countTab(state: RatingPromptState, tabId: number): RatingPromptState {
  if (state.recentTabIds.includes(tabId)) return state;
  return {
    ...state,
    tabCount: state.tabCount + 1,
    recentTabIds: [...state.recentTabIds, tabId].slice(-REMEMBERED_TABS),
  };
}

/** A session started on this tab. */
export function recordSessionStart(state: RatingPromptState, tabId: number): RatingPromptState {
  return countTab({ ...state, started: true }, tabId);
}

/** The popup authorized this tab. Ignored until a session has started once. */
export function recordAuthorizedTab(state: RatingPromptState, tabId: number): RatingPromptState {
  return state.started ? countTab(state, tabId) : state;
}

export function shouldPrompt(state: RatingPromptState): boolean {
  if (state.status === 'done') return false;
  const threshold = state.status === 'snoozed' ? SNOOZED_PROMPT_AT : FIRST_PROMPT_AT;
  return state.started && state.tabCount >= threshold;
}

/** "Later": ask once more at the fifth tab, then stop asking. */
export function snooze(state: RatingPromptState): RatingPromptState {
  return { ...state, status: state.status === 'pending' ? 'snoozed' : 'done' };
}

/** Rated, sent feedback, or "don't ask again". */
export function finish(state: RatingPromptState): RatingPromptState {
  return { ...state, status: 'done' };
}
