import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaptureEvent } from '../../src/audio/offscreen-capture-controller';
import { GeminiLiveSession } from '../../src/providers/gemini-live-session';
import type { SocketLike } from '../../src/providers/socket';

class FakeSocket extends EventTarget implements SocketLike {
  readonly sent: Array<ArrayBuffer | string> = [];
  readyState: number = WebSocket.CONNECTING;

  close(code = 1000, reason = ''): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  receive(payload: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(payload) }),
    );
  }

  // What Chrome actually delivers for this endpoint.
  receiveBlob(payload: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: new Blob([JSON.stringify(payload)]),
      }),
    );
  }

  send(data: ArrayBuffer | string): void {
    this.sent.push(data);
  }

  setupOf(index = 0): Record<string, any> {
    return JSON.parse(this.sent[index] as string).setup;
  }
}

function createSession() {
  const sockets: FakeSocket[] = [];
  const socketFactory = vi.fn(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const events: CaptureEvent[] = [];
  const disconnects: Array<string | undefined> = [];
  const session = new GeminiLiveSession(
    { apiKey: 'gemini-key', maxLineWidth: 90, targetLanguage: 'zh-Hant' },
    socketFactory,
  );
  session.onEvent((event) => events.push(event));
  session.onDisconnect((code) => disconnects.push(code));
  return { disconnects, events, session, socketFactory, sockets };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('GeminiLiveSession', () => {
  it('is only connected once the server accepts the setup', async () => {
    const { session, sockets } = createSession();

    const connecting = session.connect();
    sockets[0]!.open();
    expect(sockets[0]!.setupOf().model).toContain('live-translate');

    let settled = false;
    void connecting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    sockets[0]!.receive({ setupComplete: {} });
    await expect(connecting).resolves.toBeUndefined();
  });

  it('holds audio recorded before the session is ready and then sends it', async () => {
    const { session, sockets } = createSession();
    const connecting = session.connect();
    sockets[0]!.open();

    expect(session.sendAudio(new ArrayBuffer(3_200))).toBe(false);
    expect(sockets[0]!.sent).toHaveLength(1);

    sockets[0]!.receive({ setupComplete: {} });
    await connecting;

    const audioFrames = sockets[0]!.sent
      .slice(1)
      .map((frame) => JSON.parse(frame as string));
    expect(audioFrames).toEqual([
      {
        realtimeInput: {
          audio: { data: expect.any(String), mimeType: 'audio/pcm;rate=16000' },
        },
      },
    ]);
  });

  it('emits source and translation updates for the same sentence row', async () => {
    const { events, session, sockets } = createSession();
    const connecting = session.connect();
    sockets[0]!.open();
    sockets[0]!.receive({ setupComplete: {} });
    await connecting;

    sockets[0]!.receive({
      serverContent: { inputTranscription: { text: 'Hello' } },
    });
    sockets[0]!.receive({
      serverContent: { outputTranscription: { text: '你好' } },
    });

    expect(events.at(-1)).toEqual({
      kind: 'pairs',
      updates: [{ id: 'turn-0#0', translation: '你好' }],
    });
  });

  it('reads the binary frames Chrome hands it, in order', async () => {
    const { events, session, sockets } = createSession();
    const connecting = session.connect();
    sockets[0]!.open();
    sockets[0]!.receiveBlob({ setupComplete: {} });

    await expect(connecting).resolves.toBeUndefined();

    sockets[0]!.receiveBlob({
      serverContent: { inputTranscription: { text: 'Hello' } },
    });
    sockets[0]!.receiveBlob({
      serverContent: { inputTranscription: { text: 'Hello there' } },
    });
    await vi.waitFor(() => expect(events).toHaveLength(2));

    // Decoding is async, so out-of-order application would silently truncate
    // the row back to its earlier state.
    expect(events.at(-1)).toEqual({
      kind: 'pairs',
      updates: [{ id: 'turn-0#0', original: 'Hello there' }],
    });
  });

  it('resumes with the stored handle when the server sends it away', async () => {
    const { session, socketFactory, sockets } = createSession();
    const connecting = session.connect();
    sockets[0]!.open();
    sockets[0]!.receive({ setupComplete: {} });
    await connecting;
    sockets[0]!.receive({ sessionResumptionUpdate: { newHandle: 'handle-1' } });

    sockets[0]!.receive({ goAway: { timeLeft: '5s' } });
    // Audio recorded during the gap must survive it, or the captions skip a
    // sentence every ten minutes.
    session.sendAudio(new ArrayBuffer(3_200));
    await vi.advanceTimersByTimeAsync(500);

    expect(socketFactory).toHaveBeenCalledTimes(2);
    sockets[1]!.open();
    expect(sockets[1]!.setupOf().sessionResumption).toEqual({
      handle: 'handle-1',
    });

    sockets[1]!.receive({ setupComplete: {} });
    expect(sockets[1]!.sent).toHaveLength(2);
  });

  it('reports the reason instead of retrying what cannot succeed', async () => {
    const { disconnects, session, socketFactory, sockets } = createSession();
    const connecting = session.connect();
    sockets[0]!.open();
    sockets[0]!.receive({ setupComplete: {} });
    await connecting;

    sockets[0]!.close(1011, 'You exceeded your current quota');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(disconnects).toEqual(['gemini_quota_exceeded']);
    expect(socketFactory).toHaveBeenCalledOnce();
  });

  it('rejects the handshake rather than reporting a disconnect nobody started', async () => {
    const { disconnects, session, sockets } = createSession();

    const connecting = session.connect();
    sockets[0]!.close(4401, 'API key not valid');

    await expect(connecting).rejects.toThrow('API key not valid');
    expect(disconnects).toEqual([]);
  });

  it('gives up on a socket that opens but never answers the setup', async () => {
    const { session, socketFactory, sockets } = createSession();
    // Asserted before the clock moves, so the rejection is never momentarily
    // unhandled while the retries play out.
    const rejected = expect(session.connect()).rejects.toThrow('逾時');
    sockets[0]!.open();

    // A socket that opens and then goes quiet looks transient, so it is retried
    // — but the attempt counter only resets on a setup the server accepted, so
    // the retries do run out.
    await vi.advanceTimersByTimeAsync(60_000);

    await rejected;
    expect(socketFactory).toHaveBeenCalledTimes(4);
  });

  it('stops reconnecting once the caller closes the session', async () => {
    const { session, socketFactory, sockets } = createSession();
    const connecting = session.connect();
    sockets[0]!.open();
    sockets[0]!.receive({ setupComplete: {} });
    await connecting;

    sockets[0]!.close(1006, '');
    session.close();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(socketFactory).toHaveBeenCalledOnce();
  });
});
