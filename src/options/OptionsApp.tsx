import { useEffect, useState } from 'react';

import { t } from '../core/i18n';
import type { ApiKeySettings, OptionsApi } from './browser-api';

const EMPTY_KEYS: ApiKeySettings = {
  deepgramApiKey: '',
  deeplApiKey: '',
  geminiApiKey: '',
};

export function OptionsApp({ api }: { api: OptionsApi }) {
  const [keys, setKeys] = useState<ApiKeySettings>();
  const [showDeepgram, setShowDeepgram] = useState(false);
  const [showDeepl, setShowDeepl] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void api.loadKeys().then(setKeys, () => {
      setKeys(EMPTY_KEYS);
      setMessage(t('keysLoadFailed'));
    });
  }, [api]);

  const save = async () => {
    if (!keys || saving) return;
    setSaving(true);
    setMessage('');
    try {
      await api.saveKeys(keys);
      setMessage(t('keysSaved'));
    } catch {
      setMessage(t('keysSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!keys) {
    return (
      <main className="options loading" aria-busy="true">
        {t('loadingSettings')}
      </main>
    );
  }

  return (
    <main className="options">
      <header className="options-header">
        <p className="eyebrow">EXTENSION OPTIONS</p>
        <h1>{t('optionsTitle')}</h1>
        <p className="privacy">{t('keyStorageNote')}</p>
      </header>

      <section className="card" aria-labelledby="api-key-heading">
        <h2 id="api-key-heading">{t('providerHeading')}</h2>
        <SecretField
          id="deepgram-key"
          label="Deepgram API Key"
          onChange={(deepgramApiKey) =>
            setKeys((current) => ({
              ...(current ?? EMPTY_KEYS),
              deepgramApiKey,
            }))
          }
          onToggle={() => setShowDeepgram((value) => !value)}
          revealed={showDeepgram}
          value={keys.deepgramApiKey}
        />
        <SecretField
          id="deepl-key"
          label="DeepL API Key"
          onChange={(deeplApiKey) =>
            setKeys((current) => ({
              ...(current ?? EMPTY_KEYS),
              deeplApiKey,
            }))
          }
          onToggle={() => setShowDeepl((value) => !value)}
          revealed={showDeepl}
          value={keys.deeplApiKey}
        />
        <SecretField
          id="gemini-key"
          label="Gemini API Key"
          onChange={(geminiApiKey) =>
            setKeys((current) => ({
              ...(current ?? EMPTY_KEYS),
              geminiApiKey,
            }))
          }
          onToggle={() => setShowGemini((value) => !value)}
          revealed={showGemini}
          value={keys.geminiApiKey}
        />
        <p className="privacy">{t('optionsKeyHint')}</p>
      </section>

      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
      <button
        className="primary"
        disabled={saving}
        type="button"
        onClick={() => void save()}
      >
        {t(saving ? 'saving' : 'save')}
      </button>
    </main>
  );
}

function SecretField({
  id,
  label,
  onChange,
  onToggle,
  revealed,
  value,
}: {
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
