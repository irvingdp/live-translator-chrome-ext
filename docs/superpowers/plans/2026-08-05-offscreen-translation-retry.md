# Offscreen Translation Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run DeepL translation in the capture session's offscreen document, retry up to five consecutive non-abort failures, and keep English captions running after translation is disabled.

**Architecture:** The background continues to stabilize transcripts and coordinate stale revisions, but delegates each DeepL request to an offscreen translation controller through typed runtime messages. The offscreen controller owns fetch, bounded backoff, cancellation, and a per-session circuit that resets on success or the next `CAPTURE_START`.

**Tech Stack:** TypeScript 7, Chrome Extensions Manifest V3, WXT 0.21, Vitest 4, native `fetch`, `AbortController`, and `chrome.runtime` messaging.

## Global Constraints

- English captions and Deepgram capture must continue through every DeepL failure.
- One initial call is attempt one; the fifth consecutive non-abort failure opens the circuit.
- Retry delays are exactly 250 ms, 500 ms, 1,000 ms, and 2,000 ms before attempts two through five.
- A successful translation resets the consecutive failure count to zero.
- Stale-request cancellation, session stop, and session replacement consume no failure budget.
- An open circuit performs no more DeepL requests until a new `CAPTURE_START`.
- API keys must never be logged, placed in URLs, or added to retry-state persistence.
- Preserve the user's existing uncommitted content-receiver and error-message changes; do not reset or overwrite unrelated worktree changes.

---

## File Structure

- `src/providers/deepl.ts`: Normalize fetch-level failures into a serializable `network_error` provider code.
- `src/providers/offscreen-translation-controller.ts`: Own offscreen retries, backoff, cancellation, session reset, and circuit state.
- `src/providers/offscreen-translation-transport.ts`: Convert background translation calls and abort signals into runtime request/cancel messages.
- `src/core/messages.ts`: Define request, cancellation, and response contracts shared by background and offscreen contexts.
- `src/core/capture-session-controller.ts`: Pass the active session ID into the translation dependency and preserve `translation_disabled` status without stopping capture.
- `entrypoints/offscreen/main.ts`: Wire the offscreen controller into `CAPTURE_START`, `CAPTURE_STOP`, `TRANSLATE_REQUEST`, and `TRANSLATE_CANCEL`.
- `entrypoints/background.ts`: Replace direct `DeepLClient` use with the offscreen transport.
- `src/content/caption-overlay.ts`: Render the terminal circuit-open message.
- `tests/providers/*.test.ts`, `tests/core/*.test.ts`, `tests/content/*.test.ts`: Protect provider, retry, transport, orchestration, and UI behavior.

---

### Task 1: Normalize DeepL Network Failures

**Files:**
- Modify: `src/providers/deepl.ts`
- Modify: `tests/providers/deepl.test.ts`

**Interfaces:**
- Produces: `ProviderErrorCode` including `'network_error'`.
- Produces: `DeepLClient.translate(request, signal)` rejecting fetch-level failures with `ProviderError('network_error')` while preserving aborts unchanged.

- [ ] **Step 1: Write failing network-normalization and abort-preservation tests**

Add to `tests/providers/deepl.test.ts`:

```ts
it('normalizes a fetch-level network failure', async () => {
  const client = new DeepLClient(
    vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
  );

  const error = await client.translate({
    apiKey: 'secret:fx',
    sourceLanguage: 'EN',
    targetLanguage: 'ZH-HANT',
    text: 'Hello',
  }).catch((reason: unknown) => reason);

  expect(error).toMatchObject({ code: 'network_error' });
});

it('preserves an aborted fetch so cancellation is not retried', async () => {
  const abort = new DOMException('aborted', 'AbortError');
  const client = new DeepLClient(
    vi.fn<typeof fetch>().mockRejectedValue(abort),
  );

  await expect(client.translate({
    apiKey: 'secret:fx',
    sourceLanguage: 'EN',
    targetLanguage: 'ZH-HANT',
    text: 'Hello',
  })).rejects.toBe(abort);
});
```

