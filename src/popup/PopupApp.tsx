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
  const [revealedSecret, setRevealedSecret] = useState<string>();
  const [editingSecrets, setEditingSecrets] = useState<Record<string, boolean>>({});
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
        <button
          aria-checked={running}
          aria-label={t(busy ? 'working' : running ? 'stopCaptions' : 'startCaptions')}
          className={`session-toggle session-toggle-${'error' in status && status.error ? 'error' : status.state}`}
          disabled={busy}
          role="switch"
          type="button"
          onClick={() => void toggleSession()}
        >
          <span className="session-status">{t(statusMessageKey(status))}</span>
          <span aria-hidden="true" className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </button>
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

        {isGemini && (
          <ConfigurableSecretField
            editing={Boolean(editingSecrets['gemini-key'])}
            id="gemini-key"
            label="Gemini API Key"
            onChange={(geminiApiKey) => {
              setEditingSecrets((current) => ({ ...current, 'gemini-key': true }));
              update('geminiApiKey', geminiApiKey);
            }}
            onEdit={() => setEditingSecrets((current) => ({
              ...current,
              'gemini-key': true,
            }))}
            onToggle={() => setRevealedSecret((current) =>
              current === 'gemini-key' ? undefined : 'gemini-key'
            )}
            revealed={revealedSecret === 'gemini-key'}
            value={settings.geminiApiKey}
          />
        )}

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
            <ConfigurableSecretField
              editing={Boolean(editingSecrets['deepgram-key'])}
              id="deepgram-key"
              label="Deepgram API Key"
              onChange={(deepgramApiKey) => {
                setEditingSecrets((current) => ({
                  ...current,
                  'deepgram-key': true,
                }));
                update('deepgramApiKey', deepgramApiKey)
              }}
              onEdit={() => setEditingSecrets((current) => ({
                ...current,
                'deepgram-key': true,
              }))}
              onToggle={() => setRevealedSecret((current) =>
                current === 'deepgram-key' ? undefined : 'deepgram-key'
              )}
              revealed={revealedSecret === 'deepgram-key'}
              value={settings.deepgramApiKey}
            />
            <ConfigurableSecretField
              editing={Boolean(editingSecrets['deepl-key'])}
              id="deepl-key"
              label="DeepL API Key"
              onChange={(deeplApiKey) => {
                setEditingSecrets((current) => ({
                  ...current,
                  'deepl-key': true,
                }));
                update('deeplApiKey', deeplApiKey);
              }}
              onEdit={() => setEditingSecrets((current) => ({
                ...current,
                'deepl-key': true,
              }))}
              onToggle={() => setRevealedSecret((current) =>
                current === 'deepl-key' ? undefined : 'deepl-key'
              )}
              revealed={revealedSecret === 'deepl-key'}
              value={settings.deeplApiKey}
            />
          </>
        )}
        <div className="provider-summary">
          <p className={`provider-state ${keysConfigured ? 'configured' : ''}`}>
            {t(keysConfigured ? 'keysConfigured' : 'keysMissing')}
          </p>
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
        {!isGemini && (
          <>
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
          </>
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

function ConfigurableSecretField({
  editing,
  id,
  label,
  onChange,
  onEdit,
  onToggle,
  revealed,
  value,
}: {
  editing: boolean;
  id: string;
  label: string;
  onChange(value: string): void;
  onEdit(): void;
  onToggle(): void;
  revealed: boolean;
  value: string;
}) {
  if (value.trim() && !editing) {
    return (
      <div className="configured-secret">
        <span>{label}</span>
        <button
          aria-label={`${t('resetApiKey')} ${label}`}
          className="link-button"
          type="button"
          onClick={onEdit}
        >
          {t('resetApiKey')}
        </button>
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="secret-row">
        <input
          autoComplete="off"
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          aria-label={t(revealed ? 'hideSecret' : 'showSecret', label)}
          type="button"
          onClick={onToggle}
        >
          {t(revealed ? 'hide' : 'show')}
        </button>
      </div>
    </div>
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
