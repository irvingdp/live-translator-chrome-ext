# API Key Options Page Design

## Goal

Move the Deepgram and DeepL API Key inputs out of the toolbar popup and into a dedicated Chrome extension options page, while keeping language, caption size, and session controls in the popup.

## User Experience

The Chrome options page contains two password fields: `Deepgram API Key` and `DeepL API Key`. Each field has a show/hide control. The page loads the currently stored values from `chrome.storage.local.settings`; pressing `儲存設定` merges the two values into the existing settings object and displays an explicit success or failure message.

The popup no longer renders API Key inputs. Its provider section shows whether both required API Keys are configured and includes an `開啟設定` button that calls `chrome.runtime.openOptionsPage()`. Language selectors, caption-size controls, and the start/stop button remain unchanged.

If the user tries to start captions without both keys, the popup does not contact either provider. It displays a message directing the user to the options page. The existing start validation remains the source of truth for determining whether the keys are missing.

## Architecture

The popup and options page continue to share the existing `AppSettings` schema and normalization logic. Both interfaces use the same `chrome.storage.local` key, `settings`, so no background-message protocol or data migration is required.

A small options-page API boundary exposes loading and saving to the React component. Saving accepts the two key values, reloads the current stored settings, merges only `deepgramApiKey` and `deeplApiKey`, normalizes the result, and writes the full object back. This prevents the options page from overwriting language or font-size changes made by the popup.

The popup API gains an `openOptions()` operation. The browser implementation delegates to `chrome.runtime.openOptionsPage()`, while tests supply a mock implementation. The popup continues loading the full settings object on mount so session startup receives the stored keys without exposing them in the UI.

## Components and Files

- `entrypoints/options/index.html` and `entrypoints/options/main.tsx` define the WXT options entrypoint.
- `src/options/OptionsApp.tsx` renders the API Key form and owns loading, validation feedback, show/hide state, and save status.
- `src/options/browser-api.ts` reads and safely merges API Key values into `chrome.storage.local.settings`.
- `src/popup/PopupApp.tsx` removes the secret inputs, shows configuration status, and opens the options page.
- `src/popup/browser-api.ts` implements the popup's new options-page action.
- `entrypoints/popup/style.css` is extended only as needed for the options-page layout and popup configuration status; shared styling may be reused without introducing a new UI framework.

## Data Flow

1. The options page loads and normalizes `chrome.storage.local.settings`.
2. The user edits the two secret fields and presses `儲存設定`.
3. The options API rereads current storage, merges only the two API Key properties, and saves the normalized full settings object.
4. The popup loads the same full settings object when opened and derives a configured/unconfigured provider status from the trimmed key values.
5. Starting a session runs the existing validation and passes the loaded settings to the existing background session flow only when both keys are present.

## Error Handling and Security

- Secret fields use `type="password"` by default and never render keys as ordinary text unless the user explicitly selects show.
- Empty values may be saved, allowing a user to clear a key; the options page indicates that both keys are required before captions can start.
- Storage load and save failures produce visible Traditional Chinese status messages and do not claim success.
- The options page never logs, sends, or copies API Keys outside the existing local-storage and provider-request paths.
- Keys remain in `chrome.storage.local`, preserving the existing device-local storage behavior.

## Testing

- Options component tests cover loading stored values, password visibility controls, saving both keys, and visible save failures.
- Options browser API tests verify that saving keys preserves language and font-size settings.
- Popup tests verify that API Key inputs are absent, configured status is derived correctly, `開啟設定` invokes the API, and missing keys prevent session startup with guidance to use settings.
- Existing settings, provider, popup, and session tests remain green.
- Final verification runs the focused tests, full Vitest suite, TypeScript compile, and WXT production build; the build output must contain the options page declared in the generated manifest.

## Out of Scope

- Moving language or caption-size controls to the options page.
- Validating API Keys against Deepgram or DeepL while saving.
- Changing key storage to sync storage, encryption, or an external secret manager.
- Changing provider selection or adding providers.
