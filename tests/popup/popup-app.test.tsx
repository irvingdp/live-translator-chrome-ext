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
  it('shows the future transcriber as a disabled coming-soon option', async () => {
    render(<PopupApp api={createApi()} />);

    expect(await screen.findByText('本地 Whisper（即將推出）')).toBeDisabled();
  });

  it('offers no translator we are not actually shipping', async () => {
    render(<PopupApp api={createApi()} />);

    const translator = await screen.findByLabelText('翻譯');

    expect(
      [...translator.querySelectorAll('option')].map((option) => option.textContent),
    ).toEqual(['DeepL API']);
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

  it('shows translation disabled while capture remains active', async () => {
    render(<PopupApp api={createApi({
      status: vi.fn().mockResolvedValue({
        error: 'translation_disabled',
        state: 'running',
        tabId: 42,
      }),
    })} />);

    expect(await screen.findByText('翻譯已停用')).toBeVisible();
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

  it('keeps original and translation font sliders bounded after gaining shared range props', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);
    const original = await screen.findByLabelText('原文字級');
    const translation = screen.getByLabelText('譯文字級');

    expect(original).toHaveAttribute('min', '16');
    expect(original).toHaveAttribute('max', '48');
    expect(translation).toHaveAttribute('min', '16');
    expect(translation).toHaveAttribute('max', '48');

    fireEvent.change(original, { target: { value: '40' } });
    fireEvent.change(translation, { target: { value: '18' } });

    expect(original).toHaveValue('40');
    expect(translation).toHaveValue('18');
  });

  it('saves each layout setting when its slider moves', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);

    fireEvent.change(await screen.findByLabelText('每行長度上限'), {
      target: { value: '60' },
    });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ maxLineWidth: 60 }),
      ),
    );

    fireEvent.change(screen.getByLabelText('背景透明度'), {
      target: { value: '30' },
    });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundOpacity: 30 }),
      ),
    );

    fireEvent.change(screen.getByLabelText('距底部位置'), {
      target: { value: '20' },
    });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ bottomOffset: 20 }),
      ),
    );
  });

  it('links each selected provider to where its API key is issued', async () => {
    render(<PopupApp api={createApi()} />);

    const deepgram = await screen.findByRole('link', {
      name: /console\.deepgram\.com/,
    });
    const deepl = screen.getByRole('link', { name: /www\.deepl\.com/ });

    expect(deepgram).toHaveAttribute('href', 'https://console.deepgram.com/');
    expect(deepl).toHaveAttribute('href', 'https://www.deepl.com/');
    // The popup closes when a tab opens, so these must not navigate it.
    for (const link of [deepgram, deepl]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });

  it('saves the caption width independently of the line length', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);

    fireEvent.change(await screen.findByLabelText('字幕寬度'), {
      target: { value: '45' },
    });

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          captionWidth: 45,
          maxLineWidth: DEFAULT_SETTINGS.maxLineWidth,
        }),
      ),
    );
  });

  it('saves the row count and the minimum line width', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);

    fireEvent.change(await screen.findByLabelText('顯示行數'), {
      target: { value: '3' },
    });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ captionRows: 3 }),
      ),
    );

    fireEvent.change(screen.getByLabelText('每行長度下限'), {
      target: { value: '25' },
    });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ minLineWidth: 25 }),
      ),
    );
  });

  it('keeps the layout sliders usable while a session runs', async () => {
    render(
      <PopupApp
        api={createApi({
          status: vi.fn().mockResolvedValue({ state: 'running', tabId: 42 }),
        })}
      />,
    );

    expect(await screen.findByLabelText('背景透明度')).toBeEnabled();
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
