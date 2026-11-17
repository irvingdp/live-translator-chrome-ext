import type {
  CaptionPairUpdate,
  CaptureStartRequest,
} from '../audio/offscreen-capture-controller';
import type {
  ChunkSentence,
  ChunkTranslationRequest,
} from '../read-ahead/gemini-chunk-translation';
import { CaptionWindow, type CaptionPair } from './caption-window';
import type { ExtensionMessage } from './messages';
import type { OverlayLayout, OverlayPlacement } from './overlay-layout';
import {
  captionAppearance,
  type CaptionAppearance,
  type TranscriberId,
} from './settings';

export interface SessionSettings {
  backgroundOpacity: number;
  deeplApiKey: string;
  geminiApiKey: string;
  // Read-ahead mode only; 'auto' lets the model detect it.
  geminiSourceLanguage: string;
  geminiTargetLanguage: string;
  maxLineWidth: number;
  transcriber: TranscriberId;
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
      payload: { code: string };
    }
  | { type: 'SESSION_ERROR_CLEAR' }
  | { type: 'READ_AHEAD_START'; payload: ReadAheadStartRequest }
  | { type: 'READ_AHEAD_STOP'; payload: { sessionId: string } };

export interface ReadAheadStartRequest {
  sessionId: string;
  sourceLanguage?: string;
  targetLanguage: string;
}

export type ReadAheadStatusCode =
  | 'failed'
  | 'loading'
  | 'quota_exceeded'
  | 'translating'
  | 'unsupported';

const READ_AHEAD_STATUS_ERRORS: Record<ReadAheadStatusCode, string> = {
  failed: 'read_ahead_failed',
  loading: 'read_ahead_loading',
  quota_exceeded: 'gemini_quota_exceeded',
  translating: 'read_ahead_translating',
  unsupported: 'read_ahead_unsupported',
};

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
    this.readAheadCue = cue && { ...cue };
    if (cue) {
      this.captionWindow.upsertOriginal(cue.id, cue.original);
      this.captionWindow.upsertTranslation(cue.id, cue.translation);
    }
    await this.sendWindow(tabId);
  }

  async acceptReadAheadStatus(
    sessionId: string,
    tabId: number,
    status: ReadAheadStatusCode | undefined,
  ): Promise<void> {
    if (!this.isActiveReadAhead(sessionId, tabId)) return;
    if (status === 'unsupported') {
      this.currentStatus = { error: READ_AHEAD_STATUS_ERRORS.unsupported, state: 'error', tabId };
    } else if (this.currentStatus.state === 'running') {
      this.currentStatus = status
        ? { error: READ_AHEAD_STATUS_ERRORS[status], state: 'running', tabId }
        : { state: 'running', tabId };
    }
    await this.dependencies.sendToTab(tabId, status
      ? { type: 'SESSION_ERROR', payload: { code: READ_AHEAD_STATUS_ERRORS[status] } }
      : { type: 'SESSION_ERROR_CLEAR' });
  }

  translateReadAheadChunk(
    sessionId: string,
    tabId: number,
    audioBase64: string,
  ): Promise<ChunkSentence[]> {
    if (!this.isActiveReadAhead(sessionId, tabId) || !this.settings) {
      return Promise.reject(new Error('inactive_session'));
    }
    const request = readAheadRequest(sessionId, this.settings);
    return this.dependencies.translateChunk({
      apiKey: this.settings.geminiApiKey,
      audioBase64,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
    });
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
    sessionId,
    ...(source && source !== 'auto' ? { sourceLanguage: source } : {}),
    targetLanguage: settings.geminiTargetLanguage,
  };
}
