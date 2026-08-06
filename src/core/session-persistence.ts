import type {
  ActiveSessionSnapshot,
  SessionSettings,
} from './capture-session-controller';

export type NonSecretSessionSettings = Omit<
  SessionSettings,
  'deepgramApiKey' | 'deeplApiKey' | 'geminiApiKey'
>;

export interface PersistedSessionSnapshot {
  sessionId: string;
  settings: NonSecretSessionSettings;
  tabId: number;
}

export function redactSessionSnapshot(
  snapshot: ActiveSessionSnapshot,
): PersistedSessionSnapshot {
  const {
    deepgramApiKey: _deepgramApiKey,
    deeplApiKey: _deeplApiKey,
    geminiApiKey: _geminiApiKey,
    ...settings
  } = snapshot.settings;
  return {
    sessionId: snapshot.sessionId,
    settings,
    tabId: snapshot.tabId,
  };
}
