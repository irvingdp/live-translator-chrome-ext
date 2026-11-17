import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PopupApp, type PopupApi } from '../../src/popup/PopupApp';
import { INITIAL_RATING_PROMPT } from '../../src/core/rating-prompt';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

function createApi(overrides: Partial<PopupApi> = {}): PopupApi {
  return {
    authorizeCurrentTab: vi.fn().mockResolvedValue(undefined),
    extensionVersion: vi.fn().mockReturnValue('1.4.0'),
    loadRatingPrompt: vi.fn().mockResolvedValue(INITIAL_RATING_PROMPT),
    saveRatingPrompt: vi.fn().mockResolvedValue(undefined),
    sendFeedback: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ state: 'running', tabId: 42 }),
    status: vi.fn().mockResolvedValue({ state: 'idle' }),
    stop: vi.fn().mockResolvedValue({ state: 'idle' }),
    takeDeepgramRemovedNotice: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe('PopupApp', () => {
  it('authorizes the current tab while loading the popup', async () => {
    const api = createApi();

    render(<PopupApp api={api} />);

    await screen.findByLabelText('Gemini API Key');
    expect(api.authorizeCurrentTab).toHaveBeenCalledOnce();
  });

  it('offers only the transcribers that actually work', async () => {
    render(<PopupApp api={createApi()} />);

    const transcriber = await screen.findByLabelText('語音辨識');

    expect(
      [...transcriber.querySelectorAll('option')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Gemini live translate 3.5', 'Gemini 預讀']);
    expect(transcriber).toHaveValue('gemini');
  });

  it('asks only for the Gemini API Key, for both modes', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);

    expect(await screen.findByText('API Key 尚未設定')).toBeVisible();
    expect(screen.getByLabelText('Gemini API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.queryByLabelText('Deepgram API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('DeepL API Key')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('語音辨識'), {
      target: { value: 'gemini-read-ahead' },
    });

    expect(screen.getByLabelText('Gemini API Key')).toBeVisible();
    expect(screen.queryByLabelText('DeepL API Key')).not.toBeInTheDocument();
  });

  it('shows an API Key as missing as soon as its textbox is cleared', async () => {
    render(<PopupApp api={createApi({
      loadSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_SETTINGS,
        geminiApiKey: 'gm',
      }),
    })} />);

    const key = await screen.findByLabelText('Gemini API Key');
    expect(screen.getByText('API Key 已設定')).toBeVisible();

    fireEvent.change(key, { target: { value: '' } });

    expect(screen.getByText('API Key 尚未設定')).toBeVisible();
    expect(screen.queryByText('API Key 已設定')).not.toBeInTheDocument();
  });

  it('saves an API Key only after explicit confirmation and can reveal it', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);
    const key = await screen.findByLabelText('Gemini API Key');

    fireEvent.change(key, { target: { value: 'gm-new' } });
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(screen.getByText('API Key 尚未設定')).toBeVisible();
    expect(screen.queryByText('API Key 已設定')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '顯示 Gemini API Key' }));
    expect(key).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: '設定 Gemini API Key' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ geminiApiKey: 'gm-new' }),
    ));
    expect(screen.getByText('API Key 已設定')).toBeVisible();
    expect(screen.getByLabelText('Gemini API Key')).toHaveValue('gm-new');
  });

  it('names the key the selected provider actually needs', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);
    await screen.findByText('API Key 尚未設定');

    fireEvent.click(screen.getByRole('switch', { name: '開始即時字幕' }));

    const missingKeyMessage = await screen.findByText(
      /請先輸入 Gemini API Key，前往申請:/,
    );
    expect(missingKeyMessage).toBeVisible();
    const guidance = missingKeyMessage.closest<HTMLElement>('[role="status"]');
    expect(guidance).not.toBeNull();
    expect(within(guidance!).getByRole('link', {
      name: '如何建立 Gemini API Key？',
    })).toHaveAttribute(
      'href',
      'onboarding.html',
    );
    expect(api.start).not.toHaveBeenCalled();
  });

  it('starts with normalized settings and changes the CTA to stop', async () => {
    const api = createApi({
      loadSettings: vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, geminiApiKey: 'gm' }),
    });
    render(<PopupApp api={api} />);

    fireEvent.click(
      await screen.findByRole('switch', { name: '開始即時字幕' }),
    );

    await waitFor(() => expect(api.start).toHaveBeenCalledOnce());
    expect(await screen.findByRole('switch', { name: '停止字幕' })).toBeChecked();
  });

  it('keeps original and translation font controls independent', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);
    const original = await screen.findByLabelText('原文字級');
    const translation = screen.getByLabelText('譯文字級');

    fireEvent.change(original, { target: { value: '32' } });

    expect(original).toHaveValue('32');
    expect(translation).toHaveValue('16');
  });

  it('saves colors from both the palette and an exact Hex value', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);

    fireEvent.change(await screen.findByLabelText('原文顏色'), {
      target: { value: '#123456' },
    });
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ originalTextColor: '#123456' }),
    ));

    const translationCode = screen.getByLabelText('譯文顏色色碼');
    fireEvent.change(translationCode, { target: { value: '#ABCDEF' } });
    fireEvent.blur(translationCode);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ translationTextColor: '#abcdef' }),
    ));
  });

  it('rejects incomplete Hex colors and restores both default colors atomically', async () => {
    const api = createApi({
      loadSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_SETTINGS,
        originalTextColor: '#112233',
        translationTextColor: '#445566',
      }),
    });
    render(<PopupApp api={api} />);
    const originalCode = await screen.findByLabelText('原文顏色色碼');

    fireEvent.change(originalCode, { target: { value: '#fff' } });
    expect(originalCode).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(originalCode);
    expect(originalCode).toHaveValue('#112233');
    expect(api.saveSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '恢復預設顏色' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledOnce());
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      originalTextColor: '#ffffff',
      translationTextColor: '#fde68a',
    }));
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

    expect(original).toHaveAttribute('min', '12');
    expect(original).toHaveAttribute('max', '36');
    expect(original).toHaveValue('16');
    expect(translation).toHaveAttribute('min', '12');
    expect(translation).toHaveAttribute('max', '36');
    expect(translation).toHaveValue('16');

    fireEvent.change(original, { target: { value: '34' } });
    fireEvent.change(translation, { target: { value: '18' } });

    expect(original).toHaveValue('34');
    expect(translation).toHaveValue('18');
  });

  it('saves the background opacity when its slider moves', async () => {
    const api = createApi();
    render(<PopupApp api={api} />);

    fireEvent.change(await screen.findByLabelText('背景透明度'), {
      target: { value: '30' },
    });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundOpacity: 30 }),
      ),
    );
  });

  it('links to the Gemini key guide, with no translator or line-width controls', async () => {
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
      screen.getByRole('link', { name: '如何建立 Gemini API Key？' }),
    ).toHaveAttribute('href', 'onboarding.html');
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
        }),
      ),
    );
  });

  it('lets read-ahead mode pick a source language, auto-detect by default, with the shared Gemini key', async () => {
    const api = createApi({
      loadSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_SETTINGS,
        transcriber: 'gemini-read-ahead',
      }),
    });
    render(<PopupApp api={api} />);

    const source = await screen.findByLabelText('來源語言');
    expect(screen.getByLabelText('Gemini API Key')).toBeInTheDocument();
    expect(screen.queryByLabelText('Deepgram API Key')).not.toBeInTheDocument();
    expect(source).toBeEnabled();
    expect(source).toHaveValue('auto');
    expect([...screen.getByLabelText('目標語言').querySelectorAll('option')].length)
      .toBeGreaterThan(70);

    fireEvent.change(source, { target: { value: 'ja' } });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ geminiSourceLanguage: 'ja', transcriber: 'gemini-read-ahead' }),
      ),
    );
  });

  it('tells the viewer to use Gemini live when read-ahead cannot run on the page', async () => {
    render(
      <PopupApp
        api={createApi({
          loadSettings: vi.fn().mockResolvedValue({
            ...DEFAULT_SETTINGS,
            geminiApiKey: 'gm',
            transcriber: 'gemini-read-ahead',
          }),
          status: vi.fn().mockResolvedValue({
            error: 'read_ahead_unsupported',
            state: 'error',
            tabId: 42,
          }),
        })}
      />,
    );

    expect(await screen.findByText('此網站不支援預讀模式，請改用 Gemini live')).toBeVisible();
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

  it('tells a user moved off Deepgram why it asks for a Gemini key', async () => {
    render(<PopupApp api={createApi({
      takeDeepgramRemovedNotice: vi.fn().mockResolvedValue(true),
    })} />);

    const notice = await screen.findByText(/已不再支援 Deepgram，字幕已改用 Gemini live/);
    expect(within(notice.closest<HTMLElement>('[role="status"]')!).getByRole('link', {
      name: '如何建立 Gemini API Key？',
    })).toHaveAttribute('href', 'onboarding.html');
  });

  it('shows no Deepgram notice otherwise', async () => {
    render(<PopupApp api={createApi()} />);
    await screen.findByLabelText('Gemini API Key');
    expect(screen.queryByText(/Deepgram/)).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('switch', { name: '開始即時字幕' }));

    const stop = await screen.findByRole('switch', { name: '停止字幕' });
    expect(stop).toBeEnabled();
    await waitFor(() => expect(api.start).toHaveBeenCalledOnce());
    fireEvent.click(stop);
    await waitFor(() => expect(api.stop).toHaveBeenCalledOnce());

    releaseStart({ state: 'running', tabId: 42 });
    expect(await screen.findByRole('switch', { name: '開始即時字幕' })).not.toBeChecked();
  });
});

