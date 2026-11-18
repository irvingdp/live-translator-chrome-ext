import type { PlaybackClock } from './word-highlight';
import type { LocalWhisperModel } from '../read-ahead/local-whisper';
import type {
  CaptionPairUpdate,
  CaptureStartRequest,
} from '../audio/offscreen-capture-controller';
import type {
  ChunkSentence,
  ChunkTranslationRequest,
} from '../read-ahead/gemini-chunk-translation';
import type { RecognizedChunk } from '../read-ahead/groq-transcription';
import type { ReadAheadStatus } from '../read-ahead/read-ahead-session';
import type { WebTranslationRequest } from '../read-ahead/web-translation';
import { CaptionWindow, type CaptionPair } from './caption-window';
import type { ExtensionMessage } from './messages';
import type { OverlayLayout, OverlayPlacement } from './overlay-layout';
import {
  captionAppearance,
  type CaptionAppearance,
  type ReadAheadRecognizer,
  type TranscriberId,
} from './settings';

export interface SessionSettings {
  backgroundOpacity: number;
  geminiApiKey: string;
  // Read-ahead mode only; 'auto' lets the model detect it.
  geminiSourceLanguage: string;
  geminiTargetLanguage: string;
  groqApiKey: string;
  localWhisperModel: LocalWhisperModel;
  maxLineWidth: number;
  preferCaptionTracks: boolean;
  readAheadRecognizer: ReadAheadRecognizer;
  transcriber: TranscriberId;
  wordHighlight: boolean;
  originalFontSize: number;
  originalTextColor: string;
  translationFontSize: number;
  translationTextColor: string;
}

export type TabMessage =
  | { type: 'CONTENT_PING' }
  | {
      type: 'OVERLAY_SHOW';
      payload: {
        appearance: CaptionAppearance;
        layout?: OverlayLayout;
        placement?: OverlayPlacement;
      };
    }
  | { type: 'OVERLAY_APPEARANCE'; payload: { appearance: CaptionAppearance } }
  | { type: 'OVERLAY_LAYOUT'; payload: { layout: OverlayLayout } }
  | { type: 'OVERLAY_HIDE' }
  | { type: 'CAPTION_WINDOW'; payload: { pairs: CaptionPair[] } }
  | {
      type: 'SESSION_ERROR';
      // `action` adds a button to the message (read-ahead's switch from a
      // used-up Gemini quota to Groq Whisper).
      payload: { action?: SessionErrorAction; code: string };
    }
  | { type: 'SESSION_ERROR_CLEAR' }
  | { type: 'READ_AHEAD_START'; payload: ReadAheadStartRequest }
  | { type: 'READ_AHEAD_STOP'; payload: { sessionId: string } };

export interface ReadAheadStartRequest {
  // Whether to look for the video's caption tracks (ADR 0007).
  preferCaptionTracks: boolean;
  sessionId: string;
  sourceLanguage?: string;
  targetLanguage: string;
}

export type ReadAheadStatusCode = Exclude<ReadAheadStatus, undefined> | 'unsupported';

export type SessionErrorAction = 'switch_to_groq' | 'switch_to_local' | 'use_recognizer';

const READ_AHEAD_STATUS_ERRORS: Partial<Record<ReadAheadStatusCode, string>> = {
  captions_loading: 'read_ahead_captions_loading',
  captions_video: 'read_ahead_captions_video',
  captions_youtube: 'read_ahead_captions_youtube',
  failed: 'read_ahead_failed',
  loading: 'read_ahead_loading',
  page_timeout: 'read_ahead_page_timeout',
  translating: 'read_ahead_translating',
  translator_unsupported: 'read_ahead_translator_unsupported',
  unsupported: 'read_ahead_unsupported',
  web_translation_failed: 'read_ahead_web_translation_failed',
};

// The overlay's code for a read-ahead status. A provider's failure keeps its
// own name ('groq_rate_limited'): the overlay names the service and suggests
// what to do.
function readAheadErrorCode(status: ReadAheadStatusCode): string {
  return READ_AHEAD_STATUS_ERRORS[status] ?? status;
}

