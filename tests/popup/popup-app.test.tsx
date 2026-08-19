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

// Gemini is the default provider, so anything about the Deepgram + DeepL pair
// has to say so rather than lean on the defaults.
function createDeepgramApi(settings: Record<string, unknown> = {}): PopupApi {
  return createApi({
    loadSettings: vi.fn().mockResolvedValue({
      ...DEFAULT_SETTINGS,
      transcriber: 'deepgram',
      ...settings,
    }),
  });
}

describe('PopupApp', () => {
  it('offers no translator we are not actually shipping', async () => {
    render(<PopupApp api={createDeepgramApi()} />);

    const translator = await screen.findByLabelText('翻譯');

    expect(
      [...translator.querySelectorAll('option')].map((option) => option.textContent),
    ).toEqual(['DeepL API']);
  });

  it('offers only the transcribers that actually work', async () => {
    render(<PopupApp api={createApi()} />);

    const transcriber = await screen.findByLabelText('語音辨識');

    expect(
      [...transcriber.querySelectorAll('option')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Gemini live translate 3.5', 'Deepgram Nova-3']);
    expect(transcriber).toHaveValue('gemini');
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
        api={createDeepgramApi({ deepgramApiKey: 'dg', deeplApiKey: 'dl' })}
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

  it('names the key the selected provider actually needs', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);
    await screen.findByText('API Key 尚未設定');

    fireEvent.click(screen.getByRole('button', { name: '開始即時字幕' }));

    expect(
      await screen.findByText('請先在設定頁輸入 Gemini API Key。'),
    ).toBeVisible();
    expect(api.start).not.toHaveBeenCalled();
  });

  it('blocks startup with guidance when an API Key is missing', async () => {
    const api = createDeepgramApi();
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
    const api = createDeepgramApi({ deepgramApiKey: 'dg', deeplApiKey: 'dl' });
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
    // The line-width sliders only exist for the provider that chunks its own
    // rows.
    const api = createDeepgramApi();
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

  });

  it('stops the minimum line width slider at the current maximum', async () => {
    const api = createDeepgramApi();
    render(<PopupApp api={api} />);

    const minimum = await screen.findByLabelText('每行長度下限');
    // Anything past the maximum is clamped away on save, so a handle that can
    // be dragged there only springs back.
    expect(minimum).toHaveAttribute('max', String(DEFAULT_SETTINGS.maxLineWidth));

    fireEvent.change(screen.getByLabelText('每行長度上限'), {
      target: { value: '50' },
    });

    await waitFor(() => expect(minimum).toHaveAttribute('max', '50'));
  });

  it('links each selected provider to where its API key is issued', async () => {
    render(<PopupApp api={createDeepgramApi()} />);

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

  it('drops the translator step when Gemini already does the translating', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);

    fireEvent.change(await screen.findByLabelText('語音辨識'), {
      target: { value: 'gemini' },
    });

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ transcriber: 'gemini' }),
      ),
    );
    expect(screen.queryByLabelText('翻譯')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /aistudio\.google\.com/ }),
    ).toHaveAttribute('href', 'https://aistudio.google.com/');
    // Gemini pairs complete semantic sentences; visual wrapping must not
    // create different source and target row counts.
    expect(screen.queryByLabelText('每行長度上限')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('每行長度下限')).not.toBeInTheDocument();
  });

  it('offers Google languages and no source choice in Gemini mode', async () => {
    const api = createApi({
      loadSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_SETTINGS,
        transcriber: 'gemini',
      }),
    });
    render(<PopupApp api={api} />);

    const source = await screen.findByLabelText('來源語言');
    const target = screen.getByLabelText('目標語言');

    // The model detects the source itself; offering the choice would be a lie.
    expect(source).toBeDisabled();
    expect(source).toHaveValue('auto');
    expect(target).toHaveValue('zh-Hant');
    expect([...target.querySelectorAll('option')].length).toBeGreaterThan(70);

    fireEvent.change(target, { target: { value: 'pt-BR' } });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          geminiTargetLanguage: 'pt-BR',
          // The DeepL target is left alone, so switching back restores it.
          targetLanguage: DEFAULT_SETTINGS.targetLanguage,
        }),
      ),
    );
  });

  it('needs only the Gemini key once Gemini is the chosen provider', async () => {
    render(
      <PopupApp
        api={createApi({
          loadSettings: vi.fn().mockResolvedValue({
            ...DEFAULT_SETTINGS,
            geminiApiKey: 'gm',
            transcriber: 'gemini',
          }),
        })}
      />,
    );

    expect(await screen.findByText('API Key 已設定')).toBeVisible();
  });

  it('removes direct layout controls and still saves minimum line width', async () => {
    const api = createDeepgramApi();
    render(<PopupApp api={api} />);

    await screen.findByLabelText('每行長度下限');
    expect(screen.queryByLabelText('顯示行數')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('字幕寬度')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('距底部位置')).not.toBeInTheDocument();

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
        geminiApiKey: 'gm',
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
