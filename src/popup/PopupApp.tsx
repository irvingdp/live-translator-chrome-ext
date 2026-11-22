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
  requiredApiKeys,
  SETTING_RANGES,
  type ApiKeyField,
  type AppSettings,
  type ReadAheadRecognizer,
  type ReadAheadTranslator,
  type TranscriberId,
  validateSettingsForStart,
} from '../core/settings';
import type { LocalWhisperDownload } from '../core/messages';
import {
  LOCAL_WHISPER_MODEL_IDS,
  LOCAL_WHISPER_SPECS,
  downloadInProgress,
  type LocalWhisperModel,
} from '../read-ahead/local-whisper';
import { RatingCard } from './RatingCard';

export interface AuthorizedTab {
  tabId: number;
  authorized: boolean;
}

// Whether Chrome's built-in Translator can translate a language pair here:
// 'unsupported' when this browser or computer has no Translator API at all.
export type ChromeTranslatorStatus =
  | 'available'
  | 'downloadable'
  | 'unavailable'
  | 'unsupported';

export type OptionalService = 'groq' | 'local';

export interface PopupApi {
  chromeTranslatorStatus(sourceLanguage: string, targetLanguage: string): Promise<ChromeTranslatorStatus>;
  // Starts the language-pack download; needs a user gesture (choosing a
  // Whisper recognizer, or the start click).
  prepareChromeTranslator(sourceLanguage: string, targetLanguage: string): Promise<void>;
  // Groq's host is an optional permission, asked for when
  // the service is chosen (and again at start, in case it was set up
  // elsewhere).
  requestPermission(service: OptionalService): Promise<boolean>;
  // Local Whisper (issue #15): whether this computer can run it, whether a
  // model is downloaded, and its download (run by the background, so it goes
  // on after the popup closes) and deletion.
  webGpuAvailable(): Promise<boolean>;
  localWhisperCached(model: LocalWhisperModel): Promise<boolean>;
  downloadLocalWhisper(model: LocalWhisperModel): Promise<void>;
  deleteLocalWhisper(model: LocalWhisperModel): Promise<void>;
  watchLocalWhisperDownload(onChange: (download: LocalWhisperDownload | undefined) => void): () => void;
  // Allowed sites (ADR 0009): the current tab's site, and allowing it — the
  // permission request must run inside the click, so the site is looked up
  // beforehand. Resolves false when the viewer declines.
  currentSite(): Promise<{ origin: string; tabId: number } | undefined>;
  allowSite(site: { origin: string; tabId: number }): Promise<boolean>;
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
  const [chromeStatus, setChromeStatus] = useState<ChromeTranslatorStatus>();
  const [webGpu, setWebGpu] = useState<boolean>();
  const [modelCached, setModelCached] = useState<boolean>();
  const [download, setDownload] = useState<LocalWhisperDownload>();
  const [site, setSite] = useState<{ origin: string; tabId: number }>();
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

  useEffect(() => {
    void api.currentSite().catch(() => undefined).then(setSite);
  }, [api]);

  useEffect(() => {
    void api.webGpuAvailable().catch(() => false).then(setWebGpu);
    return api.watchLocalWhisperDownload(setDownload);
  }, [api]);

  // Whether the chosen local model is downloaded; checked again when a
  // download finishes.
  const localModel = settings?.localWhisperModel;
  const downloadState = download?.model === localModel ? download?.state : undefined;
  useEffect(() => {
    if (!localModel) return;
    let current = true;
    void api.localWhisperCached(localModel).catch(() => false)
      .then((cached) => { if (current) setModelCached(cached); });
    return () => { current = false; };
  }, [api, localModel, downloadState]);

  // A Whisper recognizer leaves the translation to a separate service.
  const usesWhisper = settings?.transcriber === 'gemini-read-ahead' &&
    settings.readAheadRecognizer !== 'gemini';
  const statusSource = settings?.geminiSourceLanguage;
  const statusTarget = settings?.geminiTargetLanguage;
  useEffect(() => {
    if (!usesWhisper || !statusTarget) return;
    let current = true;
    void api.chromeTranslatorStatus(chromeProbeSource(statusSource), statusTarget)
      .catch((): ChromeTranslatorStatus => 'unsupported')
      .then((next) => { if (current) setChromeStatus(next); });
    return () => { current = false; };
  }, [api, usesWhisper, statusSource, statusTarget]);