// The next recognizer offered by a button when one cannot serve now (issue
// #11): Gemini → Groq Whisper → Local Whisper (where this computer can run
// it), and Local Whisper back to Groq. Only for failures
// another service fixes: not a wrong key, or a reply it could not read.
const SWITCH_ON_FAILURE = new Set(['provider_unavailable', 'quota_exceeded', 'rate_limited', 'timeout']);
const NEXT_RECOGNIZER: Partial<Record<string, SessionErrorAction>> = {
  gemini: 'switch_to_groq',
  groq: 'switch_to_local',
  // A computer too slow for its model can still use Groq.
  local: 'switch_to_groq',
};

// What one read-ahead chunk comes back as. With Chrome's built-in Translator
// the page translates the sentences itself, since that API exists only there.
export interface ReadAheadChunkResult {
  sentences: ChunkSentence[];
  translateInPage?: { sourceLanguage?: string; targetLanguage: string };
}

// A chunk that failed, named by provider and reason ('groq_quota_exceeded'),
// so the page can tell the viewer which quota ran out.
export class ReadAheadChunkError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ReadAheadChunkError';
  }
}

// Read-ahead recognition through Whisper: Groq's (ADR 0006), or on this
// computer (issue #15).
export type WhisperRecognition =
  | {
      apiKey: string;
      audioBase64: string;
      // Text Whisper continues from, to steer it (Traditional Chinese).
      prompt?: string;
      provider: 'groq';
      sourceLanguage?: string;
    }
  | { audioBase64: string; model: LocalWhisperModel; provider: 'local'; sourceLanguage?: string };

// Whisper writes Chinese in Simplified characters unless its context is
// Traditional; a Traditional Chinese prompt makes that likely, not certain.
// Only for speech the viewer said is Traditional Chinese: before English
// speech it could pull the transcript into Chinese.
const TRADITIONAL_CHINESE_PROMPT = '以下是繁體中文的句子。';
export function whisperPrompt(sourceLanguage: string | undefined): string | undefined {
  return sourceLanguage === 'zh-Hant' || sourceLanguage === 'zh-HK'
    ? TRADITIONAL_CHINESE_PROMPT
    : undefined;
}

function providerFailure(provider: 'gemini' | 'groq' | 'local') {
  return (error: unknown): never => {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'failed';
    throw new ReadAheadChunkError(`${provider}_${code}`);
  };
}

function sameLanguage(source: string, target: string): boolean {
  return source.split('-')[0]!.toLowerCase() === target.split('-')[0]!.toLowerCase();
}

export type SessionStatus =
  | { state: 'idle' }
  | { state: 'starting'; tabId: number }
  | { error?: string; state: 'running'; tabId: number }
  | { error: string; state: 'error'; tabId: number };

export interface CaptureSessionDependencies {
  ensureContentScript(tabId: number): Promise<void>;
  ensureOffscreen(): Promise<void>;
  getStreamId(tabId: number): Promise<string>;
  getOverlayLayout(tabId: number): Promise<OverlayLayout | undefined>;
  sendToOffscreen(message: ExtensionMessage): Promise<unknown>;
  sendToTab(tabId: number, message: TabMessage): Promise<unknown>;
  // Read-ahead mode: inject its scripts into the tab and start/stop it there.
  startReadAhead(tabId: number, request: ReadAheadStartRequest): Promise<void>;
  stopReadAhead(tabId: number, sessionId: string): Promise<void>;
  translateChunk(request: ChunkTranslationRequest): Promise<ChunkSentence[]>;
  // Read-ahead with a Whisper service; the page then translates with
  // Chrome's built-in Translator.
  transcribeChunk(request: WhisperRecognition): Promise<RecognizedChunk>;
  // The fallback when the page's built-in Translator cannot translate:
  // Google's web translation (ADR 0006).
  translateOnWeb(request: WebTranslationRequest, timeoutMs: number): Promise<string[]>;
  // Whether this computer can run Local Whisper (WebGPU), so it is offered.
  localWhisperUsable?(): Promise<boolean>;
}

export interface ActiveSessionSnapshot {
  sessionId: string;
  settings: SessionSettings;
  tabId: number;
}

export class CaptureSessionController {
  private activeSessionId?: string;
  private generation = 0;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private settings?: SessionSettings;
  private readonly captionWindow = new CaptionWindow(50);
  private currentStatus: SessionStatus = { state: 'idle' };
  // Read-ahead shows only the cue the main player is at; the window above
  // keeps every cue reached, for the side panel.
  private readAheadCue?: CaptionPair;
  // The main player's time as the page last reported it, for word highlight
  // in the side panel (which cannot read it).
  private readAheadClock?: PlaybackClock;

