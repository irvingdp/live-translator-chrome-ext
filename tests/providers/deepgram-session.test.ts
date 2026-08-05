import { describe, expect, it, vi } from 'vitest';

import {
  DeepgramSession,
  type SocketLike,
} from '../../src/providers/deepgram-session';

class FakeSocket extends EventTarget implements SocketLike {
  readonly sent: Array<ArrayBuffer | string> = [];
  readyState: number = WebSocket.CONNECTING;

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  receive(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  disconnect(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close'));
  }

  send(data: ArrayBuffer | string): void {
    this.sent.push(data);
  }
}

describe('DeepgramSession', () => {
  it('connects with browser-safe subprotocol credentials', async () => {
    const socket = new FakeSocket();
    const socketFactory = vi.fn(() => socket);
    const session = new DeepgramSession(
      { apiKey: 'secret', language: 'en-US' },
      socketFactory,
    );

    const connecting = session.connect();
    expect(socketFactory).toHaveBeenCalledWith(
      expect.stringContaining('language=en-US'),
      ['token', 'secret'],
    );

    socket.open();
    await expect(connecting).resolves.toBeUndefined();
  });

  it('sends audio only after the socket is open', async () => {
    const socket = new FakeSocket();
    const session = new DeepgramSession(
      { apiKey: 'secret', language: 'en-US' },
      () => socket,
    );
    const audio = new ArrayBuffer(1280);

    expect(session.sendAudio(audio)).toBe(false);
    const connecting = session.connect();
    socket.open();
    await connecting;

    expect(session.sendAudio(audio)).toBe(true);
    expect(socket.sent).toContain(audio);
  });

  it('emits parsed transcript events and ignores protocol metadata', async () => {
    const socket = new FakeSocket();
    const transcriptListener = vi.fn();
    const session = new DeepgramSession(
      { apiKey: 'secret', language: 'en-US' },
      () => socket,
    );
    session.onTranscript(transcriptListener);
    const connecting = session.connect();
    socket.open();
    await connecting;

    socket.receive(JSON.stringify({ type: 'Metadata' }));
    socket.receive(
      JSON.stringify({
        channel: { alternatives: [{ transcript: 'Hello' }] },
        is_final: false,
        request_id: 'request-1',
        start: 0,
        type: 'Results',
      }),
    );

    expect(transcriptListener).toHaveBeenCalledOnce();
    expect(transcriptListener).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello' }),
    );
  });

  it('requests a graceful Deepgram close before closing the socket', async () => {
    const socket = new FakeSocket();
    const session = new DeepgramSession(
      { apiKey: 'secret', language: 'en-US' },
      () => socket,
    );
    const connecting = session.connect();
    socket.open();
    await connecting;

    session.close();

    expect(socket.sent).toContain(JSON.stringify({ type: 'CloseStream' }));
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it('sends protocol KeepAlive messages while an open stream is idle', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const session = new DeepgramSession(
      { apiKey: 'secret', language: 'en-US' },
      () => socket,
    );
    const connecting = session.connect();
    socket.open();
    await connecting;

    await vi.advanceTimersByTimeAsync(8_000);

    expect(socket.sent).toContain(JSON.stringify({ type: 'KeepAlive' }));
    session.close();
    vi.useRealTimers();
  });

  it('reports an unexpected post-handshake close and stops KeepAlive', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const disconnected = vi.fn();
    const session = new DeepgramSession(
      { apiKey: 'secret', language: 'en-US' },
      () => socket,
    );
    session.onDisconnect(disconnected);
    const connecting = session.connect();
    socket.open();
    await connecting;
    socket.disconnect();

    await vi.advanceTimersByTimeAsync(16_000);

    expect(disconnected).toHaveBeenCalledOnce();
    expect(socket.sent).not.toContain(JSON.stringify({ type: 'KeepAlive' }));
    vi.useRealTimers();
  });
});
