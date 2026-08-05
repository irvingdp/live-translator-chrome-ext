import { useEffect, useState } from 'react';

import type { ApiKeySettings, OptionsApi } from './browser-api';

const EMPTY_KEYS: ApiKeySettings = {
  deepgramApiKey: '',
  deeplApiKey: '',
};

export function OptionsApp({ api }: { api: OptionsApi }) {
  const [keys, setKeys] = useState<ApiKeySettings>();
  const [showDeepgram, setShowDeepgram] = useState(false);
  const [showDeepl, setShowDeepl] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void api.loadKeys().then(setKeys, () => {
      setKeys(EMPTY_KEYS);
      setMessage('無法載入 API Key，請重新整理後再試。');
    });
  }, [api]);

  const save = async () => {
    if (!keys || saving) return;
    setSaving(true);
    setMessage('');
    try {
      await api.saveKeys(keys);
      setMessage('API Key 已儲存');
    } catch {
      setMessage('API Key 儲存失敗，請重試。');
    } finally {
      setSaving(false);
    }
  };

  if (!keys) {
    return (
      <main className="options loading" aria-busy="true">
        載入設定中…
      </main>
    );
  }

  return (
    <main className="options">
      <header className="options-header">
        <p className="eyebrow">EXTENSION OPTIONS</p>
        <h1>API Key 設定</h1>
        <p className="privacy">
          API Key 僅保存在這台裝置的 Chrome 本機儲存空間。
        </p>
      </header>

      <section className="card" aria-labelledby="api-key-heading">
        <h2 id="api-key-heading">服務提供者</h2>
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
        <p className="privacy">
          可以清除並儲存 Key；兩個 Key 都設定後才能開始即時字幕。
        </p>
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
        {saving ? '儲存中…' : '儲存設定'}
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
          aria-label={`${revealed ? '隱藏' : '顯示'} ${label}`}
          type="button"
          onClick={onToggle}
        >
          {revealed ? '隱藏' : '顯示'}
        </button>
      </div>
    </div>
  );
}
