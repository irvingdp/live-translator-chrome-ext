import type {
  CaptureEvent,
  CaptureSession,
} from '../audio/offscreen-capture-controller';
import {
  buildGeminiAudioMessage,
  buildGeminiSetupMessage,
  buildGeminiUrl,
  classifyGeminiClose,
  GeminiCaptionAccumulator,
  parseGeminiMessage,
  readSocketFrame,
} from './gemini-live';
import { t } from '../core/i18n';
import type { SocketLike } from './socket';

// The offscreen document is the only place this pipeline is observable, and a
// session that connects but never transcribes looks exactly like one that
// never connected. Inspect it from chrome://extensions → Inspect views →
// offscreen.html.
function log(message: string, detail?: unknown): void {
  console.info(`[gemini-live] ${message}`, detail ?? '');
}

export interface GeminiLiveSessionConfig {
  apiKey: string;
  targetLanguage: string;
}

export type GeminiSocketFactory = (url: string) => SocketLike;

const defaultSocketFactory: GeminiSocketFactory = (url) => new WebSocket(url);

export class GeminiLiveSession implements CaptureSession {
  // Google asks for 100 ms of audio per message; shorter chunks only add
  // base64 and JSON overhead to the same bytes.
  readonly audioChunkMs = 100;

  private static readonly handshakeTimeoutMs = 10_000;
  // Roughly three seconds, which comfortably covers a reconnect. Older audio is
  // dropped rather than replayed late into a live caption.
  private static readonly maxBufferedChunks = 30;
  private static readonly maxReconnectAttempts = 3;

  private readonly accumulator = new GeminiCaptionAccumulator();
  private attempt = 0;
  private readonly buffered: ArrayBuffer[] = [];
  private closed = false;
  private readonly disconnectListeners = new Set<(code?: string) => void>();
  private readonly eventListeners = new Set<(event: CaptureEvent) => void>();
  // Blob frames decode asynchronously, so they are chained rather than raced:
  // two transcript fragments that arrive in order must be applied in order.
  private frameTail: Promise<void> = Promise.resolve();
  private handshake?: { reject(error: Error): void; resolve(): void };
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  // Errors arrive on the socket before the close that they explain, so the last
  // one is what gets classified. Cleared per attempt so a stale message cannot
  // condemn a later, unrelated close.
  private lastError = '';
  private ready = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private resumptionHandle?: string;
  private sentAudio = false;
  private sawTranscription = false;
  private socket?: SocketLike;
  private socketGeneration = 0;

  constructor(
    private readonly config: GeminiLiveSessionConfig,
    private readonly socketFactory: GeminiSocketFactory = defaultSocketFactory,
  ) {}

  connect(): Promise<void> {
    if (this.socket) throw new Error('Gemini session already connected');
    return new Promise((resolve, reject) => {
      this.handshake = { reject, resolve };
      this.openSocket();
    });
  }