  constructor(private readonly dependencies: CaptureSessionDependencies) {}

  status(): SessionStatus {
    return this.currentStatus;
  }

  snapshot(): ActiveSessionSnapshot | undefined {
    if (
      !this.activeSessionId ||
      !this.settings ||
      this.currentStatus.state !== 'running'
    ) return undefined;
    return {
      sessionId: this.activeSessionId,
      settings: this.settings,
      tabId: this.currentStatus.tabId,
    };
  }

  restore(snapshot: ActiveSessionSnapshot): void {
    this.activeSessionId = snapshot.sessionId;
    this.settings = snapshot.settings;
    this.captionWindow.clear();
    this.currentStatus = { state: 'running', tabId: snapshot.tabId };
  }

  applyLayout(layout: {
    maxLineWidth: number;
    backgroundOpacity?: number;
    originalFontSize?: number;
    originalTextColor?: string;
    translationFontSize?: number;
    translationTextColor?: string;
  }): void {
    if (!this.settings) return;
    this.settings = { ...this.settings, ...layout };
    if (this.activeSessionId && this.settings.transcriber === 'gemini') {
      void this.dependencies.sendToOffscreen({
        target: 'offscreen',
        type: 'CAPTURE_CONFIG_UPDATE',
        payload: {
          maxLineWidth: layout.maxLineWidth,
          sessionId: this.activeSessionId,
        },
      }).catch(() => undefined);
    }
    if (this.currentStatus.state === 'running') {
      void this.dependencies.sendToTab(this.currentStatus.tabId, {
        type: 'OVERLAY_APPEARANCE',
        payload: { appearance: captionAppearance(this.settings) },
      }).catch(() => undefined);
    }
  }

  start(tabId: number, settings: SessionSettings): Promise<void> {
    return this.enqueueLifecycle(() => this.startInternal(tabId, settings));
  }

  transfer(tabId: number): Promise<void> {
    return this.enqueueLifecycle(async () => {
      if (
        this.currentStatus.state !== 'running' ||
        this.currentStatus.tabId === tabId ||
        !this.activeSessionId ||
        !this.settings ||
        // Read-ahead stays on the tab it was started in (v1).
        isReadAhead(this.settings)
      ) return;

      const sourceGeneration = this.generation;
      const sourceSessionId = this.activeSessionId;
      const settings = this.settings;

      // Prepare everything that can fail because of tab access before
      // interrupting the session that is still producing captions.
      await this.dependencies.ensureContentScript(tabId);
      await this.dependencies.ensureOffscreen();
      const streamId = await this.dependencies.getStreamId(tabId);
      if (
        sourceGeneration !== this.generation ||
        sourceSessionId !== this.activeSessionId ||
        this.currentStatus.state !== 'running'
      ) return;

      await this.startInternal(tabId, settings, {
        contentReady: true,
        streamId,
      });
    });
  }

  private async startInternal(
    tabId: number,
    settings: SessionSettings,
    prepared?: { contentReady: boolean; streamId: string },
  ): Promise<void> {
    if (this.currentStatus.state !== 'idle') await this.stopInternal();
    const generation = ++this.generation;
    const sessionId = crypto.randomUUID();
    this.activeSessionId = sessionId;
    this.currentStatus = { state: 'starting', tabId };
    this.settings = settings;
    this.captionWindow.clear();
    this.readAheadCue = undefined;
    this.readAheadClock = undefined;
    if (isReadAhead(settings)) {
      await this.startReadAheadInternal(tabId, settings, sessionId, generation);
      return;
    }
    let captureStarted = false;

    try {
      await this.dependencies.ensureOffscreen();
      if (generation !== this.generation) return;
      const streamId = prepared?.streamId ??
        await this.dependencies.getStreamId(tabId);
      if (generation !== this.generation) return;
      if (!prepared?.contentReady) {
        await this.dependencies.ensureContentScript(tabId);
      }
      if (generation !== this.generation) return;
      const payload: CaptureStartRequest = {
        apiKey: settings.geminiApiKey,
        maxLineWidth: this.settings?.maxLineWidth ?? settings.maxLineWidth,
        sessionId,
        streamId,
        targetLanguage: settings.geminiTargetLanguage,
      };
      await this.dependencies.sendToOffscreen({
        target: 'offscreen',
        type: 'CAPTURE_START',
        payload,
      });
      captureStarted = true;
      if (generation !== this.generation) {
        await this.dependencies
          .sendToOffscreen({
            target: 'offscreen',
            type: 'CAPTURE_STOP',
            payload: { sessionId },
          })
          .catch(() => undefined);
        return;
      }
      const layout = await this.dependencies.getOverlayLayout(tabId);
      await this.dependencies.sendToTab(tabId, {
        type: 'OVERLAY_SHOW',
        payload: {
          appearance: captionAppearance(settings),
          layout,
          placement: 'video-bottom',
        },
      });
      this.currentStatus = { state: 'running', tabId };
    } catch (error) {
      if (captureStarted) {
        await this.dependencies
          .sendToOffscreen({
            target: 'offscreen',
            type: 'CAPTURE_STOP',
            payload: { sessionId },
          })
          .catch(() => undefined);
      }
      if (generation === this.generation) {
        this.currentStatus = {
          error: error instanceof Error ? error.message : 'capture_start_failed',
          state: 'error',
          tabId,
        };
      }
      throw error;
    }
  }

