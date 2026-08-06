// The structural subset of WebSocket the provider sessions use, so each one can
// be driven by a fake in tests without a real network. Shared rather than
// declared per provider, since both sessions need exactly this much.
export interface SocketLike extends EventTarget {
  readonly readyState: number;
  close(): void;
  send(data: ArrayBuffer | string): void;
}
