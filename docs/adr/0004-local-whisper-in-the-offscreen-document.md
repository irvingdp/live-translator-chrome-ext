---
status: accepted
---

# Local Whisper: Whisper on the viewer's computer, in the offscreen document

Read-ahead's cloud recognizers have daily quotas and need keys (ADR 0002). **Local Whisper** adds a recognizer with neither. It runs a Whisper model on the viewer's own computer, in the browser, with transformers.js on WebGPU (issue #15).

- It runs in the **offscreen document**, which already exists for live capture: WebGPU works there, one loaded model serves every tab, and YouTube's page CSP does not apply. The background sends it each chunk's audio and gets sentences back. From there they go the way Groq's do: the same sentence shaping, then Chrome's translator or Google's web translation.
- **Models offered:** `large-v3-turbo` (default, 566 MB) and `small` (325 MB). These are `onnx-community/whisper-*_timestamped`, the exports with word timestamps.
- **Download:** nothing is fetched until the viewer presses "下載模型（N MB）" in the popup. The download runs in the offscreen document, so closing the popup does not stop it. It reports its own progress and its end as messages, which the background writes to `chrome.storage.session`. The service worker never waits on it: Chrome stops a worker that spends over 5 minutes on one message. The first version did wait, and froze at 394 MB of 566. A download not heard from for 2 minutes counts as stopped and can be started again. Files already finished stay cached, so a restart fetches only what is missing. Files are kept in the extension's Cache Storage (`transformers-cache`). The popup can delete them.
- **Start:** a session on Local Whisper starts only when the chosen model is fully cached. Before read-ahead begins, the model is loaded onto the GPU, so the first chunks do not wait for it.
- **The default recognizer** for a viewer who has never chosen one is Local Whisper where the computer has WebGPU, else Groq Whisper. Either way Chrome's built-in Translator translates. This was the user's call, made so read-ahead does not lean on Gemini's 500-a-day quota. A stored choice is never changed. Settings from before 1.5.0 have no choice stored, so those viewers get the new default.
- **No WebGPU, no Local Whisper:** the option is disabled, with the reason. There is no CPU fallback.
- **No automatic switching.** A chunk that takes over 7 s shows "本地 Whisper 在 7 秒內沒有辨識完" and suggests the smaller model or Groq. The overlay offers "改用 Groq Whisper". The other way round, when Groq cannot serve (it is slow, rate-limiting, unavailable or out of quota), the overlay offers "改用本地 Whisper", but only if the computer has WebGPU, which the service worker checks. With the model downloaded, the button restarts the session on Local Whisper from where the viewer is, after loading the model. Without it, the button stops the captions and opens the popup, already on Local Whisper, at its download button. So the buttons lead Gemini → Groq → Local Whisper.

## Measurements (2026-11-17, the user's Mac, WebGPU)

Same 60 s TED clip as the Groq spike, in 15 s chunks, plus a 15.9 s synthesized Taiwan Mandarin clip:

| model / device | download | first load | per 15 s chunk | first-word timing, median / p90 | Chinese errors (of ~65) |
|---|---|---|---|---|---|
| base / WebGPU | 113 MB | 14 s | 0.8–1.9 s | 0.43 / 0.64 s | 5 |
| small / WebGPU | 325 MB | 37 s | 1.4–1.8 s | 0.45 / 0.62 s | 1 |
| large-v3-turbo / WebGPU | 566 MB | 61 s | 1.6–1.8 s | 0.43 / 0.59 s | 0 |
| base / WASM (CPU) | 80 MB | 9 s | 2.5–4.4 s | 0.43 / 0.64 s | 4 |

"First load" includes the download. Groq for comparison: 0.3–1.1 s per chunk, timing median 0.29 s.

## Considered Options

- **A server the viewer runs themselves** (whisper.cpp on `localhost`): faster, and could use any model, but it needs an install and something kept running. Rejected for this version.
- **base:** too many Chinese errors ("公立" as "功力", "毅力" as "意力") to be worth its smaller size.
- **CPU (WASM) where WebGPU is missing:** even base misses the 3 s per chunk target, and the larger models would be slower still.
- **Running in the page:** YouTube's CSP and a model per tab.
- **A Traditional Chinese prompt**, which Groq now gets for speech set as Traditional Chinese: transformers.js 4.3.2 does not implement Whisper's `prompt_ids`. Local Whisper writes Chinese as the model chooses, usually Simplified.

## Consequences

- ONNX Runtime's WebAssembly (`ort-wasm-simd-threaded.asyncify`, 27 MB) is shipped in the package under `ort/`. An extension page may not load code from a CDN. transformers.js imports it directly, with `useWasmCache` off, because the extension's CSP blocks the `blob:` module it would otherwise make. MV3's default CSP (`script-src 'self'`) does not allow compiling WebAssembly; the first build failed on it ("no available backend found … violates … script-src 'self'"). So the manifest now sets `extension_pages` to `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`, and the manifest check requires exactly that. `'wasm-unsafe-eval'` allows WebAssembly only, not `eval` or remote code. The model weights are data, not code.
- Hugging Face serves the model files with permissive CORS. So no host permission is needed, unlike the plan in issue #15. Choosing Local Whisper only asks for the web translation fallback's host.
- The offscreen document's reasons are now `USER_MEDIA` and `WORKERS`. It stays open while a session runs, and closes after a session or a download, as before.
- Word timing is about 0.45 s after the human caption's start, slightly later than Groq's.