  private async startReadAheadInternal(
    tabId: number,
    settings: SessionSettings,
    sessionId: string,
    generation: number,
  ): Promise<void> {
    try {
      await this.dependencies.ensureContentScript(tabId);
      if (generation !== this.generation) return;
      await this.dependencies.startReadAhead(tabId, readAheadRequest(sessionId, settings));
      if (generation !== this.generation) {
        await this.dependencies.stopReadAhead(tabId, sessionId).catch(() => undefined);
        return;
      }
      const layout = await this.dependencies.getOverlayLayout(tabId);
      await this.dependencies.sendToTab(tabId, {
        type: 'OVERLAY_SHOW',
        payload: {
          appearance: captionAppearance(settings),
          layout,
          placement: 'video-bottom',
        },
      });
      this.currentStatus = { state: 'running', tabId };
    } catch (error) {
      if (generation === this.generation) {
        this.currentStatus = {
          error: error instanceof Error ? error.message : 'capture_start_failed',
          state: 'error',
          tabId,
        };
      }
      throw error;
    }
  }

  private isActiveReadAhead(sessionId: string, tabId: number): boolean {
    return sessionId === this.activeSessionId &&
      Boolean(this.settings && isReadAhead(this.settings)) &&
      'tabId' in this.currentStatus &&
      this.currentStatus.tabId === tabId;
  }

  async acceptReadAheadCue(
    sessionId: string,
    tabId: number,
    cue: CaptionPair | undefined,
  ): Promise<void> {
    if (!this.isActiveReadAhead(sessionId, tabId) || this.currentStatus.state !== 'running') {
      return;
    }
    // Word highlight is the viewer's choice; without it the overlay gets the
    // plain cue.
    this.readAheadCue = cue && (this.settings?.wordHighlight || !cue.words
      ? { ...cue }
      : { id: cue.id, original: cue.original, translation: cue.translation });
    if (cue) {
      this.captionWindow.upsertOriginal(cue.id, cue.original);
      this.captionWindow.upsertTranslation(cue.id, cue.translation);
      if (this.readAheadCue?.words) this.captionWindow.upsertWords(cue.id, this.readAheadCue.words);
    }
    await this.sendWindow(tabId);
  }

  acceptReadAheadClock(sessionId: string, tabId: number, clock: PlaybackClock): void {
    if (!this.isActiveReadAhead(sessionId, tabId) || !this.settings?.wordHighlight) return;
    this.readAheadClock = { ...clock };
  }

  playbackClock(): PlaybackClock | undefined {
    return this.readAheadClock && { ...this.readAheadClock };
  }

