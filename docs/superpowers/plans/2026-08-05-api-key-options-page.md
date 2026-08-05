# API Key Options Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Deepgram and DeepL API Key inputs from the toolbar popup to a dedicated Chrome extension options page without moving language, caption-size, or session controls.

**Architecture:** Add a focused options API that reads the shared `chrome.storage.local.settings` object and merges only the two credential fields before saving. Add a React options form over that API, then simplify the popup to show credential readiness and open Chrome's options page while retaining the existing settings and session data flow.

**Tech Stack:** TypeScript 7, React 19, WXT 0.21, Chrome Extensions Manifest V3 APIs, Vitest 4, Testing Library.

## Global Constraints

- Store credentials only in `chrome.storage.local.settings`; do not add sync storage, session storage, logging, or a new message protocol.
- The options page contains only Deepgram and DeepL API Key controls.
- Language selectors, caption-size controls, and start/stop controls stay in the popup.
- Saving credentials must preserve every non-credential `AppSettings` field.
- Secret fields default to `type="password"` and reveal text only after an explicit user action.
- Empty keys may be saved, but caption startup must remain blocked until both trimmed values are non-empty.
- All new user-facing copy is Traditional Chinese except provider product names.
- Preserve unrelated working-tree changes and stage only files named by each task.

---

### Task 1: Credential-only storage API

**Files:**
- Create: `src/options/browser-api.ts`
- Create: `tests/options/browser-api.test.ts`

**Interfaces:**
- Consumes: `AppSettings`, `DEFAULT_SETTINGS`, and `normalizeSettings` from `src/core/settings.ts`; `chrome.storage.local.get('settings')`; `chrome.storage.local.set({ settings })`.
- Produces: `ApiKeySettings`, `OptionsApi`, and `browserOptionsApi` with `loadKeys(): Promise<ApiKeySettings>` and `saveKeys(keys: ApiKeySettings): Promise<void>`.

- [ ] **Step 1: Write failing storage tests**

