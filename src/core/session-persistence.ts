import type {
  ActiveSessionSnapshot,
  SessionSettings,
} from './capture-session-controller';

export type NonSecretSessionSettings = Omit<
  SessionSettings,
  'deeplApiKey' | 'geminiApiKey'
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