- [ ] **Step 2: Run the tests and verify the network test fails**

Run:

```bash
source /Users/ivan/.nvm/nvm.sh && nvm use 22.23.2 >/dev/null
npm test -- tests/providers/deepl.test.ts
```

Expected: FAIL because the thrown `TypeError` has no `code`.

- [ ] **Step 3: Implement minimal fetch-error normalization**

Extend `ProviderErrorCode` and wrap only the fetch boundary:

```ts
export type ProviderErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'network_error';

let response: Response;
try {
  response = await this.fetcher(resolveDeepLEndpoint(request.apiKey), options);
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  throw new ProviderError('network_error');
}
```

Keep the existing request URL, authorization header, JSON body, status mapping, and response parsing unchanged.

- [ ] **Step 4: Run the provider tests**

Run: `npm test -- tests/providers/deepl.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the provider boundary**

```bash
git add src/providers/deepl.ts tests/providers/deepl.test.ts
git commit -m "fix: normalize DeepL network failures"
```

---

### Task 2: Build the Session Retry Circuit

**Files:**
- Create: `src/providers/offscreen-translation-controller.ts`
- Create: `tests/providers/offscreen-translation-controller.test.ts`

**Interfaces:**
- Consumes: `TranslationRequest`, `ProviderError`, and `ProviderErrorCode` from `src/providers/deepl.ts`.
- Produces: `TranslationAttemptResult = { ok: true; text: string } | { error: ProviderErrorCode | 'cancelled' | 'translation_disabled'; ok: false }`.
- Produces: `OffscreenTranslationController.startSession(sessionId: string): void`.
- Produces: `OffscreenTranslationController.stopSession(sessionId: string): void`.
- Produces: `OffscreenTranslationController.translate(sessionId: string, requestId: string, request: TranslationRequest): Promise<TranslationAttemptResult>`.
- Produces: `OffscreenTranslationController.cancel(requestId: string): void`.

- [ ] **Step 1: Write failing retry, reset, circuit, and cancellation tests**

Create a harness with an injected provider and delay:

```ts
function createHarness() {
  const translate = vi.fn<(
    request: TranslationRequest,
    signal?: AbortSignal,
  ) => Promise<TranslationResult>>();
  const delays: number[] = [];
  const controller = new OffscreenTranslationController({
    delay: async (milliseconds, signal) => {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      delays.push(milliseconds);
    },
    translate,
  });
  return { controller, delays, translate };
}
```

Add these behaviors with literal expectations:

```ts
it('retries transient failures and resets the counter after success', async () => {
  const { controller, delays, translate } = createHarness();
  translate
    .mockRejectedValueOnce(new ProviderError('network_error'))
    .mockRejectedValueOnce(new ProviderError('network_error'))
    .mockRejectedValueOnce(new ProviderError('network_error'))
    .mockRejectedValueOnce(new ProviderError('network_error'))
    .mockResolvedValueOnce({ text: '你好' })
    .mockRejectedValueOnce(new ProviderError('network_error'))
    .mockRejectedValueOnce(new ProviderError('network_error'))
    .mockRejectedValueOnce(new ProviderError('network_error'))
    .mockRejectedValueOnce(new ProviderError('network_error'))
    .mockResolvedValueOnce({ text: '世界' });
  controller.startSession('session-1');

  await expect(controller.translate('session-1', 'request-1', request))
    .resolves.toEqual({ ok: true, text: '你好' });
  await expect(controller.translate('session-1', 'request-2', request))
    .resolves.toEqual({ ok: true, text: '世界' });
  expect(translate).toHaveBeenCalledTimes(10);
  expect(delays).toEqual([
    250, 500, 1_000, 2_000,
    250, 500, 1_000, 2_000,
  ]);
});