  onEvent(listener: (event: CaptureEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onDisconnect(listener: (code?: string) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  // Buffers instead of dropping while a reconnect is in flight: the capture
  // controller's own queue only covers the first connection, and audio thrown
  // away here is a hole in the captions.
  sendAudio(audio: ArrayBuffer): boolean {
    if (this.closed) return false;
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) {
      this.buffered.push(audio);
      if (this.buffered.length > GeminiLiveSession.maxBufferedChunks) {
        this.buffered.shift();
      }
      return false;
    }
    if (!this.sentAudio) {
      this.sentAudio = true;
      log('first audio chunk sent', { bytes: audio.byteLength });
    }
    this.socket.send(buildGeminiAudioMessage(audio));
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.buffered.length = 0;
    const socket = this.socket;
    this.detachSocket();
    socket?.close();
  }

  private openSocket(): void {
    this.lastError = '';
    this.ready = false;
    this.socketGeneration += 1;
    log('opening socket', {
      attempt: this.attempt,
      resuming: Boolean(this.resumptionHandle),
      targetLanguage: this.config.targetLanguage,
    });
    const socket = this.socketFactory(buildGeminiUrl(this.config.apiKey));
    this.socket = socket;
    socket.addEventListener('open', this.handleOpen);
    socket.addEventListener('message', this.handleMessage as EventListener);
    socket.addEventListener('close', this.handleClose as EventListener);
    socket.addEventListener('error', this.handleError);
    // Covers both a socket that never opens and one that opens but never
    // answers the setup message; closing it routes either into handleClose.
    this.handshakeTimer = setTimeout(() => {
      this.lastError = this.lastError || t('geminiConnectionTimedOut');
      socket.close();
    }, GeminiLiveSession.handshakeTimeoutMs);
  }

  private detachSocket(): void {
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.ready = false;
    this.socketGeneration += 1;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.removeEventListener('open', this.handleOpen);
    socket.removeEventListener('message', this.handleMessage as EventListener);
    socket.removeEventListener('close', this.handleClose as EventListener);
    socket.removeEventListener('error', this.handleError);
  }

  private readonly handleOpen = () => {
    this.socket?.send(
      buildGeminiSetupMessage(this.config.targetLanguage, this.resumptionHandle),
    );
  };

  private readonly handleError = () => {
    this.lastError = this.lastError || t('geminiSocketError');
  };

  private readonly handleMessage = (event: MessageEvent) => {
    const generation = this.socketGeneration;
    if (typeof event.data === 'string') {
      this.consumeFrame(event.data, generation);
      return;
    }
    this.frameTail = this.frameTail
      .then(() => readSocketFrame(event.data))
      .then((text) => {
        if (text === undefined) {
          log('dropped an undecodable frame', event.data);
          return;
        }
        this.consumeFrame(text, generation);
      })
      .catch(() => undefined);
  };

  private consumeFrame(raw: string, generation: number): void {
    if (this.closed || generation !== this.socketGeneration) return;
    for (const parsed of parseGeminiMessage(raw)) {
      switch (parsed.type) {
        case 'setupComplete':
          this.handleSetupComplete();
          break;
        case 'serverContent': {
          if (!this.sawTranscription && (parsed.original || parsed.translation)) {
            this.sawTranscription = true;
            log('first transcription received');
          }
          const pair = this.accumulator.ingest(parsed);
          if (pair) this.emit({ event: pair, kind: 'pair' });
          break;
        }
        case 'resumption':
          this.resumptionHandle = parsed.handle;
          break;
        case 'goAway':
          // The session is about to end on the server's terms. Closing now
          // starts the resumed session while audio is still being buffered.
          log('server sent goAway, resuming');
          this.socket?.close();
          break;
        case 'error':
          log('server error', parsed.message);
          this.lastError = parsed.message;
          break;
      }
    }
  }

  private handleSetupComplete(): void {
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.ready = true;
    log('setup accepted, streaming audio', {
      bufferedChunks: this.buffered.length,
    });
    // Only a session the server actually accepted counts as a fresh start; a
    // socket that opens and is then closed must keep spending its attempts.
    this.attempt = 0;
    const handshake = this.handshake;
    this.handshake = undefined;
    handshake?.resolve();
    const pending = this.buffered.splice(0);
    for (const audio of pending) this.sendAudio(audio);
  }

  private readonly handleClose = (event: CloseEvent) => {
    this.detachSocket();
    if (this.closed) return;
    const reason =
      this.lastError || event.reason || t('socketClosed', String(event.code));
    const decision = classifyGeminiClose({
      attempt: this.attempt,
      code: event.code,
      maxAttempts: GeminiLiveSession.maxReconnectAttempts,
      reason,
    });
    log('socket closed', { code: event.code, decision, reason });
    if (!decision.retry) {
      this.fail(decision.code, reason);
      return;
    }
    this.attempt += 1;
    this.accumulator.closeTurn();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closed) this.openSocket();
    }, decision.delayMs);
  };

  private fail(code: string, reason: string): void {
    this.closed = true;
    this.buffered.length = 0;
    const handshake = this.handshake;
    this.handshake = undefined;
    // A failure during connect() is the caller's to handle; it tears the
    // capture down itself, so reporting it twice would double the teardown.
    if (handshake) {
      handshake.reject(new Error(reason));
      return;
    }
    for (const listener of this.disconnectListeners) listener(code);
  }

  private emit(event: CaptureEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }
}
