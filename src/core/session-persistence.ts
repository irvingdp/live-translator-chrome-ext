import type {
  ActiveSessionSnapshot,
  SessionSettings,
} from './capture-session-controller';

export type NonSecretSessionSettings = Omit<
  SessionSettings,
  'cloudflareApiToken' | 'geminiApiKey' | 'groqApiKey'
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
    cloudflareApiToken: _cloudflareApiToken,
    geminiApiKey: _geminiApiKey,
    groqApiKey: _groqApiKey,
    ...settings
  } = snapshot.settings;
  return {
    sessionId: snapshot.sessionId,
    settings,
    tabId: snapshot.tabId,
  };
}