it('opens the circuit on the fifth consecutive failure', async () => {
  const { controller, delays, translate } = createHarness();
  translate.mockRejectedValue(new ProviderError('network_error'));
  controller.startSession('session-1');

  await expect(controller.translate('session-1', 'request-1', request))
    .resolves.toEqual({ error: 'translation_disabled', ok: false });
  expect(translate).toHaveBeenCalledTimes(5);
  expect(delays).toEqual([250, 500, 1_000, 2_000]);

  await controller.translate('session-1', 'request-2', request);
  expect(translate).toHaveBeenCalledTimes(5);
});

it('restores the retry budget for a new session', async () => {
  const { controller, translate } = createHarness();
  translate.mockRejectedValue(new ProviderError('network_error'));
  controller.startSession('session-1');
  await controller.translate('session-1', 'request-1', request);

  controller.startSession('session-2');
  translate.mockResolvedValueOnce({ text: '重新開始' });
  await expect(controller.translate('session-2', 'request-2', request))
    .resolves.toEqual({ ok: true, text: '重新開始' });
});

it('does not count cancellation as a failed attempt', async () => {
  const { controller, translate } = createHarness();
  translate.mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  }));
  controller.startSession('session-1');

  const pending = controller.translate('session-1', 'request-1', request);
  controller.cancel('request-1');
  await expect(pending).resolves.toEqual({ error: 'cancelled', ok: false });

  translate.mockResolvedValueOnce({ text: '仍可翻譯' });
  await expect(controller.translate('session-1', 'request-2', request))
    .resolves.toEqual({ ok: true, text: '仍可翻譯' });
});

it('serializes concurrent work so the circuit never overshoots five calls', async () => {
  const { controller, translate } = createHarness();
  translate.mockRejectedValue(new ProviderError('network_error'));
  controller.startSession('session-1');

  const first = controller.translate('session-1', 'request-1', request);
  const second = controller.translate('session-1', 'request-2', request);

  await expect(first).resolves.toEqual({
    error: 'translation_disabled',
    ok: false,
  });
  await expect(second).resolves.toEqual({
    error: 'translation_disabled',
    ok: false,
  });
  expect(translate).toHaveBeenCalledTimes(5);
});
```

Add a separate cancellation-during-delay test whose injected delay remains
pending until its signal aborts. Assert `cancel(requestId)` resolves the request
as `cancelled`, makes no second provider call, and leaves the next request with
the full retry budget. Include `'cancelled'` in the result error union but never
expose it as a session error.

- [ ] **Step 2: Run the new test and verify it fails because the controller is missing**

Run: `npm test -- tests/providers/offscreen-translation-controller.test.ts`

Expected: FAIL resolving the new module/export.

- [ ] **Step 3: Implement the offscreen controller**

Use these fixed constants and state:

```ts
const retryDelays = [250, 500, 1_000, 2_000] as const;
const maxConsecutiveFailures = 5;

export class OffscreenTranslationController {
  private active = new Map<string, AbortController>();
  private circuitOpen = false;
  private consecutiveFailures = 0;
  private queueTail: Promise<void> = Promise.resolve();
  private sessionId?: string;