Create `tests/options/browser-api.test.ts` with tests that require loading normalized keys and merging new keys without changing language or font-size fields:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { browserOptionsApi } from '../../src/options/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserOptionsApi', () => {
  it('loads only the normalized API Key fields', async () => {
    const get = vi.fn().mockResolvedValue({
      settings: {
        ...DEFAULT_SETTINGS,
        deepgramApiKey: 'dg-existing',
        deeplApiKey: 'dl-existing',
      },
    });
    vi.stubGlobal('chrome', { storage: { local: { get, set: vi.fn() } } });

    await expect(browserOptionsApi.loadKeys()).resolves.toEqual({
      deepgramApiKey: 'dg-existing',
      deeplApiKey: 'dl-existing',
    });
    expect(get).toHaveBeenCalledWith('settings');
  });

  it('merges API Keys without overwriting popup settings', async () => {
    const existing = {
      ...DEFAULT_SETTINGS,
      originalFontSize: 32,
      sourceLanguage: 'JA',
      sourceLocale: 'ja',
      targetLanguage: 'ZH-HANT',
      translationFontSize: 28,
    };
    const get = vi.fn().mockResolvedValue({ settings: existing });
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { get, set } } });

    await browserOptionsApi.saveKeys({
      deepgramApiKey: 'dg-new',
      deeplApiKey: 'dl-new',
    });

    expect(set).toHaveBeenCalledWith({
      settings: {
        ...existing,
        deepgramApiKey: 'dg-new',
        deeplApiKey: 'dl-new',
      },
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `npm test -- tests/options/browser-api.test.ts`

Expected: FAIL because `../../src/options/browser-api` does not exist.

- [ ] **Step 3: Implement the credential-only API**

Create `src/options/browser-api.ts`:

```ts
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../core/settings';

export interface ApiKeySettings {
  deepgramApiKey: string;
  deeplApiKey: string;
}

export interface OptionsApi {
  loadKeys(): Promise<ApiKeySettings>;
  saveKeys(keys: ApiKeySettings): Promise<void>;
}

async function loadSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get('settings');
  return normalizeSettings(
    (stored.settings as Partial<AppSettings> | undefined) ?? DEFAULT_SETTINGS,
  );
}

export const browserOptionsApi: OptionsApi = {
  async loadKeys() {
    const { deepgramApiKey, deeplApiKey } = await loadSettings();
    return { deepgramApiKey, deeplApiKey };
  },
  async saveKeys(keys) {
    const current = await loadSettings();
    const settings = normalizeSettings({ ...current, ...keys });
    await chrome.storage.local.set({ settings });
  },
};
```

- [ ] **Step 4: Run the focused tests and verify green**

Run: `npm test -- tests/options/browser-api.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the storage boundary**

```bash
git add src/options/browser-api.ts tests/options/browser-api.test.ts
git commit -m "feat: add API key options storage"
```

### Task 2: Options page form and WXT entrypoint

**Files:**
- Create: `src/options/OptionsApp.tsx`
- Create: `tests/options/options-app.test.tsx`
- Create: `entrypoints/options/index.html`
- Create: `entrypoints/options/main.tsx`
- Modify: `entrypoints/popup/style.css`

**Interfaces:**
- Consumes: `OptionsApi` and `ApiKeySettings` from `src/options/browser-api.ts`.
- Produces: `OptionsApp({ api }: { api: OptionsApi })`; WXT's generated `options.html` and manifest `options_ui.page` entry.

- [ ] **Step 1: Write failing component tests**

Create `tests/options/options-app.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OptionsApp } from '../../src/options/OptionsApp';
import type { OptionsApi } from '../../src/options/browser-api';

function createApi(overrides: Partial<OptionsApi> = {}): OptionsApi {
  return {
    loadKeys: vi.fn().mockResolvedValue({
      deepgramApiKey: 'dg-existing',
      deeplApiKey: 'dl-existing',
    }),
    saveKeys: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('OptionsApp', () => {
  it('loads both keys into password fields', async () => {
    render(<OptionsApp api={createApi()} />);

    expect(await screen.findByLabelText('Deepgram API Key')).toHaveValue('dg-existing');
    expect(screen.getByLabelText('DeepL API Key')).toHaveValue('dl-existing');
    expect(screen.getByLabelText('Deepgram API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('DeepL API Key')).toHaveAttribute('type', 'password');
  });

  it('reveals only the selected key', async () => {
    render(<OptionsApp api={createApi()} />);
    await screen.findByLabelText('Deepgram API Key');

    fireEvent.click(screen.getByRole('button', { name: '顯示 DeepL API Key' }));

    expect(screen.getByLabelText('Deepgram API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('DeepL API Key')).toHaveAttribute('type', 'text');
  });

  it('saves edited keys and confirms success', async () => {
    const api = createApi();
    render(<OptionsApp api={api} />);
    const deepl = await screen.findByLabelText('DeepL API Key');
    fireEvent.change(deepl, { target: { value: 'dl-new' } });

    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));

    await waitFor(() => expect(api.saveKeys).toHaveBeenCalledWith({
      deepgramApiKey: 'dg-existing',
      deeplApiKey: 'dl-new',
    }));
    expect(await screen.findByText('API Key 已儲存')).toBeVisible();
  });

  it('shows visible feedback when loading fails', async () => {
    render(<OptionsApp api={createApi({
      loadKeys: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    })} />);

    expect(await screen.findByText('無法載入 API Key，請重新整理後再試。')).toBeVisible();
  });

  it('does not claim success when saving fails', async () => {
    render(<OptionsApp api={createApi({
      saveKeys: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    })} />);
    await screen.findByLabelText('DeepL API Key');

    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));

    expect(await screen.findByText('API Key 儲存失敗，請重試。')).toBeVisible();
    expect(screen.queryByText('API Key 已儲存')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing component failure**

Run: `npm test -- tests/options/options-app.test.tsx`

Expected: FAIL because `../../src/options/OptionsApp` does not exist.

- [ ] **Step 3: Implement the options form**

Create `src/options/OptionsApp.tsx` with these concrete behaviors:

```tsx
import { useEffect, useState } from 'react';

import type { ApiKeySettings, OptionsApi } from './browser-api';

const EMPTY_KEYS: ApiKeySettings = { deepgramApiKey: '', deeplApiKey: '' };

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

  if (!keys) return <main className="options loading" aria-busy="true">載入設定中…</main>;

  return (
    <main className="options">
      <header className="options-header">
        <p className="eyebrow">EXTENSION OPTIONS</p>
        <h1>API Key 設定</h1>
        <p className="privacy">API Key 僅保存在這台裝置的 Chrome 本機儲存空間。</p>
      </header>
      <section className="card" aria-labelledby="api-key-heading">
        <h2 id="api-key-heading">服務提供者</h2>
        <SecretField id="deepgram-key" label="Deepgram API Key" revealed={showDeepgram}
          value={keys.deepgramApiKey}
          onChange={(deepgramApiKey) => setKeys((current) => ({ ...(current ?? EMPTY_KEYS), deepgramApiKey }))}
          onToggle={() => setShowDeepgram((value) => !value)} />
        <SecretField id="deepl-key" label="DeepL API Key" revealed={showDeepl}
          value={keys.deeplApiKey}
          onChange={(deeplApiKey) => setKeys((current) => ({ ...(current ?? EMPTY_KEYS), deeplApiKey }))}
          onToggle={() => setShowDeepl((value) => !value)} />
        <p className="privacy">可以清除並儲存 Key；兩個 Key 都設定後才能開始即時字幕。</p>
      </section>
      {message && <p className="feedback" role="status">{message}</p>}
      <button className="primary" disabled={saving} type="button" onClick={() => void save()}>
        {saving ? '儲存中…' : '儲存設定'}
      </button>
    </main>
  );
}

function SecretField({ id, label, onChange, onToggle, revealed, value }: {
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
        <input autoComplete="off" id={id} type={revealed ? 'text' : 'password'} value={value}
          onChange={(event) => onChange(event.target.value)} />
        <button aria-label={`${revealed ? '隱藏' : '顯示'} ${label}`} type="button" onClick={onToggle}>
          {revealed ? '隱藏' : '顯示'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the WXT options entrypoint and layout styles**

Create `entrypoints/options/index.html` using the popup HTML structure, with `<title>API Key 設定</title>` and `<script type="module" src="./main.tsx"></script>`. Create `entrypoints/options/main.tsx` that imports `OptionsApp`, `browserOptionsApi`, and `../popup/style.css`, then mounts `<OptionsApp api={browserOptionsApi} />` inside `React.StrictMode`.

Append these rules to `entrypoints/popup/style.css`:

```css
.options { display: grid; gap: 16px; margin: 0 auto; max-width: 640px; padding: 32px 20px; }
.options-header { display: grid; gap: 8px; }
.options-header .privacy { max-width: 52ch; }
.provider-summary { align-items: center; display: flex; justify-content: space-between; gap: 12px; }
.provider-state { color: var(--muted); font-size: 12px; margin: 0; }
.provider-state.configured { color: #99f6e4; }
.secondary { background: #243146; border: 1px solid #475569; border-radius: 8px; color: #e2e8f0; min-height: 40px; padding: 8px 12px; }
.secondary:hover { background: #334155; }
```

- [ ] **Step 5: Run focused tests, compile, and build**

Run: `npm test -- tests/options/options-app.test.tsx tests/options/browser-api.test.ts`

Expected: 7 tests PASS.

Run: `npm run compile`

Expected: TypeScript exits 0.

Run: `npm run build`

Expected: WXT exits 0 and lists `output/chrome-mv3/options.html`.

- [ ] **Step 6: Commit the options page**

```bash
git add src/options/OptionsApp.tsx tests/options/options-app.test.tsx entrypoints/options/index.html entrypoints/options/main.tsx entrypoints/popup/style.css
git commit -m "feat: add API key options page"
```

### Task 3: Replace popup credential fields with options navigation

**Files:**
- Modify: `src/popup/PopupApp.tsx`
- Modify: `src/popup/browser-api.ts`
- Modify: `tests/popup/popup-app.test.tsx`
- Create: `tests/popup/browser-api.test.ts`

**Interfaces:**
- Consumes: existing `validateSettingsForStart(settings: AppSettings)` and `chrome.runtime.openOptionsPage()`.
- Produces: `PopupApi.openOptions(): Promise<void>`; provider readiness status based on trimmed `deepgramApiKey` and `deeplApiKey` values.

- [ ] **Step 1: Update popup component tests first**

Add `openOptions: vi.fn().mockResolvedValue(undefined)` to `createApi`. Replace the old inline-key error test and add navigation/readiness assertions:

```tsx
it('removes API Key fields and directs unconfigured users to options', async () => {
  const api = createApi();
  render(<PopupApp api={api} />);

  expect(await screen.findByText('API Key 尚未設定')).toBeVisible();
  expect(screen.queryByLabelText('Deepgram API Key')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('DeepL API Key')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
  await waitFor(() => expect(api.openOptions).toHaveBeenCalledOnce());
});

it('shows configured status when both stored keys are non-empty', async () => {
  render(<PopupApp api={createApi({
    loadSettings: vi.fn().mockResolvedValue({
      ...DEFAULT_SETTINGS,
      deepgramApiKey: 'dg',
      deeplApiKey: 'dl',
    }),
  })} />);

  expect(await screen.findByText('API Key 已設定')).toBeVisible();
});

it('blocks startup with guidance when an API Key is missing', async () => {
  const api = createApi();
  render(<PopupApp api={api} />);
  await screen.findByText('API Key 尚未設定');

  fireEvent.click(screen.getByRole('button', { name: '開始即時字幕' }));

  expect(await screen.findByText('請先在設定頁輸入 Deepgram 與 DeepL API Key。')).toBeVisible();
  expect(api.start).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write the failing browser API test**

Create `tests/popup/browser-api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserPopupApi } from '../../src/popup/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserPopupApi', () => {
  it('opens the Chrome extension options page', async () => {
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { runtime: { openOptionsPage } });

    await browserPopupApi.openOptions();

    expect(openOptionsPage).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run focused tests and verify expected failures**

Run: `npm test -- tests/popup/popup-app.test.tsx tests/popup/browser-api.test.ts`

Expected: FAIL because `PopupApi` and `browserPopupApi` lack `openOptions`, and the popup still renders the key inputs.

- [ ] **Step 4: Implement popup navigation and readiness UI**

In `src/popup/PopupApp.tsx`:

- Add `openOptions(): Promise<void>` to `PopupApi`.
- Remove `errors`, `showDeepgramKey`, `showDeeplKey`, and the popup-local `SecretField`.
- Derive `const keysConfigured = Boolean(settings.deepgramApiKey.trim() && settings.deeplApiKey.trim());`.
- Replace the provider selectors and key inputs with a `provider-summary` showing `Deepgram Nova-3 + DeepL API`, `API Key 已設定` or `API Key 尚未設定`, and a secondary `開啟設定` button.
- Have the button await `api.openOptions()` and show `無法開啟設定頁，請從擴充功能選單選擇「選項」。` if it rejects.
- Keep calling `validateSettingsForStart(settings)` before startup; if it returns any entries, set `請先在設定頁輸入 Deepgram 與 DeepL API Key。` and return before `api.saveSettings` or `api.start`.

In `src/popup/browser-api.ts`, add:

```ts
openOptions: () => chrome.runtime.openOptionsPage(),
```

- [ ] **Step 5: Run focused popup tests and verify green**

Run: `npm test -- tests/popup/popup-app.test.tsx tests/popup/browser-api.test.ts`

Expected: all popup tests PASS.

- [ ] **Step 6: Commit the popup changes**

```bash
git add src/popup/PopupApp.tsx src/popup/browser-api.ts tests/popup/popup-app.test.tsx tests/popup/browser-api.test.ts
git commit -m "feat: move API key controls out of popup"
```

### Task 4: Documentation and full verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: generated WXT manifest and existing project scripts.
- Produces: user instructions matching the options-page workflow and fresh evidence that the complete extension remains valid.

- [ ] **Step 1: Update user instructions**

Change the README startup sentence so it says the user should right-click the extension, choose `選項`, save the Deepgram and DeepL API Keys there, then use the popup to choose languages and start captions. Preserve the already-present `output/chrome-mv3` path change.

- [ ] **Step 2: Run the full automated test suite**

Run: `npm test`

Expected: all Vitest files PASS with zero failures.

- [ ] **Step 3: Run TypeScript verification**

Run: `npm run compile`

Expected: exit 0 with no TypeScript diagnostics.

- [ ] **Step 4: Build and inspect the generated manifest**

Run: `npm run build`

Expected: exit 0 and output includes `output/chrome-mv3/options.html`.

Run: `rg -n 'options_ui|options.html' output/chrome-mv3/manifest.json`

Expected: generated manifest declares the options page.

- [ ] **Step 5: Verify requirements and stale UI text**

Run: `rg -n 'Deepgram API Key|DeepL API Key|openOptions' src/popup tests/popup src/options tests/options`

Expected: Key field labels occur only in Options files/tests; popup occurrences are readiness/navigation logic or negative assertions.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 6: Commit documentation without staging generated output**

Review `git diff -- README.md` before staging because it contains the previously requested `output` path update, then commit the complete approved README update:

```bash
git add README.md
git commit -m "docs: explain extension options setup"
```

Do not stage `output/`, `.codegraph/`, `.cursor/`, `.gitignore`, or `wxt.config.ts` as part of this documentation commit.
