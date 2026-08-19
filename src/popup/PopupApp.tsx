import { useEffect, useRef, useState } from 'react';

import type { SessionStatus } from '../core/capture-session-controller';
import { t, type MessageKey } from '../core/i18n';
import {
  GEMINI_AUTO_SOURCE,
  GEMINI_LANGUAGE_OPTIONS,
} from '../core/gemini-languages';
import {
  DEFAULT_SETTINGS,
  LANGUAGE_OPTIONS,
  normalizeSettings,
  SETTING_RANGES,
  type AppSettings,
  type TranscriberId,
  validateSettingsForStart,
} from '../core/settings';

export interface PopupApi {
  loadSettings(): Promise<AppSettings>;
  openOptions(): Promise<void>;
  saveSettings(settings: AppSettings): Promise<void>;
  start(settings: AppSettings): Promise<SessionStatus>;
  status(): Promise<SessionStatus>;
  stop(): Promise<SessionStatus>;
}

export function PopupApp({ api }: { api: PopupApi }) {
  const [settings, setSettings] = useState<AppSettings>();
  const [status, setStatus] = useState<SessionStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [translator, setTranslator] = useState('deepl');
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const sessionAttempt = useRef(0);

  useEffect(() => {
    void Promise.all([api.loadSettings(), api.status()]).then(
      ([loadedSettings, loadedStatus]) => {
        setSettings(normalizeSettings(loadedSettings));
        setStatus(loadedStatus);
      },
      () => {
        setSettings(DEFAULT_SETTINGS);
        setMessage(t('settingsLoadFailed'));
      },
    );
  }, [api]);

  const update = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ) => {
    setSettings((current) => {
      if (!current) return current;
      const next = normalizeSettings({ ...current, [key]: value });
      saveTail.current = saveTail.current
        .then(() => api.saveSettings(next))
        .catch(() => {
          setMessage(t('settingsSaveFailed'));
        });
      return next;
    });
  };

  const openOptions = async () => {
    try {
      await api.openOptions();
    } catch {
      setMessage(t('optionsOpenFailed'));
    }
  };

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
      setMessage(
        settings.transcriber === 'gemini'
          ? t('needGeminiKey')
          : t('needDeepgramAndDeeplKeys'),
      );
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
  const isGemini = transcriber === 'gemini';
  const keysConfigured =
    Object.keys(validateSettingsForStart(settings)).length === 0;
  return (
    <main className="popup">
      <header className="header">
        <div>
          <p className="eyebrow">LIVE CAPTIONS</p>
          <h1>{t('extName')}</h1>
        </div>
        <span className={`status status-${'error' in status && status.error ? 'error' : status.state}`}>
          {t(statusMessageKey(status))}
        </span>
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
          <option value="deepgram">Deepgram Nova-3</option>
        </select>
        <ProviderLink provider={transcriber} />

        {/* Gemini Live Translate returns the translation with the transcript,
            so there is no second provider left to choose. */}
        {!isGemini && (
          <>
            <label htmlFor="translator">{t('translatorLabel')}</label>
            <select
              id="translator"
              disabled={running}
              value={translator}
              onChange={(event) => setTranslator(event.target.value)}
            >
              <option value="deepl">DeepL API</option>
            </select>
            <ProviderLink provider={translator} />
          </>
        )}
        <div className="provider-summary">
          <p className={`provider-state ${keysConfigured ? 'configured' : ''}`}>
            {t(keysConfigured ? 'keysConfigured' : 'keysMissing')}
          </p>
          <button
            className="secondary"
            type="button"
            onClick={() => void openOptions()}
          >
            {t('openOptions')}
          </button>
        </div>
      </section>

      <section className="card grid" aria-labelledby="language-heading">
        <h2 id="language-heading">{t('languageHeading')}</h2>
        <div>
          <label htmlFor="source-language">{t('sourceLanguageLabel')}</label>
          {/* Gemini detects the source itself and offers no field to set it, so
              the picker shows what it can recognise without pretending the
              choice is ours to make. */}
          <select
            id="source-language"
            disabled={running || isGemini}
            value={isGemini ? GEMINI_AUTO_SOURCE : settings.sourceLocale}
            onChange={(event) => {
              const option = LANGUAGE_OPTIONS.find(
                (item) => item.deepgram === event.target.value,
              );
              if (!option) return;
              update('sourceLocale', option.deepgram);
              update('sourceLanguage', option.source);
            }}
          >
            {isGemini && (
              <option value={GEMINI_AUTO_SOURCE}>{t('autoDetect')}</option>
            )}
            {isGemini
              ? GEMINI_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))
              : LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.deepgram} value={option.deepgram}>
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
            value={
              isGemini ? settings.geminiTargetLanguage : settings.targetLanguage
            }
            onChange={(event) =>
              update(
                isGemini ? 'geminiTargetLanguage' : 'targetLanguage',
                event.target.value,
              )
            }
          >
            {isGemini
              ? GEMINI_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))
              : LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.target} value={option.target}>
                    {option.label}
                  </option>
                ))}
          </select>
        </div>
      </section>

      {message && <p className="feedback" role="status">{message}</p>}
      <button
        className={`primary ${running ? 'stop' : ''}`}
        disabled={busy}
        type="button"
        onClick={() => void toggleSession()}
      >
        {t(busy ? 'working' : running ? 'stopCaptions' : 'startCaptions')}
      </button>

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
      </section>

      <section className="card" aria-labelledby="layout-heading">
        <h2 id="layout-heading">{t('layoutHeading')}</h2>
        <div>
          <label htmlFor="caption-rows">{t('captionRowsLabel')}</label>
          <select
            id="caption-rows"
            value={settings.captionRows}
            onChange={(event) =>
              update('captionRows', Number(event.target.value))
            }
          >
            <option value={1}>{t('captionRows1')}</option>
            <option value={2}>{t('captionRows2')}</option>
            <option value={3}>{t('captionRows3')}</option>
          </select>
        </div>
        <RangeField
          id="caption-width"
          label={t('captionWidthLabel')}
          max={SETTING_RANGES.captionWidth.max}
          min={SETTING_RANGES.captionWidth.min}
          step={5}
          unit="%"
          value={settings.captionWidth}
          onChange={(value) => update('captionWidth', value)}
        />
        <RangeField
          id="max-line-width"
          label={t('maxLineWidthLabel')}
          max={SETTING_RANGES.maxLineWidth.max}
          min={SETTING_RANGES.maxLineWidth.min}
          step={5}
          unit={t('unitColumns')}
          value={settings.maxLineWidth}
          onChange={(value) => update('maxLineWidth', value)}
        />
        {/* Gemini preserves one complete sentence per row, so merging short
            sentences to meet a minimum width would defeat that mode. */}
        {!isGemini && (
          <RangeField
            id="min-line-width"
            label={t('minLineWidthLabel')}
            // A minimum above the maximum is clamped away on save, so
            // offering the full range lets the handle be dragged somewhere
            // it only springs back from.
            max={Math.min(
              SETTING_RANGES.minLineWidth.max,
              settings.maxLineWidth,
            )}
            min={SETTING_RANGES.minLineWidth.min}
            step={5}
            unit={t('unitColumns')}
            value={settings.minLineWidth}
            onChange={(value) => update('minLineWidth', value)}
          />
        )}
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
        <RangeField
          id="bottom-offset"
          label={t('bottomOffsetLabel')}
          max={SETTING_RANGES.bottomOffset.max}
          min={SETTING_RANGES.bottomOffset.min}
          unit="%"
          value={settings.bottomOffset}
          onChange={(value) => update('bottomOffset', value)}
        />
      </section>

      <p className="privacy">
        {t(isGemini ? 'privacyGemini' : 'privacyDeepgram')}{' '}
        {t('keyStorageNote')}
      </p>
    </main>
  );
}