  constructor(private readonly dependencies: {
    delay(milliseconds: number, signal: AbortSignal): Promise<void>;
    translate(
      request: TranslationRequest,
      signal?: AbortSignal,
    ): Promise<TranslationResult>;
  }) {}
}
```

Implementation rules:

- Reject mismatched/stale session IDs as `{ error: 'cancelled', ok: false }`.
- Return `translation_disabled` immediately when `circuitOpen` is true.
- Register exactly one `AbortController` per `requestId` and remove it in `finally`.
- Register the controller before adding work to `queueTail`; serialize provider
  work so a queued request can be cancelled before its first attempt and two
  requests can never race past the fifth failure.
- On success, set `consecutiveFailures = 0` and return translated text.
- On abort, return `cancelled` without incrementing.
- On any other error, increment once; at five set `circuitOpen = true` and return `translation_disabled`.
- Otherwise await `retryDelays[consecutiveFailures - 1]` and retry.
- `startSession` aborts old work, stores the new ID, sets count to zero, and closes the circuit.
- `stopSession` affects only the matching session and aborts all active work.

- [ ] **Step 4: Run retry-controller tests**

Run: `npm test -- tests/providers/offscreen-translation-controller.test.ts`

Expected: all tests PASS with no unhandled rejected promises.

- [ ] **Step 5: Commit the session retry circuit**

```bash
git add src/providers/offscreen-translation-controller.ts tests/providers/offscreen-translation-controller.test.ts
git commit -m "feat: add offscreen translation retry circuit"
```

---

### Task 3: Add Typed Offscreen Translation Transport

**Files:**
- Modify: `src/core/messages.ts`
- Create: `src/providers/offscreen-translation-transport.ts`
- Create: `tests/providers/offscreen-translation-transport.test.ts`

**Interfaces:**
- Consumes: `TranslationRequest` and `TranslationAttemptResult`.
- Produces messages `TRANSLATE_REQUEST` and `TRANSLATE_CANCEL`, both targeted to `'offscreen'`.
- Produces: `createOffscreenTranslationTransport(sendMessage)` returning `(sessionId: string, request: TranslationRequest, signal: AbortSignal) => Promise<string>`.

- [ ] **Step 1: Write failing transport tests**

Test literal message shapes and cancellation:

```ts
it('returns translated text from the offscreen response', async () => {
  const sent: ExtensionMessage[] = [];
  const translate = createOffscreenTranslationTransport(async (message) => {
    sent.push(message);
    return { ok: true, text: '你好' };
  }, () => 'request-1');

  await expect(translate('session-1', request, new AbortController().signal))
    .resolves.toBe('你好');
  expect(sent).toEqual([{
    target: 'offscreen',
    type: 'TRANSLATE_REQUEST',
    payload: { request, requestId: 'request-1', sessionId: 'session-1' },
  }]);
});

it('sends cancellation for the matching request ID', async () => {
  const sent: ExtensionMessage[] = [];
  const gate = Promise.withResolvers<TranslationAttemptResult>();
  const translate = createOffscreenTranslationTransport(async (message) => {
    sent.push(message);
    if (message.type === 'TRANSLATE_REQUEST') return gate.promise;
    return { error: 'cancelled', ok: false };
  }, () => 'request-1');
  const controller = new AbortController();

  const pending = translate('session-1', request, controller.signal);
  controller.abort();
  gate.resolve({ error: 'cancelled', ok: false });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(sent[1]).toEqual({
    target: 'offscreen',
    type: 'TRANSLATE_CANCEL',
    payload: { requestId: 'request-1', sessionId: 'session-1' },
  });
});
```

Also assert `{ error: 'translation_disabled', ok: false }` becomes an error object with `code === 'translation_disabled'`.

- [ ] **Step 2: Run the transport test and verify it fails**

Run: `npm test -- tests/providers/offscreen-translation-transport.test.ts`

Expected: FAIL because the transport and messages do not exist.

- [ ] **Step 3: Define message and response contracts**

Add to `ExtensionMessage`:

```ts
| {
    target: 'offscreen';
    type: 'TRANSLATE_REQUEST';
    payload: {
      request: TranslationRequest;
      requestId: string;
      sessionId: string;
    };
  }
| {
    target: 'offscreen';
    type: 'TRANSLATE_CANCEL';
    payload: { requestId: string; sessionId: string };
  }
```

Export the serializable response union from the offscreen controller module.

- [ ] **Step 4: Implement the transport with abort cleanup**

The factory accepts an injectable request-ID generator defaulting to
`crypto.randomUUID`. Attach one abort listener with `{ once: true }`, send
`TRANSLATE_CANCEL` when it fires, remove the listener in `finally`, and throw a
`DOMException('Translation cancelled', 'AbortError')` when the signal was
aborted. Convert offscreen error codes to an `Error` carrying a string `code`.

- [ ] **Step 5: Run transport and coordinator tests**

Run:

```bash
npm test -- tests/providers/offscreen-translation-transport.test.ts tests/core/translation-coordinator.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the transport boundary**