  async acceptReadAheadStatus(
    sessionId: string,
    tabId: number,
    status: ReadAheadStatusCode | undefined,
  ): Promise<void> {
    if (!this.isActiveReadAhead(sessionId, tabId)) return;
    if (status === 'unsupported') {
      this.currentStatus = { error: readAheadErrorCode('unsupported'), state: 'error', tabId };
    } else if (this.currentStatus.state === 'running') {
      this.currentStatus = status
        ? { error: readAheadErrorCode(status), state: 'running', tabId }
        : { state: 'running', tabId };
    }
    // A recognizer that cannot serve now offers the next one.
    const recognizer = this.settings?.readAheadRecognizer;
    const reason = recognizer && status?.startsWith(`${recognizer}_`)
      ? status.slice(recognizer.length + 1)
      : undefined;
    let action = reason && SWITCH_ON_FAILURE.has(reason) ? NEXT_RECOGNIZER[recognizer!] : undefined;
    if (action === 'switch_to_local' && !await this.dependencies.localWhisperUsable?.().catch(() => false)) {
      action = undefined;
    }
    let code = status && readAheadErrorCode(status);
    // A caption track has no word timing: with word highlight on, the notice
    // says so and offers the recognizer instead (issue #18).
    if ((status === 'captions_youtube' || status === 'captions_video') && this.settings?.wordHighlight) {
      code = `${readAheadErrorCode(status)}_no_highlight`;
      action = 'use_recognizer';
    }
    await this.dependencies.sendToTab(tabId, code
      ? {
          type: 'SESSION_ERROR',
          payload: { code, ...(action ? { action } : {}) },
        }
      : { type: 'SESSION_ERROR_CLEAR' });
  }

  // The page's fallback for sentences its built-in Translator could not
  // translate; only for the active read-ahead session's tab.
  async translateReadAheadTexts(
    sessionId: string,
    tabId: number,
    request: WebTranslationRequest,
    timeoutMs: number,
  ): Promise<string[]> {
    if (!this.isActiveReadAhead(sessionId, tabId)) throw new Error('inactive_session');
    return this.dependencies.translateOnWeb(request, timeoutMs);
  }

  async translateReadAheadChunk(
    sessionId: string,
    tabId: number,
    audioBase64: string,
  ): Promise<ReadAheadChunkResult> {
    if (!this.isActiveReadAhead(sessionId, tabId) || !this.settings) {
      throw new Error('inactive_session');
    }
    const settings = this.settings;
    const { sourceLanguage, targetLanguage } = readAheadRequest(sessionId, settings);
    if (settings.readAheadRecognizer === 'gemini') {
      const sentences = await this.dependencies.translateChunk({
        apiKey: settings.geminiApiKey,
        audioBase64,
        sourceLanguage,
        targetLanguage,
      }).catch(providerFailure('gemini'));
      return { sentences };
    }

    const language = sourceLanguage ? { sourceLanguage } : {};
    const prompt = whisperPrompt(sourceLanguage);
    const recognizer = settings.readAheadRecognizer;
    const recognized = await this.dependencies.transcribeChunk(recognizer === 'local'
      ? { audioBase64, model: settings.localWhisperModel, provider: 'local', ...language }
      : {
          apiKey: settings.groqApiKey,
          audioBase64,
          provider: 'groq',
          ...language,
          ...(prompt ? { prompt } : {}),
        },
    ).catch(providerFailure(recognizer));
    const source = sourceLanguage ?? recognized.language;
    if (recognized.sentences.length === 0) return { sentences: [] };
    if (source && sameLanguage(source, targetLanguage)) {
      return {
        sentences: recognized.sentences.map((sentence) => ({ ...sentence, sameLanguage: true })),
      };
    }
    return {
      sentences: recognized.sentences,
      translateInPage: { ...(source ? { sourceLanguage: source } : {}), targetLanguage },
    };
  }

  // Gemini live already did the transcribing and the translating, so each row
  // goes straight into the window.
  async acceptCaptionPairs(
    sessionId: string,
    updates: CaptionPairUpdate[],
  ): Promise<void> {
    if (
      sessionId !== this.activeSessionId ||
      this.currentStatus.state !== 'running' ||
      !this.settings
    ) {
      return;
    }
    if (updates.length === 0) return;
    // Originals establish row identity. Applying every original first also
    // makes a target-first provider frame safe without allowing a translation
    // by itself to resurrect a row that already rolled out of the window.
    for (const update of updates) {
      if (update.original !== undefined) {
        this.captionWindow.upsertOriginal(update.id, update.original);
      }
    }
    for (const update of updates) {
      if (update.translation !== undefined) {
        this.captionWindow.upsertTranslation(update.id, update.translation);
      }
    }
    await this.sendWindow(this.currentStatus.tabId);
  }

