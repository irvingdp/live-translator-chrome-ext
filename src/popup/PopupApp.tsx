import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionStatus } from '../core/capture-session-controller';
import { buildFeedbackPayload, type FeedbackPayload } from '../core/feedback';
import { websiteUrl } from '../core/links';
import {
  INITIAL_RATING_PROMPT,
  finish,
  recordAuthorizedTab,
  recordSessionStart,
  shouldPrompt,
  snooze,
  type RatingPromptState,
} from '../core/rating-prompt';
import { t, type MessageKey } from '../core/i18n';
import {
  GEMINI_AUTO_SOURCE,
  GEMINI_LANGUAGE_OPTIONS,
} from '../core/gemini-languages';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  SETTING_RANGES,
  type AppSettings,
  type TranscriberId,
  validateSettingsForStart,
} from '../core/settings';
import { RatingCard } from './RatingCard';

export interface AuthorizedTab {
  tabId: number;
  authorized: boolean;
}

export interface PopupApi {
  authorizeCurrentTab(): Promise<AuthorizedTab | undefined>;
  extensionVersion(): string;
  loadRatingPrompt(): Promise<RatingPromptState>;
  saveRatingPrompt(state: RatingPromptState): Promise<void>;
  sendFeedback(payload: FeedbackPayload): Promise<void>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  start(settings: AppSettings): Promise<SessionStatus>;
  status(): Promise<SessionStatus>;
  stop(): Promise<SessionStatus>;
  // True once after an update moved a Deepgram user to Gemini live without a
  // Gemini key; reading it clears it.
  takeDeepgramRemovedNotice(): Promise<boolean>;
}

