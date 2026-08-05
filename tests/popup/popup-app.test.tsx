import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PopupApp, type PopupApi } from '../../src/popup/PopupApp';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

function createApi(overrides: Partial<PopupApi> = {}): PopupApi {
  return {
    loadSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    openOptions: vi.fn().mockResolvedValue(undefined),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ state: 'running', tabId: 42 }),
    status: vi.fn().mockResolvedValue({ state: 'idle' }),
    stop: vi.fn().mockResolvedValue({ state: 'idle' }),
    ...overrides,
  };
}

describe('PopupApp', () => {
  it('shows future providers as disabled coming-soon options', async () => {
    render(<PopupApp api={createApi()} />);

    expect(await screen.findByText('本地 Whisper（即將推出）')).toBeDisabled();
    expect(screen.getByText('Gemini 3.5 Live（即將推出）')).toBeDisabled();
  });

  it('removes API Key fields and directs unconfigured users to options', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);

    expect(await screen.findByText('API Key 尚未設定')).toBeVisible();
    expect(screen.queryByLabelText('Deepgram API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('DeepL API Key')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));
    await waitFor(() => expect(api.openOptions).toHaveBeenCalledOnce());
  });

  it('shows configured status when both stored keys are non-empty', async () => {
    render(
      <PopupApp
        api={createApi({
          loadSettings: vi.fn().mockResolvedValue({
            ...DEFAULT_SETTINGS,
            deepgramApiKey: 'dg',
            deeplApiKey: 'dl',
          }),
        })}
      />,
    );

    expect(await screen.findByText('API Key 已設定')).toBeVisible();
  });

  it('shows guidance when Chrome cannot open the options page', async () => {
    render(
      <PopupApp
        api={createApi({
          openOptions: vi.fn().mockRejectedValue(new Error('unavailable')),
        })}
      />,
    );
    await screen.findByText('API Key 尚未設定');

    fireEvent.click(screen.getByRole('button', { name: '開啟設定' }));

    expect(
      await screen.findByText(
        '無法開啟設定頁，請從擴充功能選單選擇「選項」。',
      ),
    ).toBeVisible();
  });

  it('blocks startup with guidance when an API Key is missing', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);
    await screen.findByText('API Key 尚未設定');

    fireEvent.click(screen.getByRole('button', { name: '開始即時字幕' }));

    expect(
      await screen.findByText(
        '請先在設定頁輸入 Deepgram 與 DeepL API Key。',
      ),
    ).toBeVisible();
    expect(api.start).not.toHaveBeenCalled();
  });

  it('starts with normalized settings and changes the CTA to stop', async () => {
    const api = createApi({
      loadSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_SETTINGS,
        deepgramApiKey: 'dg',
        deeplApiKey: 'dl',
      }),
    });
    render(<PopupApp api={api} />);

    fireEvent.click(
      await screen.findByRole('button', { name: '開始即時字幕' }),
    );

    await waitFor(() => expect(api.start).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: '停止字幕' })).toBeVisible();
  });

  it('keeps original and translation font controls independent', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);
    const original = await screen.findByLabelText('原文字級');
    const translation = screen.getByLabelText('譯文字級');

    fireEvent.change(original, { target: { value: '32' } });

    expect(original).toHaveValue('32');
    expect(translation).toHaveValue('22');
  });

  it('shows a translation warning while capture remains active', async () => {
    render(<PopupApp api={createApi({
      status: vi.fn().mockResolvedValue({
        error: 'translation_failed',
        state: 'running',
        tabId: 42,
      }),
    })} />);

    expect(await screen.findByText('翻譯異常')).toBeVisible();
    expect(screen.getByRole('button', { name: '停止字幕' })).toBeVisible();
  });

  it('serializes settings writes so an older save cannot finish last', async () => {
    let releaseFirst!: () => void;
    const saveSettings = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => { releaseFirst = resolve; }),
      )
      .mockResolvedValue(undefined);
    render(<PopupApp api={createApi({ saveSettings })} />);
    const original = await screen.findByLabelText('原文字級');

    fireEvent.change(original, { target: { value: '30' } });
    fireEvent.change(original, { target: { value: '32' } });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

    releaseFirst();
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2));
    expect(saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ originalFontSize: 32 }),
    );
  });

  it('allows stopping while the initial provider connection is pending', async () => {
    let releaseStart!: (status: { state: 'running'; tabId: number }) => void;
    const api = createApi({
      loadSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_SETTINGS,
        deepgramApiKey: 'dg',
        deeplApiKey: 'dl',
      }),
      start: vi.fn().mockReturnValue(
        new Promise((resolve) => { releaseStart = resolve; }),
      ),
    });
    render(<PopupApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '開始即時字幕' }));

    const stop = await screen.findByRole('button', { name: '停止字幕' });
    expect(stop).toBeEnabled();
    await waitFor(() => expect(api.start).toHaveBeenCalledOnce());
    fireEvent.click(stop);
    await waitFor(() => expect(api.stop).toHaveBeenCalledOnce());

    releaseStart({ state: 'running', tabId: 42 });
    expect(await screen.findByRole('button', { name: '開始即時字幕' })).toBeVisible();
  });
});