  private async sendWindow(tabId: number): Promise<void> {
    const pairs = this.settings && isReadAhead(this.settings)
      ? (this.readAheadCue ? [{ ...this.readAheadCue }] : [])
      : this.captionWindow.pairs();
    await this.dependencies.sendToTab(tabId, {
      type: 'CAPTION_WINDOW',
      payload: { pairs },
    });
  }

  captionPairs(): CaptionPair[] {
    return this.captionWindow.pairs();
  }

  async clearCaptions(tabId: number): Promise<boolean> {
    if (this.currentStatus.state !== 'running' || this.currentStatus.tabId !== tabId) {
      return false;
    }
    this.captionWindow.clear();
    this.readAheadCue = undefined;
    this.readAheadClock = undefined;
    await this.sendWindow(tabId);
    return true;
  }

  appearance(): CaptionAppearance | undefined {
    return this.settings ? captionAppearance(this.settings) : undefined;
  }

  stop(): Promise<void> {
    return this.stopInternal();
  }

  private async stopInternal(): Promise<void> {
    const tabId = 'tabId' in this.currentStatus ? this.currentStatus.tabId : undefined;
    const sessionId = this.activeSessionId;
    const readAhead = Boolean(this.settings && isReadAhead(this.settings));
    this.generation += 1;
    try {
      if (sessionId && readAhead && tabId !== undefined) {
        await this.dependencies.stopReadAhead(tabId, sessionId);
      } else if (sessionId) {
        await this.dependencies.sendToOffscreen({
          target: 'offscreen',
          type: 'CAPTURE_STOP',
          payload: { sessionId },
        });
      }
    } catch {
      // The offscreen document may already have torn itself down.
    } finally {
      if (tabId !== undefined) {
        await this.dependencies
          .sendToTab(tabId, { type: 'OVERLAY_HIDE' })
          .catch(() => undefined);
      }
      this.settings = undefined;
      this.activeSessionId = undefined;
      this.captionWindow.clear();
      this.readAheadCue = undefined;
      this.currentStatus = { state: 'idle' };
    }
  }

  async handleDisconnect(sessionId: string, code?: string): Promise<void> {
    if (
      sessionId !== this.activeSessionId ||
      this.currentStatus.state !== 'running'
    ) return;
    const tabId = this.currentStatus.tabId;
    // Gemini says why it dropped out when it can; otherwise a generic
    // "disconnected".
    const errorCode = code ?? 'gemini_disconnected';
    this.generation += 1;
    this.currentStatus = {
      error: errorCode,
      state: 'error',
      tabId,
    };
    await this.dependencies.sendToTab(tabId, {
      type: 'SESSION_ERROR',
      payload: { code: errorCode },
    });
  }

  async handleContentReady(tabId: number): Promise<void> {
    if (
      this.currentStatus.state !== 'running' ||
      this.currentStatus.tabId !== tabId ||
      !this.settings
    ) return;
    const layout = await this.dependencies.getOverlayLayout(tabId);
    await this.dependencies.sendToTab(tabId, {
      type: 'OVERLAY_SHOW',
      payload: { appearance: captionAppearance(this.settings), layout },
    });
    // A reload drops read-ahead's scripts with the page; starting again with
    // the same session id is a no-op where they survived.
    if (isReadAhead(this.settings) && this.activeSessionId) {
      await this.dependencies.startReadAhead(
        tabId,
        readAheadRequest(this.activeSessionId, this.settings),
      );
    }
    await this.sendWindow(tabId);
    if (
      this.currentStatus.state === 'running' &&
      this.currentStatus.tabId === tabId &&
      this.currentStatus.error
    ) {
      await this.dependencies.sendToTab(tabId, {
        type: 'SESSION_ERROR',
        payload: { code: this.currentStatus.error },
      });
    }
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.catch(() => undefined);
    return result;
  }
}

function isReadAhead(settings: SessionSettings): boolean {
  return settings.transcriber === 'gemini-read-ahead';
}

function readAheadRequest(
  sessionId: string,
  settings: SessionSettings,
): ReadAheadStartRequest {
  const source = settings.geminiSourceLanguage;
  return {
    preferCaptionTracks: settings.preferCaptionTracks,
    sessionId,
    ...(source && source !== 'auto' ? { sourceLanguage: source } : {}),
    targetLanguage: settings.geminiTargetLanguage,
  };
}
