import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserSidePanelApi } from '../../src/sidepanel/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserSidePanelApi', () => {
  it('connects through the dedicated side-panel port', () => {
    const port = {
      disconnect: vi.fn(),
      onDisconnect: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    };
    const connect = vi.fn(() => port);
    vi.stubGlobal('chrome', { runtime: { connect } });

    const connection = browserSidePanelApi.connect();
    const onState = vi.fn();
    connection.onState(onState);

    expect(connect).toHaveBeenCalledWith({ name: 'caption-side-panel' });
    const listener = port.onMessage.addListener.mock.calls[0]![0];
    listener({ type: 'SIDE_PANEL_STATE', payload: { active: true } });
    expect(onState).toHaveBeenCalledWith({ active: true });
  });

  it('requests the floating surface and reports background failures', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ error: 'inactive_session', ok: false });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await browserSidePanelApi.returnToFloating();
    await expect(browserSidePanelApi.returnToFloating())
      .rejects.toThrow('inactive_session');
    expect(sendMessage).toHaveBeenCalledWith({
      target: 'background',
      type: 'SET_CAPTION_SURFACE',
      payload: { mode: 'floating' },
    });
  });
});