// A translation problem is worth surfacing even while the session keeps
// running, so it outranks the plain state.
function statusMessageKey(status: SessionStatus): MessageKey {
  const error = 'error' in status ? status.error : undefined;
  if (error === 'translation_failed') return 'statusTranslationFailed';
  if (error === 'translation_disabled') return 'statusTranslationDisabled';
  if (status.state === 'running') return 'statusRunning';
  if (status.state === 'starting') return 'statusStarting';
  if (status.state === 'error') return 'statusRetry';
  return 'statusIdle';
}

// Where to go to sign up for the selected provider. A provider with no entry
// renders nothing, so a future option cannot ship a dead link.
const PROVIDER_SIGNUP: Record<string, { href: string; label: string }> = {
  deepgram: { href: 'https://console.deepgram.com/', label: 'console.deepgram.com' },
  deepl: { href: 'https://www.deepl.com/', label: 'www.deepl.com' },
  gemini: { href: 'https://aistudio.google.com/', label: 'aistudio.google.com' },
};

function ProviderLink({ provider }: { provider: string }) {
  const signup = PROVIDER_SIGNUP[provider];
  if (!signup) return null;
  return (
    <a
      className="provider-link"
      href={signup.href}
      rel="noreferrer"
      target="_blank"
    >
      {t('providerSignupLink', signup.label)}
    </a>
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