  // Downloads Chrome's language pack when it still needs one; creating a
  // translator that has to download needs a user gesture, so this runs from
  // one (choosing a Whisper recognizer, or the start click).
  const prepareChromeTranslation = async (source: string, target: string) => {
    try {
      const probe = chromeProbeSource(source);
      if (await api.chromeTranslatorStatus(probe, target) === 'downloadable') {
        await api.prepareChromeTranslator(probe, target);
      }
    } catch {
      // The page reports an unusable pair when it gets there.
    }
  };

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

    const missing = Object.keys(validateSettingsForStart(settings))[0] as ApiKeyField | undefined;
    if (missing) {
      setMessage(t(MISSING_KEY_MESSAGES[missing]));
      return;
    }
    if (requiredApiKeys(settings).includes('groqApiKey') && !await api.requestPermission('groq')) {
      setMessage(t(PERMISSION_DENIED_MESSAGES.groq));
      return;
    }
    if (
      settings.transcriber === 'gemini-read-ahead' &&
      settings.readAheadRecognizer === 'local' &&
      !await api.localWhisperCached(settings.localWhisperModel).catch(() => false)
    ) {
      setMessage(t('localWhisperModelMissing'));
      return;
    }
    // The start click is a user gesture: the moment to download Chrome's
    // language pack, which a Whisper recognizer needs, and a caption track
    // without a target-language track too, whatever the recognizer (ADR 0007).
    if (settings.transcriber === 'gemini-read-ahead') {
      void prepareChromeTranslation(settings.geminiSourceLanguage, settings.geminiTargetLanguage);
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
  const recognizer = settings.readAheadRecognizer;
  const keys = requiredApiKeys(settings);
  const chromeBlocked = chromeStatus === 'unsupported' || chromeStatus === 'unavailable';
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

      {site && 'error' in status && status.error === 'read_ahead_needs_site_access' && (
        <section className="card site-access" aria-labelledby="site-access-heading">
          <h2 id="site-access-heading">{t('siteAccessTitle')}</h2>
          <p className="field-note">{new URL(site.origin).host}</p>
          <p className="field-note">{t('siteAccessHint')}</p>
          <button
            className="secret-submit"
            type="button"
            onClick={() => {
              // Asked inside this click: Chrome allows it nowhere else.
              void api.allowSite(site).then((granted) => {
                if (!granted) setMessage(t('siteAccessDenied'));
              }, () => setMessage(t('siteAccessDenied')));
            }}
          >
            {t('siteAccessAllow')}
          </button>
        </section>
      )}

      <section className="card" aria-labelledby="provider-heading">
        <h2 id="provider-heading">{t('providerHeading')}</h2>
        <label htmlFor="transcriber">{t('captionModeLabel')}</label>
        <select
          id="transcriber"
          disabled={running}
          value={transcriber}
          onChange={(event) =>
            update('transcriber', event.target.value as TranscriberId)
          }
        >
          <option value="gemini">{t('transcriberLive')}</option>
          <option value="gemini-read-ahead">{t('transcriberReadAhead')}</option>
        </select>

        {/* Read-ahead picks recognition and translation separately; Gemini
            does both in one request, so with it the translator is fixed. */}
        {isReadAhead && (
          <>
            <label htmlFor="recognizer">{t('transcriberLabel')}</label>
            <select
              id="recognizer"
              disabled={running}
              value={recognizer}
              onChange={(event) => {
                const next = event.target.value as ReadAheadRecognizer;
                if (next === 'gemini') {
                  update('readAheadRecognizer', next);
                  return;
                }
                // Asked inside the change's user gesture.
                void prepareChromeTranslation(settings.geminiSourceLanguage, settings.geminiTargetLanguage);
                void api.requestPermission(next).then((granted) => {
                  // Local Whisper only asks for the web fallback's host; it
                  // works without it, as long as Chrome can translate.
                  if (granted || next === 'local') update('readAheadRecognizer', next);
                  else setMessage(t(PERMISSION_DENIED_MESSAGES.groq));
                });
              }}
            >
              <option value="local" disabled={webGpu === false && recognizer !== 'local'}>
                {t('recognizerLocal')}
              </option>
              <option value="groq">Groq Whisper</option>
              <option value="gemini">{t('recognizerGemini')}</option>
            </select>
            {webGpu === false && (
              <p className="field-hint" role="note">{t('localWhisperNoWebGpu')}</p>
            )}
            {recognizer === 'local' && (
              <LocalWhisperPanel
                cached={modelCached}
                disabled={running}
                download={download?.model === settings.localWhisperModel ? download : undefined}
                model={settings.localWhisperModel}
                onDelete={() => {
                  void api.deleteLocalWhisper(settings.localWhisperModel)
                    .then(() => setModelCached(false), () => setMessage(t('localWhisperDeleteFailed')));
                }}
                onDownload={() => {
                  void api.downloadLocalWhisper(settings.localWhisperModel)
                    .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
                }}
                onModel={(model) => update('localWhisperModel', model)}
              />
            )}
            <CheckField
              checked={settings.preferCaptionTracks}
              disabled={running}
              hint={t('recognizerCaptionTrackHint')}
              id="prefer-caption-tracks"
              label={t('preferCaptionTracksLabel')}
              onChange={(checked) => update('preferCaptionTracks', checked)}
            />
            <CheckField
              checked={settings.wordHighlight}
              disabled={running}
              hint={t('wordHighlightHint')}
              id="word-highlight"
              label={t('wordHighlightLabel')}
              onChange={(checked) => update('wordHighlight', checked)}
            />
            {settings.wordHighlight && recognizer === 'gemini' && (
              <p className="field-hint" role="note">{t('wordHighlightGeminiHint')}</p>
            )}
            {/* With a Whisper recognizer the viewer picks the translator
                (issue #29): Chrome's built-in Translator (where it cannot,
                Google's web translation does, automatically), or Groq
                (Qwen). Gemini translates by itself, so with it the
                translator is fixed. */}
            <label htmlFor="translator">{t('translatorLabel')}</label>
            <select
              id="translator"
              disabled={running || recognizer === 'gemini'}
              value={recognizer === 'gemini' ? 'gemini' : settings.readAheadTranslator}
              onChange={(event) => {
                const next = event.target.value as ReadAheadTranslator;
                if (next === 'chrome') {
                  update('readAheadTranslator', next);
                  return;
                }
                // Asked inside the change's user gesture.
                void api.requestPermission('groq').then((granted) => {
                  if (granted) update('readAheadTranslator', next);
                  else setMessage(t('groqTranslatorPermissionDenied'));
                });
              }}
            >
              {recognizer === 'gemini' ? (
                <option value="gemini">Gemini</option>
              ) : (
                <>
                  <option value="chrome">
                    {chromeBlocked ? t('translatorWebFallback') : t('translatorChrome')}
                  </option>
                  <option value="groq">{t('translatorGroq')}</option>
                </>
              )}
            </select>
            {recognizer !== 'gemini' && settings.readAheadTranslator === 'groq' && (
              <p className="field-hint" role="note">{t('translatorGroqHint')}</p>
            )}
            {recognizer !== 'gemini' && settings.readAheadTranslator === 'chrome' && chromeBlocked && (
              <p className="field-hint" role="note">
                {t(chromeStatus === 'unsupported'
                  ? 'translatorWebFallbackHintComputer'
                  : 'translatorWebFallbackHintLanguage')}
              </p>
            )}
          </>
        )}

        {keys.includes('geminiApiKey') && (
          <>
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
          </>
        )}
        {keys.includes('groqApiKey') && (
          <>
            <ProviderLink href="https://console.groq.com/keys" label="console.groq.com" />
            <ConfigurableSecretField
              id="groq-key"
              label="Groq API Key"
              onSave={(groqApiKey) => {
                update('groqApiKey', groqApiKey);
              }}
              onToggle={() => setRevealedSecret((current) =>
                current === 'groq-key' ? undefined : 'groq-key'
              )}
              revealed={revealedSecret === 'groq-key'}
              value={settings.groqApiKey}
            />
          </>
        )}
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
          {!isReadAhead && settings.geminiTargetLanguage === 'zh-HK' && (
            <p className="field-hint" role="note">{t('targetHongKongLiveHint')}</p>
          )}
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
  if (error === 'read_ahead_needs_site_access') return 'errorReadAheadNeedsSiteAccess';
  if (status.state === 'running') return 'statusRunning';
  if (status.state === 'starting') return 'statusStarting';
  if (status.state === 'error') return 'statusRetry';
  return 'statusIdle';
}

const MISSING_KEY_MESSAGES = {
  geminiApiKey: 'needGeminiKey',
  groqApiKey: 'needGroqKey',
} as const satisfies Record<ApiKeyField, MessageKey>;

const PERMISSION_DENIED_MESSAGES = {
  groq: 'groqPermissionDenied',
} as const satisfies Record<'groq', MessageKey>;

// A read-ahead on/off choice with what it does underneath.
function CheckField({
  checked,
  disabled,
  hint,
  id,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  hint: string;
  id: string;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="check-field">
      <label className="check-row" htmlFor={id}>
        <input
          checked={checked}
          disabled={disabled}
          id={id}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
      <p className="field-note">{hint}</p>
    </div>
  );
}

// Local Whisper's model: which one, whether it is downloaded, and the download
// (shown with its size before anything is fetched) or deletion.
function LocalWhisperPanel({
  cached,
  disabled,
  download,
  model,
  onDelete,
  onDownload,
  onModel,
}: {
  cached: boolean | undefined;
  disabled: boolean;
  download: LocalWhisperDownload | undefined;
  model: LocalWhisperModel;
  onDelete(): void;
  onDownload(): void;
  onModel(model: LocalWhisperModel): void;
}) {
  const spec = LOCAL_WHISPER_SPECS[model];
  const downloading = downloadInProgress(download, Date.now());
  // A download that stopped reporting (the browser or the offscreen document
  // was closed) counts as failed: it can be started again.
  const stalled = download?.state === 'downloading' && !downloading;
  return (
    <div className="local-whisper">
      <label htmlFor="local-model">{t('localWhisperModelLabel')}</label>
      <select
        id="local-model"
        disabled={disabled || downloading}
        value={model}
        onChange={(event) => onModel(event.target.value as LocalWhisperModel)}
      >
        {LOCAL_WHISPER_MODEL_IDS.map((id) => (
          <option key={id} value={id}>
            {t(id === 'turbo' ? 'localWhisperModelTurbo' : 'localWhisperModelSmall',
              String(LOCAL_WHISPER_SPECS[id].downloadMB))}
          </option>
        ))}
      </select>
      {downloading ? (
        <p className="field-note" role="status">
          {t('localWhisperDownloading', String(download?.loadedMB ?? 0), String(download?.totalMB || spec.downloadMB))}
        </p>
      ) : cached ? (
        <p className="field-note" role="status">
          {t('localWhisperReady')}{' '}
          <button className="link-button" disabled={disabled} type="button" onClick={onDelete}>
            {t('localWhisperDelete')}
          </button>
        </p>
      ) : cached === false ? (
        <>
          {(download?.state === 'failed' || stalled) && (
            <p className="field-hint" role="alert">{t('localWhisperDownloadFailed')}</p>
          )}
          <button className="secret-submit" disabled={disabled} type="button" onClick={onDownload}>
            {t('localWhisperDownload', String(spec.downloadMB))}
          </button>
          <p className="field-note" role="note">{t('localWhisperDownloadHint')}</p>
        </>
      ) : null}
    </div>
  );
}

// The Translator API needs a source language; with auto-detect, English is the
// pair worth probing (and pre-downloading) in the popup.
function chromeProbeSource(source: string | undefined): string {
  return !source || source === GEMINI_AUTO_SOURCE ? 'en' : source;
}

function ProviderLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="provider-link" href={href} rel="noreferrer" target="_blank">
      {t('providerSignupLink', label)}
    </a>
  );
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
