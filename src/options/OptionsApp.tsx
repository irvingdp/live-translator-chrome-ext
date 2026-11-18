import { useEffect, useState } from 'react';

import { t } from '../core/i18n';
import type { ApiKeySettings, OptionsApi } from './browser-api';

const EMPTY_KEYS: ApiKeySettings = {
  geminiApiKey: '',
  groqApiKey: '',
};

export function OptionsApp({ api }: { api: OptionsApi }) {
  const [keys, setKeys] = useState<ApiKeySettings>();
  const [showGemini, setShowGemini] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
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
        <SecretField
          id="groq-key"
          label="Groq API Key"
          onChange={(groqApiKey) =>
            setKeys((current) => ({
              ...(current ?? EMPTY_KEYS),
              groqApiKey,
            }))
          }
          onToggle={() => setShowGroq((value) => !value)}
          revealed={showGroq}
          value={keys.groqApiKey}
        />
        <p className="privacy">{t('optionsKeyHint')}</p>
      </section>

      <AllowedSites api={api} />

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

// Sites allowed for read-ahead (ADR 0009), each removable: removing one drops
// its registration and gives its permission back.
function AllowedSites({ api }: { api: OptionsApi }) {
  const [sites, setSites] = useState<string[]>();
  useEffect(() => {
    void api.listSites().then(setSites, () => setSites([]));
  }, [api]);
  return (
    <section className="card" aria-labelledby="allowed-sites-heading">
      <h2 id="allowed-sites-heading">{t('allowedSitesTitle')}</h2>
      {sites && sites.length === 0 && <p className="privacy">{t('allowedSitesEmpty')}</p>}
      <ul className="allowed-sites">
        {sites?.map((origin) => (
          <li key={origin}>
            <span>{new URL(origin).host}</span>
            <button
              type="button"
              onClick={() => {
                void api.removeSite(origin).then(() =>
                  setSites((current) => current?.filter((site) => site !== origin)));
              }}
            >
              {t('allowedSitesRemove')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
