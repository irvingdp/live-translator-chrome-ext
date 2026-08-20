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
});
