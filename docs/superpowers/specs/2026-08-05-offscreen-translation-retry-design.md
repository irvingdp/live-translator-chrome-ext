# Offscreen Translation Retry Design

## Problem

The configured DeepL API Free key succeeds against the official API and through
the project's `DeepLClient` live test, but translation requests made during a
Chrome extension session can still fail with an uncategorized runtime network
error. English transcription remains healthy, so a translation failure must not
tear down tab audio capture or Deepgram.

The current background service worker performs DeepL fetches directly. The fix
will move those fetches into the already-required offscreen document, whose
lifetime is tied to the active capture session, and will add a bounded
session-level retry circuit.

## Goals

- Keep English captions running through every DeepL failure.
- Execute DeepL network requests in the offscreen document instead of the
  background service worker.
- Allow at most five consecutive failed DeepL attempts per capture session.
- Stop all further DeepL requests for the session after the fifth consecutive
  failure.
- Reset the failure count after a successful translation or when a new capture
  session starts.
- Cancel stale translation work without consuming the failure budget.
- Show a specific overlay message when translation has been disabled.

## Non-goals

- Reconnecting or changing the Deepgram streaming pipeline.
- Persisting the retry circuit across capture sessions or browser restarts.
- Adding user-configurable retry counts or delays.
- Retrying after the circuit opens within the same session.

## Architecture

### Background orchestration

`CaptureSessionController` and `TranslationCoordinator` remain responsible for
deciding which stabilized transcript phrase should be translated. The
background translation dependency will no longer call `DeepLClient` directly.
It will send a `TRANSLATE_REQUEST` message to the offscreen document and await a
typed response.

Every request includes the capture `sessionId`, a unique `requestId`, and the
existing `TranslationRequest`. When the coordinator aborts a stale revision,
the background sends `TRANSLATE_CANCEL` for that request. The background keeps
the runtime message response pending, which keeps the service worker alive
without making it own the network operation.

### Offscreen translation controller

A new `OffscreenTranslationController` owns:

- the current capture session ID;
- the consecutive DeepL failure count;
- whether the session circuit is open;
- abort controllers for active request IDs;
- the `DeepLClient` and an injectable delay function.

`CAPTURE_START` resets the controller for the new session. `CAPTURE_STOP`
cancels active translation requests and clears session state.

The offscreen controller returns successful translated text or a serializable
provider error code. API keys are never logged, placed in URLs, or persisted in
the retry state.

## Retry and circuit semantics

One initial provider call counts as the first attempt. A non-abort failure
increments the consecutive failure count. If the count is below five, the same
current request waits with bounded exponential backoff and retries. Delays are
250 ms, 500 ms, 1 second, and 2 seconds before attempts two through five.

Any successful translation resets the consecutive failure count to zero.

Cancellation caused by a newer transcript, session stop, or session replacement
does not increment the count and does not show an error. Cancellation interrupts
both an active fetch and a pending retry delay.

After the fifth consecutive failure, the circuit opens. The failing request
returns `translation_disabled`; every later translation request in the same
session returns that status without calling DeepL. English captions continue.
Only starting a new capture session closes the circuit and restores the full
five-attempt budget.

## User-visible behavior

Before the circuit opens, transient translation retries do not replace the
current English caption with an error. If a later retry succeeds, translated
captions resume normally.

When the fifth consecutive attempt fails, the overlay displays:

> DeepL 連續失敗 5 次，本次字幕已停止翻譯

The popup status indicates a translation error while the overall capture state
remains `running`. Stop/start creates a new session and permits DeepL requests
again.

## Error handling

Known DeepL HTTP failures retain their existing provider codes. Browser/network
fetch failures are normalized to `network_error`. The circuit-open result uses
`translation_disabled`. Both are safe, non-secret codes that can cross runtime
message boundaries.

Malformed offscreen responses are treated as `invalid_response` and consume the
same session failure budget inside the offscreen controller only when they came
from the provider. Transport failure between background and offscreen remains a
session error but must not stop English capture.

## Testing

Unit tests will verify:

- a network failure is retried and a later success resets the counter;
- five consecutive failures open the circuit and prevent subsequent provider
  calls;
- stale-request cancellation consumes no failure budget;
- session reset closes the circuit and restores the retry budget;
- retry delays follow the bounded schedule;
- background abort sends cancellation to the matching offscreen request;
- provider error codes survive message serialization;
- the overlay renders the translation-disabled message;
- existing Deepgram capture, transcript stabilization, and stop behavior remain
  unchanged.

The complete TypeScript compile, Vitest suite, and Chrome MV3 production build
must pass before browser retesting.