describe('PopupApp rating card', () => {
  const afterFirstTab = {
    ...INITIAL_RATING_PROMPT,
    recentTabIds: [1],
    started: true,
    tabCount: 1,
  };

  function ratingApi(overrides: Partial<PopupApi> = {}) {
    return createApi({
      authorizeCurrentTab: vi.fn().mockResolvedValue({ authorized: true, tabId: 2 }),
      loadRatingPrompt: vi.fn().mockResolvedValue(afterFirstTab),
      ...overrides,
    });
  }

  it('asks for a rating when a second tab is authorized after the first session', async () => {
    const api = ratingApi();
    render(<PopupApp api={api} />);

    expect(await screen.findByRole('heading', { name: '雙語即時字幕翻譯好用嗎？' })).toBeVisible();
    expect(api.saveRatingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ recentTabIds: [1, 2], tabCount: 2 }),
    );
  });

  it('stays quiet on the first tab and on tabs it could not authorize', async () => {
    const first = createApi({
      authorizeCurrentTab: vi.fn().mockResolvedValue({ authorized: true, tabId: 1 }),
    });
    const { unmount } = render(<PopupApp api={first} />);
    await screen.findByLabelText('Gemini API Key');
    expect(screen.queryByText('雙語即時字幕翻譯好用嗎？')).not.toBeInTheDocument();
    unmount();

    render(
      <PopupApp
        api={ratingApi({
          authorizeCurrentTab: vi.fn().mockResolvedValue({ authorized: false, tabId: 2 }),
        })}
      />,
    );
    await screen.findByLabelText('Gemini API Key');
    expect(screen.queryByText('雙語即時字幕翻譯好用嗎？')).not.toBeInTheDocument();
  });

  async function findStars() {
    return Promise.all(
      [1, 2, 3, 4, 5].map((n) => screen.findByRole('button', { name: `${n} 顆星` })),
    );
  }
  const litStars = (stars: HTMLElement[]) =>
    stars.filter((star) => star.classList.contains('filled')).length;

  it.each([1, 2, 3, 4, 5])('hovering star %i lights exactly the stars up to it', async (n) => {
    render(<PopupApp api={ratingApi()} />);
    const stars = await findStars();

    fireEvent.mouseEnter(stars[n - 1]!);

    expect(stars.map((star) => star.classList.contains('filled'))).toEqual(
      [1, 2, 3, 4, 5].map((i) => i <= n),
    );
    fireEvent.mouseLeave(stars[n - 1]!.parentElement!);
    expect(litStars(stars)).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])('keyboard focus on star %i previews the same as hover', async (n) => {
    render(<PopupApp api={ratingApi()} />);
    const stars = await findStars();

    fireEvent.focus(stars[n - 1]!);
    expect(litStars(stars)).toBe(n);
    fireEvent.blur(stars[n - 1]!);
    expect(litStars(stars)).toBe(0);
  });

  it.each([1, 2, 3])('clicking star %i shows the feedback form and keeps that many stars lit', async (n) => {
    const api = ratingApi();
    render(<PopupApp api={api} />);
    const stars = await findStars();

    fireEvent.click(stars[n - 1]!);
    // The pointer has left the stars to type in the form.
    fireEvent.mouseLeave(stars[n - 1]!.parentElement!);

    expect(screen.getByLabelText('哪裡可以做得更好？（選填）')).toBeVisible();
    // The text box only appears once "other" is chosen.
    expect(document.querySelector('.rating-card textarea')).toBeNull();
    expect(screen.getByRole('button', { name: '送出' })).toBeEnabled();
    expect(litStars(stars)).toBe(n);
    expect(stars[n - 1]).toHaveAttribute('aria-pressed', 'true');
    // Nothing navigates away from the popup, and nothing is sent yet.
    expect(screen.queryByText(/線上應用程式商店/)).not.toBeInTheDocument();
    expect(api.sendFeedback).not.toHaveBeenCalled();
  });

  it.each([4, 5])('clicking star %i sends the rating at once, with no form and no Send button', async (n) => {
    const api = ratingApi();
    render(<PopupApp api={api} />);
    const stars = await findStars();

    fireEvent.click(stars[n - 1]!);

    expect(api.sendFeedback).toHaveBeenCalledOnce();
    expect(api.sendFeedback).toHaveBeenCalledWith({
      message: '',
      provider: 'gemini',
      rating: n,
      uiLanguage: 'zh-Hant-TW',
      version: '1.4.0',
    });
    expect(screen.queryByLabelText('哪裡可以做得更好？（選填）')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '送出' })).not.toBeInTheDocument();
    expect(await screen.findByText('謝謝你的回饋！')).toBeVisible();
    await waitFor(() =>
      expect(api.saveRatingPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'done' })),
    );
  });

  it.each([4, 5])('a failed one-click %i-star rating offers a retry, not a form', async (n) => {
    const sendFeedback = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(undefined);
    const api = ratingApi({ sendFeedback });
    render(<PopupApp api={api} />);
    const stars = await findStars();

    fireEvent.click(stars[n - 1]!);

    expect(await screen.findByRole('alert')).toHaveTextContent('送出失敗');
    expect(screen.queryByLabelText('哪裡可以做得更好？（選填）')).not.toBeInTheDocument();
    expect(api.saveRatingPrompt).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));

    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('謝謝你的回饋！')).toBeVisible();
    expect(sendFeedback).toHaveBeenCalledTimes(2);
    expect(sendFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ rating: n }));
  });

  it.each([1, 2, 3])('star %i can be sent on its own with the Send button', async (n) => {
    const api = ratingApi();
    render(<PopupApp api={api} />);
    const stars = await findStars();

    fireEvent.click(stars[n - 1]!);
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByText('謝謝你的回饋！')).toBeVisible();
    expect(api.sendFeedback).toHaveBeenCalledWith({
      message: '',
      provider: 'gemini',
      rating: n,
      uiLanguage: 'zh-Hant-TW',
      version: '1.4.0',
    });
    await waitFor(() =>
      expect(api.saveRatingPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'done' })),
    );
  });

  it('offers the four choices under "what could be better?"', async () => {
    render(<PopupApp api={ratingApi()} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 顆星' }));

    const select = screen.getByLabelText('哪裡可以做得更好？（選填）');
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      '請選擇',
      '字幕翻譯不精準',
      '字幕延遲',
      'UI 介面不友善',
      '其他',
    ]);
    expect(select).toHaveValue('');
  });

  it.each([
    ['字幕翻譯不精準', 'inaccurate'],
    ['字幕延遲', 'delay'],
    ['UI 介面不友善', 'ui'],
  ])('choosing "%s" sends that choice with no text box', async (label, issue) => {
    const api = ratingApi();
    render(<PopupApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '3 顆星' }));

    const select = screen.getByLabelText('哪裡可以做得更好？（選填）');
    fireEvent.change(select, { target: { value: issue } });
    expect(select).toHaveDisplayValue(label);
    expect(document.querySelector('.rating-card textarea')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    await screen.findByText('謝謝你的回饋！');
    expect(api.sendFeedback).toHaveBeenCalledWith({
      issue,
      message: '',
      provider: 'gemini',
      rating: 3,
      uiLanguage: 'zh-Hant-TW',
      version: '1.4.0',
    });
  });

  it('choosing "other" reveals a text box and sends what is typed', async () => {
    const api = ratingApi();
    render(<PopupApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 顆星' }));

    fireEvent.change(screen.getByLabelText('哪裡可以做得更好？（選填）'), {
      target: { value: 'other' },
    });
    fireEvent.change(screen.getByLabelText('請說明'), { target: { value: '想要更大的字' } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    await screen.findByText('謝謝你的回饋！');
    expect(api.sendFeedback).toHaveBeenCalledWith({
      issue: 'other',
      message: '想要更大的字',
      provider: 'gemini',
      rating: 2,
      uiLanguage: 'zh-Hant-TW',
      version: '1.4.0',
    });
    expect(document.querySelector('.rating-card input')).toBeNull();
  });

  it('hides the text box again and drops its text when switching away from "other"', async () => {
    const api = ratingApi();
    render(<PopupApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '1 顆星' }));
    const select = screen.getByLabelText('哪裡可以做得更好？（選填）');

    fireEvent.change(select, { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('請說明'), { target: { value: '不要送出這段' } });
    fireEvent.change(select, { target: { value: 'delay' } });

    expect(screen.queryByLabelText('請說明')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await screen.findByText('謝謝你的回饋！');
    expect(api.sendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ issue: 'delay', message: '' }),
    );
  });

  it('keeps the text and offers a retry when sending fails', async () => {
    const api = ratingApi({ sendFeedback: vi.fn().mockRejectedValue(new TypeError('offline')) });
    render(<PopupApp api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: '1 顆星' }));
    fireEvent.change(screen.getByLabelText('哪裡可以做得更好？（選填）'), {
      target: { value: 'other' },
    });
    fireEvent.change(screen.getByLabelText('請說明'), {
      target: { value: '無法啟動' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('送出失敗');
    expect(screen.getByLabelText('哪裡可以做得更好？（選填）')).toHaveValue('other');
    expect(screen.getByLabelText('請說明')).toHaveValue('無法啟動');
    expect(screen.getByRole('button', { name: '重試' })).toBeEnabled();
    expect(api.saveRatingPrompt).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('snoozes on "later" and hides the card', async () => {
    const api = ratingApi();
    render(<PopupApp api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: '稍後再說' }));

    expect(screen.queryByText('雙語即時字幕翻譯好用嗎？')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.saveRatingPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'snoozed' })),
    );
  });

  it('links to the Chinese website from the footer', async () => {
    render(<PopupApp api={createApi()} />);

    expect(await screen.findByRole('link', { name: '官網' })).toHaveAttribute(
      'href',
      'https://irvingdp.github.io/live-translator-chrome-ext/zh-tw/',
    );
  });
});
