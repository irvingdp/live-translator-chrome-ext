import type { TranscriptEvent } from '../core/transcript-stabilizer';
import {
  buildDeepgramUrl,
  deepgramProtocols,
  DeepgramMessageParser,
} from './deepgram';

export interface SocketLike extends EventTarget {
  readonly readyState: number;
  close(): void;
  send(data: ArrayBuffer | string): void;
}

export type SocketFactory = (
  url: string,
  protocols: string[],
) => SocketLike;

export interface DeepgramSessionConfig {
  apiKey: string;
  language: string;
}

const defaultSocketFactory: SocketFactory = (url, protocols) =>
  new WebSocket(url, protocols);

export class DeepgramSession {
  private cancelHandshake?: () => void;
  private readonly disconnectListeners = new Set<() => void>();
  private intentionalClose = false;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private readonly listeners = new Set<(event: TranscriptEvent) => void>();
  private readonly parser = new DeepgramMessageParser();
  private socket?: SocketLike;

  constructor(
    private readonly config: DeepgramSessionConfig,
    private readonly socketFactory: SocketFactory = defaultSocketFactory,
  ) {}

  connect(): Promise<void> {
    if (this.socket) throw new Error('Deepgram session already connected');

    const socket = this.socketFactory(
      buildDeepgramUrl(this.config.language),
      deepgramProtocols(this.config.apiKey),
    );
    this.socket = socket;
    socket.addEventListener('message', this.handleMessage as EventListener);

    return new Promise((resolve, reject) => {
      let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
      const handleOpen = () => {
        cleanupHandshakeListeners();
        socket.addEventListener('close', this.handleUnexpectedClose, {
          once: true,
        });
        this.keepAliveTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 8_000);
        resolve();
      };
      const handleFailure = () => {
        cleanupHandshakeListeners();
        reject(new Error('Unable to connect to Deepgram'));
      };
      const cleanupHandshakeListeners = () => {
        if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
        handshakeTimer = undefined;
        this.cancelHandshake = undefined;
        socket.removeEventListener('open', handleOpen);
        socket.removeEventListener('error', handleFailure);
        socket.removeEventListener('close', handleFailure);
      };

      socket.addEventListener('open', handleOpen, { once: true });
      socket.addEventListener('error', handleFailure, { once: true });
      socket.addEventListener('close', handleFailure, { once: true });
      this.cancelHandshake = () => {
        cleanupHandshakeListeners();
        reject(new Error('Deepgram connection cancelled'));
      };
      handshakeTimer = setTimeout(() => {
        handleFailure();
        socket.close();
      }, 10_000);
    });
  }

  onTranscript(listener: (event: TranscriptEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  sendAudio(audio: ArrayBuffer): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(audio);
    return true;
  }

  close(): void {
    this.intentionalClose = true;
    this.cancelHandshake?.();
    if (this.keepAliveTimer !== undefined) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'CloseStream' }));
    }
    this.socket?.removeEventListener(
      'message',
      this.handleMessage as EventListener,
    );
    this.socket?.removeEventListener('close', this.handleUnexpectedClose);
    this.socket?.close();
    this.socket = undefined;
  }

  private readonly handleMessage = (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    const transcript = this.parser.parse(event.data);
    if (!transcript) return;
    for (const listener of this.listeners) listener(transcript);
  };

  private readonly handleUnexpectedClose = () => {
    if (this.keepAliveTimer !== undefined) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
    if (!this.intentionalClose) {
      for (const listener of this.disconnectListeners) listener();
    }
  };
}
