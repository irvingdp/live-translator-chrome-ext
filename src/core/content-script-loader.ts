interface ContentScriptLoaderDependencies {
  inject(): Promise<void>;
  ping(): Promise<unknown>;
}

export async function ensureContentScript(
  dependencies: ContentScriptLoaderDependencies,
): Promise<void> {
  if (await receiverIsReady(dependencies.ping)) return;
  await dependencies.inject();
  if (!await receiverIsReady(dependencies.ping)) {
    throw new Error('content_script_unavailable');
  }
}

async function receiverIsReady(ping: () => Promise<unknown>): Promise<boolean> {
  try {
    const response = await ping();
    return Boolean(
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true,
    );
  } catch {
    // A freshly installed/reloaded extension has no receiver in existing tabs.
    return false;
  }
}