```bash
git add src/core/messages.ts src/providers/offscreen-translation-transport.ts tests/providers/offscreen-translation-transport.test.ts
git commit -m "feat: add offscreen translation transport"
```

---

### Task 4: Wire Translation Into Capture Lifecycle

**Files:**
- Modify: `src/core/capture-session-controller.ts`
- Modify: `tests/core/capture-session-controller.test.ts`
- Modify: `entrypoints/offscreen/main.ts`
- Modify: `entrypoints/background.ts`

**Interfaces:**
- Consumes: `createOffscreenTranslationTransport` from Task 3.
- Changes: `CaptureSessionDependencies.translate(sessionId, request, signal): Promise<string>`.
- Consumes: `OffscreenTranslationController` from Task 2.

- [ ] **Step 1: Update the controller test first**

Change the harness signature and assert the generated active session ID is sent:

```ts
translate: vi.fn().mockResolvedValue('翻譯'),

expect(dependencies.translate).toHaveBeenCalledWith(
  expect.any(String),
  {
    apiKey: 'deepl-key:fx',
    sourceLanguage: 'EN',
    targetLanguage: 'ZH-HANT',
    text: 'Good morning',
  },
  expect.any(AbortSignal),
);
```

Add a test that a `translation_disabled` rejection leaves status `running`,
keeps accepting original transcripts, and sends one `SESSION_ERROR` carrying
`translation_disabled`.

- [ ] **Step 2: Run the controller test and verify the signature expectation fails**

Run: `npm test -- tests/core/capture-session-controller.test.ts`

Expected: FAIL because `translate` currently receives only request and signal.

- [ ] **Step 3: Pass the active session ID through the coordinator closure**

Change the dependency and coordinator creation:

```ts
translate(
  sessionId: string,
  request: TranslationRequest,
  signal: AbortSignal,
): Promise<string>;

private createTranslationCoordinator(
  sessionId: string,
  settings: SessionSettings,
): TranslationCoordinator {
  return new TranslationCoordinator((text, signal) =>
    this.dependencies.translate(sessionId, {
      apiKey: settings.deeplApiKey,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      text,
    }, signal),
  );
}
```

Pass `sessionId` from both `startInternal` and `restore`.

- [ ] **Step 4: Wire the background transport**

Remove the background `DeepLClient`. Construct one transport:

```ts
const translateOffscreen = createOffscreenTranslationTransport(
  (message) => chrome.runtime.sendMessage(message),
);
```

Set the controller dependency to:

```ts
translate: (sessionId, request, signal) =>
  translateOffscreen(sessionId, request, signal),
```

- [ ] **Step 5: Wire the offscreen message handlers**

Instantiate `DeepLClient` and `OffscreenTranslationController` in
`entrypoints/offscreen/main.ts`. Use an abortable delay:

```ts
delay: (milliseconds, signal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new DOMException('aborted', 'AbortError'));
  }, { once: true });
}),
translate: (request, signal) => deepl.translate(request, signal),
```

In the existing listener:

- `CAPTURE_START`: call `translationController.startSession(sessionId)` before capture start.
- `CAPTURE_STOP`: call `translationController.stopSession(sessionId)` before capture stop.
- `TRANSLATE_REQUEST`: await `translationController.translate(...)` and send the result.
- `TRANSLATE_CANCEL`: call `translationController.cancel(requestId)` and respond `{ error: 'cancelled', ok: false }`.

Keep existing audio keepalive, transcript, and disconnect behavior unchanged.

- [ ] **Step 6: Run controller, offscreen capture, and transport tests**

Run:

```bash
npm test -- tests/core/capture-session-controller.test.ts tests/audio/offscreen-capture-controller.test.ts tests/providers/offscreen-translation-transport.test.ts tests/providers/offscreen-translation-controller.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit lifecycle integration**

```bash
git add src/core/capture-session-controller.ts tests/core/capture-session-controller.test.ts entrypoints/offscreen/main.ts entrypoints/background.ts
git commit -m "fix: run DeepL translation in offscreen lifecycle"
```

---

### Task 5: Surface Circuit-Open State Without Stopping Captions

**Files:**
- Modify: `src/content/caption-overlay.ts`
- Modify: `tests/content/caption-overlay.test.ts`
- Modify: `src/popup/PopupApp.tsx`
- Modify: `tests/popup/popup-app.test.tsx`

**Interfaces:**
- Consumes: `SESSION_ERROR.payload.code === 'translation_disabled'`.
- Produces: overlay text `DeepL 連續失敗 5 次，本次字幕已停止翻譯`.
- Produces: popup status label `翻譯已停用` while capture state remains `running`.

- [ ] **Step 1: Write failing overlay and popup tests**

Add to the existing overlay error table:

```ts
['translation_disabled', 'DeepL 連續失敗 5 次，本次字幕已停止翻譯'],
```

In the popup test, return:

```ts
{ error: 'translation_disabled', state: 'running', tabId: 42 }
```

and assert `screen.getByText('翻譯已停用')` is visible while the primary button
still says `停止字幕`.

- [ ] **Step 2: Run UI tests and verify they fail on missing labels**

Run:

```bash
npm test -- tests/content/caption-overlay.test.ts tests/popup/popup-app.test.tsx
```

Expected: FAIL because the new circuit-open labels are absent.

- [ ] **Step 3: Add exact user-facing mappings**

Add `translation_disabled` to `SESSION_ERROR_MESSAGES` and update the popup
status selection so this code renders `翻譯已停用`. Do not change the running
state or stop button.

- [ ] **Step 4: Run UI tests**

Run:

```bash
npm test -- tests/content/caption-overlay.test.ts tests/popup/popup-app.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the UI state**

```bash
git add src/content/caption-overlay.ts tests/content/caption-overlay.test.ts src/popup/PopupApp.tsx tests/popup/popup-app.test.tsx
git commit -m "feat: show disabled DeepL session state"
```

---

### Task 6: Full Verification and Chrome Handoff

**Files:**
- Verify: all modified files
- Build output: `output/chrome-mv3/`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a loadable Chrome MV3 extension build for manual YouTube verification.

- [ ] **Step 1: Run formatting and type checks**

Run:

```bash
git diff --check
source /Users/ivan/.nvm/nvm.sh && nvm use 22.23.2 >/dev/null
npm run compile
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: all non-live tests PASS; credential-gated provider tests may remain skipped.

- [ ] **Step 3: Build the production extension**

Run: `npm run build`

Expected: WXT reports a successful Chrome MV3 build and emits
`output/chrome-mv3/content-scripts/captions.js`, `background.js`, and
`offscreen.html`.

- [ ] **Step 4: Inspect the final diff and manifest**

Run:

```bash
git status --short
git diff --stat HEAD
sed -n '1,220p' output/chrome-mv3/manifest.json
```

Expected: only scoped source/test/docs changes are present; manifest retains
`activeTab`, `offscreen`, `scripting`, `storage`, and `tabCapture` permissions
plus the DeepL/Deepgram host permissions.

- [ ] **Step 5: Reload and manually verify in Chrome**

Reload `output/chrome-mv3` at `chrome://extensions`, refresh
`https://www.youtube.com/watch?v=DmoyA3HCPHc`, select English to Traditional
Chinese, and start captions.

Verify:

- English captions continue throughout the test.
- A successful DeepL response produces Traditional Chinese captions.
- With an injected/fake provider failure, exactly five attempts occur, then the
  overlay shows `DeepL 連續失敗 5 次，本次字幕已停止翻譯`.
- No later transcript sends another DeepL request in that session.
- Stop/start restores translation attempts.

- [ ] **Step 6: Commit any verification-only test corrections, if needed**

If verification required scoped test or implementation corrections, rerun Steps
1–5, then commit only those files with a message describing the corrected
behavior. Do not commit generated `output/` files unless the repository already
tracks them.
