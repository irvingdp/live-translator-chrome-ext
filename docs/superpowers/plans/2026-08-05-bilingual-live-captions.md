# Bilingual Live Captions Implementation Plan

**Goal:** Build a Chrome 116+ MV3 extension that captures one tab, streams audio to Deepgram, translates stable phrases with DeepL, and renders bilingual captions over the tab's video.

**Stack:** WXT, React, TypeScript, Vitest, Playwright.

## Global Constraints

- One active capture session at a time.
- Deepgram and DeepL credentials are BYOK and stored only in `chrome.storage.local`.
- DeepL is called directly by the extension service worker; a real Free and Pro key compatibility test is a release gate.
- Source transcript updates from interim events; translations update only for stable phrases and final segments.
- Warm-session latency SLO is p50 <= 800 ms and p95 <= 1500 ms; 500 ms is a stretch metric.
- Whisper, Gemini Live, system audio, and desktop always-on-top captions are visible as unavailable future options only.

## Tasks

1. Establish the WXT test/build baseline and the direct DeepL compatibility boundary.
2. Implement transcript revisions, stable phrase extraction, DeepL requests, deduplication, and stale-response rejection with TDD.
3. Implement offscreen tab audio resampling and Deepgram streaming with TDD around pure boundaries.
4. Implement single-tab session orchestration, navigation survival, stop, and reconnect behavior.
5. Implement Shadow DOM captions, fullscreen relocation, generic video detection, and YouTube/Netflix/Disney+ adapters.
6. Implement the popup/options experience, BYOK settings, language selection, font controls, privacy notice, and disabled future providers.
7. Run unit, integration, build, security, real-provider, site, and latency release gates.
