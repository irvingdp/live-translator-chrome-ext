import { useEffect, useRef, useState } from 'react';

import type { SessionStatus } from '../core/capture-session-controller';
import {
  DEFAULT_SETTINGS,
  LANGUAGE_OPTIONS,
  normalizeSettings,
  type AppSettings,
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
  const [errors, setErrors] = useState<
    Partial<Record<'deepgramApiKey' | 'deeplApiKey', string>>
  >({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showDeepgramKey, setShowDeepgramKey] = useState(false);
  const [showDeeplKey, setShowDeeplKey] = useState(false);
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
        setMessage('無法載入設定，請重新開啟擴充功能。');
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
          setMessage('設定儲存失敗，請重試。');
        });
      return next;
    });
    if (key === 'deepgramApiKey' || key === 'deeplApiKey') {
      setErrors((current) => ({ ...current, [key]: undefined }));
    }
  };

  const toggleSession = async () => {
    if (!settings || busy) return;
    if (status.state === 'running' || status.state === 'starting') {
      sessionAttempt.current += 1;
      setBusy(true);
      try {
        setStatus(await api.stop());
        setMessage('字幕已停止');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '停止字幕失敗');
      } finally {
        setBusy(false);
      }
      return;
    }

    const nextErrors = validateSettingsForStart(settings);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

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
            : '啟動失敗，請檢查 API Key 與目前分頁。',
        );
      }
    }
  };

  if (!settings) {
    return <main className="popup loading" aria-busy="true">載入設定中…</main>;
  }

  const running = status.state === 'running' || status.state === 'starting';
  return (
    <main className="popup">
      <header className="header">
        <div>
          <p className="eyebrow">LIVE CAPTIONS</p>
          <h1>雙語即時字幕翻譯</h1>
        </div>
        <span className={`status status-${'error' in status && status.error ? 'error' : status.state}`}>
          {'error' in status && status.error === 'translation_failed'
            ? '翻譯異常'
            : status.state === 'running'
            ? '運作中'
            : status.state === 'starting'
              ? '連線中'
              : status.state === 'error'
                ? '需重試'
                : '待命'}
        </span>
      </header>

      <section className="card" aria-labelledby="provider-heading">
        <h2 id="provider-heading">服務提供者</h2>
        <label htmlFor="transcriber">語音辨識</label>
        <select id="transcriber" defaultValue="deepgram" disabled={running}>
          <option value="deepgram">Deepgram Nova-3</option>
          <option disabled>本地 Whisper（即將推出）</option>
        </select>
        <SecretField
          error={errors.deepgramApiKey}
          id="deepgram-key"
          label="Deepgram API Key"
          onChange={(value) => update('deepgramApiKey', value)}
          onToggle={() => setShowDeepgramKey((value) => !value)}
          revealed={showDeepgramKey}
          value={settings.deepgramApiKey}
        />

        <label htmlFor="translator">翻譯</label>
        <select id="translator" defaultValue="deepl" disabled={running}>
          <option value="deepl">DeepL API</option>
          <option disabled>Gemini 3.5 Live（即將推出）</option>
        </select>
        <SecretField
          error={errors.deeplApiKey}
          id="deepl-key"
          label="DeepL API Key"
          onChange={(value) => update('deeplApiKey', value)}
          onToggle={() => setShowDeeplKey((value) => !value)}
          revealed={showDeeplKey}
          value={settings.deeplApiKey}
        />
      </section>

      <section className="card grid" aria-labelledby="language-heading">
        <h2 id="language-heading">語言</h2>
        <div>
          <label htmlFor="source-language">來源語言</label>
          <select
            id="source-language"
            disabled={running}
            value={settings.sourceLocale}
            onChange={(event) => {
              const option = LANGUAGE_OPTIONS.find(
                (item) => item.deepgram === event.target.value,
              );
              if (!option) return;
              update('sourceLocale', option.deepgram);
              update('sourceLanguage', option.source);
            }}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.deepgram} value={option.deepgram}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="target-language">目標語言</label>
          <select
            id="target-language"
            disabled={running}
            value={settings.targetLanguage}
            onChange={(event) => update('targetLanguage', event.target.value)}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.target} value={option.target}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card" aria-labelledby="size-heading">
        <h2 id="size-heading">字幕大小</h2>
        <RangeField
          id="original-size"
          label="原文字級"
          value={settings.originalFontSize}
          onChange={(value) => update('originalFontSize', value)}
        />
        <RangeField
          id="translation-size"
          label="譯文字級"
          value={settings.translationFontSize}
          onChange={(value) => update('translationFontSize', value)}
        />
      </section>

      <p className="privacy">
        啟動後，分頁音訊會傳送至 Deepgram，辨識文字會傳送至 DeepL。API Key
        僅保存在這台裝置的 Chrome 本機儲存空間。
      </p>
      {message && <p className="feedback" role="status">{message}</p>}
      <button
        className={`primary ${running ? 'stop' : ''}`}
        disabled={busy}
        type="button"
        onClick={() => void toggleSession()}
      >
        {busy ? '處理中…' : running ? '停止字幕' : '開始即時字幕'}
      </button>
    </main>
  );
}

function SecretField({
  error,
  id,
  label,
  onChange,
  onToggle,
  revealed,
  value,
}: {
  error?: string;
  id: string;
  label: string;
  onChange(value: string): void;
  onToggle(): void;
  revealed: boolean;
  value: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="secret-row">
        <input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button aria-label={`${revealed ? '隱藏' : '顯示'} ${label}`} type="button" onClick={onToggle}>
          {revealed ? '隱藏' : '顯示'}
        </button>
      </div>
      {error && <p className="error" id={`${id}-error`} role="alert">{error}</p>}
    </div>
  );
}

function RangeField({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange(value: number): void;
  value: number;
}) {
  return (
    <div className="range-field">
      <div className="range-label"><label htmlFor={id}>{label}</label><output>{value}px</output></div>
      <input id={id} max="48" min="16" type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}
