export function isMessageEnvelope(
  message: unknown,
  target: 'background' | 'offscreen',
): message is { target: typeof target; type: string } {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'target' in message &&
      message.target === target &&
      'type' in message &&
      typeof message.type === 'string',
  );
}

export function isTrustedExtensionContext(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): boolean {
  return sender.id === extensionId && sender.tab === undefined;
}

export function isExtensionPage(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  pageUrl: string,
): boolean {
  return isTrustedExtensionContext(sender, extensionId) && sender.url === pageUrl;
}

export function isTopFrameContentScript(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): boolean {
  return (
    sender.id === extensionId &&
    sender.tab?.id !== undefined &&
    sender.frameId === 0
  );
}