export function PopupApp({ api }: { api: PopupApi }) {
  const [settings, setSettings] = useState<AppSettings>();
  const [status, setStatus] = useState<SessionStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string>();
  const [ratingVisible, setRatingVisible] = useState(false);
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const sessionAttempt = useRef(0);
  const ratingPrompt = useRef<Promise<RatingPromptState>>(undefined);

  // Every change to the rating state runs through here, in order, so a quick
  // "later" cannot race the authorization that showed the card.
  const updateRatingPrompt = useCallback(
    (change: (state: RatingPromptState) => RatingPromptState) => {
      const previous =
        ratingPrompt.current ??
        api.loadRatingPrompt().catch(() => INITIAL_RATING_PROMPT);
      const next = previous.then(change);
      ratingPrompt.current = next;
      return next.then(async (state) => {
        await api.saveRatingPrompt(state).catch(() => undefined);
        return state;
      });
    },
    [api],
  );

  useEffect(() => {
    const authorization = api.authorizeCurrentTab().catch(() => undefined);
    void authorization.then(async (tab) => {
      if (!tab?.authorized) return;
      const state = await updateRatingPrompt((current) =>
        recordAuthorizedTab(current, tab.tabId),
      );
      if (shouldPrompt(state)) setRatingVisible(true);
    });
    void Promise.all([
      api.loadSettings(),
      api.status(),
      authorization,
      api.takeDeepgramRemovedNotice().catch(() => false),
    ]).then(
      ([loadedSettings, loadedStatus, _tab, deepgramRemoved]) => {
        setSettings(normalizeSettings(loadedSettings));
        setStatus(loadedStatus);
        if (deepgramRemoved) setMessage(t('deepgramRemovedNeedGeminiKey'));
      },
      () => {
        setSettings(DEFAULT_SETTINGS);
        setMessage(t('settingsLoadFailed'));
      },
    );
  }, [api, updateRatingPrompt]);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((current) => {
      if (!current) return current;
      const next = normalizeSettings({ ...current, ...patch });
      saveTail.current = saveTail.current
        .then(() => api.saveSettings(next))
        .catch(() => {
          setMessage(t('settingsSaveFailed'));
        });
      return next;
    });
  };
  const update = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ) => updateSettings({ [key]: value });

  const toggleSession = async () => {
    if (!settings || busy) return;
    if (status.state === 'running' || status.state === 'starting') {
      sessionAttempt.current += 1;
      setBusy(true);
      try {
        setStatus(await api.stop());
        setMessage(t('captionsStopped'));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : t('stopFailed'));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (Object.keys(validateSettingsForStart(settings)).length > 0) {
      setMessage(t('needGeminiKey'));
      return;
    }

    const attempt = ++sessionAttempt.current;
    setStatus({ state: 'starting', tabId: -1 });
    setMessage('');
    try {
      await saveTail.current;
      if (attempt !== sessionAttempt.current) return;
      await api.saveSettings(settings);
      if (attempt !== sessionAttempt.current) return;
      const started = await api.start(settings);
      if (attempt === sessionAttempt.current) setStatus(started);
      if ('tabId' in started && started.tabId >= 0) {
        const state = await updateRatingPrompt((current) =>
          recordSessionStart(current, started.tabId),
        );
        if (shouldPrompt(state)) setRatingVisible(true);
      }
    } catch (error) {
      if (attempt === sessionAttempt.current) {
        setStatus({ state: 'idle' });
        setMessage(
          error instanceof Error
            ? error.message
            : t('startFailed'),
        );
      }
    }
  };

  if (!settings) {
    return (
      <main className="popup loading" aria-busy="true">{t('loadingSettings')}</main>
    );
  }

  const running = status.state === 'running' || status.state === 'starting';
  const transcriber = settings.transcriber;
  const isReadAhead = transcriber === 'gemini-read-ahead';
  const closeRating = () => setRatingVisible(false);
  return (
    <main className="popup">
      {ratingVisible && (
        <RatingCard
          onClose={closeRating}
          onLater={() => {
            void updateRatingPrompt(snooze);
            closeRating();
          }}
          onNever={() => {
            void updateRatingPrompt(finish);
            closeRating();
          }}
          onSendFeedback={async (rating, issue, message) => {
            await api.sendFeedback(
              buildFeedbackPayload({
                issue,
                message,
                provider: settings.transcriber,
                rating,
                uiLanguage: t('uiLanguage'),
                version: api.extensionVersion(),
              }),
            );
            void updateRatingPrompt(finish);
          }}
        />
      )}
      <header className="header">
        <div>
          <p className="eyebrow">LIVE CAPTIONS</p>
          <h1>{t('extName')}</h1>
        </div>
        <div className="session-control">
          <button
            aria-checked={running}
            aria-label={t(busy ? 'working' : running ? 'stopCaptions' : 'startCaptions')}
            className={`session-toggle session-toggle-${'error' in status && status.error ? 'error' : status.state}`}
            disabled={busy}
            role="switch"
            type="button"
            onClick={() => void toggleSession()}
          >
            <span aria-hidden="true" className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </button>
          {(message || ('error' in status && status.error)) && (
            <p className="toggle-error" role="status">
              {message === t('needGeminiKey') ||
              message === t('deepgramRemovedNeedGeminiKey') ? (
                <>
                  {message}
                  <a
                    href="onboarding.html"
                    target="_blank"
                  >
                    {t('geminiGuideLink')}
                  </a>
                </>
              ) : message || t(statusMessageKey(status))}
            </p>
          )}
        </div>
      </header>

      <section className="card" aria-labelledby="provider-heading">
        <h2 id="provider-heading">{t('providerHeading')}</h2>
        <label htmlFor="transcriber">{t('transcriberLabel')}</label>
        <select
          id="transcriber"
          disabled={running}
          value={transcriber}
          onChange={(event) =>
            update('transcriber', event.target.value as TranscriberId)
          }
        >
          <option value="gemini">Gemini live translate 3.5</option>
          <option value="gemini-read-ahead">{t('transcriberReadAhead')}</option>
        </select>
        <GeminiGuideLink />
        <ConfigurableSecretField
          id="gemini-key"
          label="Gemini API Key"
          onSave={(geminiApiKey) => {
            update('geminiApiKey', geminiApiKey);
          }}
          onToggle={() => setRevealedSecret((current) =>
            current === 'gemini-key' ? undefined : 'gemini-key'
          )}
          revealed={revealedSecret === 'gemini-key'}
          value={settings.geminiApiKey}
        />

      </section>

      <section className="card grid" aria-labelledby="language-heading">
        <h2 id="language-heading">{t('languageHeading')}</h2>
        <div>
          <label htmlFor="source-language">{t('sourceLanguageLabel')}</label>
          {/* Gemini live detects the source itself and offers no field to set
              it, so the picker shows what it can recognise without pretending
              the choice is ours to make. Read-ahead puts the language in its
              prompt, so there the choice is real (auto by default). */}
          <select
            id="source-language"
            disabled={running || !isReadAhead}
            value={isReadAhead ? settings.geminiSourceLanguage : GEMINI_AUTO_SOURCE}
            onChange={(event) => update('geminiSourceLanguage', event.target.value)}
          >
            <option value={GEMINI_AUTO_SOURCE}>{t('autoDetect')}</option>
            {GEMINI_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="target-language">{t('targetLanguageLabel')}</label>
          <select
            id="target-language"
            disabled={running}
            value={settings.geminiTargetLanguage}
            onChange={(event) => update('geminiTargetLanguage', event.target.value)}
          >
            {GEMINI_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <details className="more-settings">
        <summary>{t('showMoreSettings')}</summary>
        <section className="card" aria-labelledby="size-heading">
        <h2 id="size-heading">{t('sizeHeading')}</h2>
        <RangeField
          id="original-size"
          label={t('originalFontSizeLabel')}
          max={SETTING_RANGES.originalFontSize.max}
          min={SETTING_RANGES.originalFontSize.min}
          unit="px"
          value={settings.originalFontSize}
          onChange={(value) => update('originalFontSize', value)}
        />
        <RangeField
          id="translation-size"
          label={t('translationFontSizeLabel')}
          max={SETTING_RANGES.translationFontSize.max}
          min={SETTING_RANGES.translationFontSize.min}
          unit="px"
          value={settings.translationFontSize}
          onChange={(value) => update('translationFontSize', value)}
        />
        <ColorField
          id="original-color"
          label={t('originalTextColorLabel')}
          value={settings.originalTextColor}
          onChange={(value) => update('originalTextColor', value)}
        />
        <ColorField
          id="translation-color"
          label={t('translationTextColorLabel')}
          value={settings.translationTextColor}
          onChange={(value) => update('translationTextColor', value)}
        />
        <button
          className="secondary color-reset"
          disabled={
            settings.originalTextColor === DEFAULT_SETTINGS.originalTextColor &&
            settings.translationTextColor === DEFAULT_SETTINGS.translationTextColor
          }
          type="button"
          onClick={() => updateSettings({
            originalTextColor: DEFAULT_SETTINGS.originalTextColor,
            translationTextColor: DEFAULT_SETTINGS.translationTextColor,
          })}
        >
          {t('resetTextColors')}
        </button>
        </section>

        <section className="card" aria-labelledby="layout-heading">
        <h2 id="layout-heading">{t('layoutHeading')}</h2>
        <RangeField
          id="background-opacity"
          label={t('backgroundOpacityLabel')}
          max={SETTING_RANGES.backgroundOpacity.max}
          min={SETTING_RANGES.backgroundOpacity.min}
          step={5}
          unit="%"
          value={settings.backgroundOpacity}
          onChange={(value) => update('backgroundOpacity', value)}
        />
        </section>
      </details>
      <footer className="popup-footer">
        <a href={websiteUrl(t('uiLanguage'))} rel="noreferrer" target="_blank">
          {t('websiteLink')}
        </a>
      </footer>
    </main>
  );
}

// A translation problem is worth surfacing even while the session keeps
// running, so it outranks the plain state.
function statusMessageKey(status: SessionStatus): MessageKey {
  const error = 'error' in status ? status.error : undefined;
  if (error === 'read_ahead_unsupported') return 'statusReadAheadUnsupported';
  if (status.state === 'running') return 'statusRunning';
  if (status.state === 'starting') return 'statusStarting';
  if (status.state === 'error') return 'statusRetry';
  return 'statusIdle';
}

function GeminiGuideLink() {
  return (
    <a className="provider-link" href="onboarding.html" target="_blank">
      {t('geminiGuideLink')}
    </a>
  );
}

function ConfigurableSecretField({
  id,
  label,
  onSave,
  onToggle,
  revealed,
  value,
}: {
  id: string;
  label: string;
  onSave(value: string): void;
  onToggle(): void;
  revealed: boolean;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  const [configured, setConfigured] = useState(Boolean(value.trim()));

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="secret-row">
        <input
          autoComplete="off"
          id={id}
          type={revealed ? 'text' : 'password'}
          value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setConfigured(false);
            }}
        />
        <button
          aria-label={t(revealed ? 'hideSecret' : 'showSecret', label)}
          className="secret-toggle"
          type="button"
          onClick={onToggle}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      <div className="secret-actions">
        <p className={`provider-state ${configured ? 'configured' : ''}`}>
          {t(configured ? 'keysConfigured' : 'keysMissing')}
        </p>
        <button
          aria-label={`${t('setApiKey')} ${label}`}
          className="secret-submit"
          disabled={!draft.trim()}
          type="button"
            onClick={() => {
              onSave(draft.trim());
              setConfigured(true);
            }}
        >
          {t('setApiKey')}
        </button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m3 3 18 18" />
      <path d="M10.6 6.1A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a18.7 18.7 0 0 1-2.1 2.8M6.2 6.2A17.2 17.2 0 0 0 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function RangeField({
  id,
  label,
  max,
  min,
  onChange,
  step = 1,
  unit,
  value,
}: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange(value: number): void;
  step?: number;
  unit: string;
  value: number;
}) {
  return (
    <div className="range-field">
      <div className="range-label">
        <label htmlFor={id}>{label}</label>
        <output>{`${value}${unit}`}</output>
      </div>
      <input
        id={id}
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function ColorField({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange(value: string): void;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  const commit = () => {
    if (!valid) {
      setDraft(value);
      return;
    }
    const normalized = draft.toLowerCase();
    setDraft(normalized);
    if (normalized !== value) onChange(normalized);
  };
  return (
    <div className="color-field">
      <label htmlFor={`${id}-picker`}>{label}</label>
      <div className="color-inputs">
        <input
          aria-label={label}
          id={`${id}-picker`}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
        <input
          aria-invalid={!valid}
          aria-label={t('colorCodeLabel', label)}
          inputMode="text"
          maxLength={7}
          pattern="#[0-9A-Fa-f]{6}"
          spellCheck={false}
          type="text"
          value={draft}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(value);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}
