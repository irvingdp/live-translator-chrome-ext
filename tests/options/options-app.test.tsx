import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OptionsApp } from '../../src/options/OptionsApp';
import type { OptionsApi } from '../../src/options/browser-api';

function createApi(overrides: Partial<OptionsApi> = {}): OptionsApi {
  return {
    loadKeys: vi.fn().mockResolvedValue({
      geminiApiKey: 'gm-existing',
      groqApiKey: 'gq-existing',
    }),
    saveKeys: vi.fn().mockResolvedValue(undefined),
    listSites: vi.fn().mockResolvedValue([]),
    removeSite: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('OptionsApp', () => {
  it('loads the keys into password fields, with no Deepgram, DeepL, Microsoft or Cloudflare key', async () => {
    render(<OptionsApp api={createApi()} />);

    expect(await screen.findByLabelText('Gemini API Key')).toHaveValue(
      'gm-existing',
    );
    expect(screen.getByLabelText('Groq API Key')).toHaveValue('gq-existing');
    expect(screen.getByLabelText('Gemini API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByLabelText('Groq API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.queryByLabelText('Deepgram API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('DeepL API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Microsoft Translator API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cloudflare API Token')).not.toBeInTheDocument();
  });

  it('reveals only the selected key', async () => {
    render(<OptionsApp api={createApi()} />);
    await screen.findByLabelText('Gemini API Key');

    fireEvent.click(
      screen.getByRole('button', { name: '顯示 Groq API Key' }),
    );

    expect(screen.getByLabelText('Gemini API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByLabelText('Groq API Key')).toHaveAttribute(
      'type',
      'text',
    );
  });

  it('saves edited keys and confirms success', async () => {
    const api = createApi();
    render(<OptionsApp api={api} />);
    const groq = await screen.findByLabelText('Groq API Key');
    fireEvent.change(groq, { target: { value: 'gq-new' } });

    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));

    await waitFor(() =>
      expect(api.saveKeys).toHaveBeenCalledWith({
        geminiApiKey: 'gm-existing',
        groqApiKey: 'gq-new',
      }),
    );
    expect(await screen.findByText('API Key 已儲存')).toBeVisible();
  });

  it('shows visible feedback when loading fails', async () => {
    render(
      <OptionsApp
        api={createApi({
          loadKeys: vi.fn().mockRejectedValue(new Error('storage unavailable')),
        })}
      />,
    );

    expect(
      await screen.findByText('無法載入 API Key，請重新整理後再試。'),
    ).toBeVisible();
  });

  it('does not claim success when saving fails', async () => {
    render(
      <OptionsApp
        api={createApi({
          saveKeys: vi.fn().mockRejectedValue(new Error('storage unavailable')),
        })}
      />,
    );
    await screen.findByLabelText('Groq API Key');

    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));

    expect(
      await screen.findByText('API Key 儲存失敗，請重試。'),
    ).toBeVisible();
    expect(screen.queryByText('API Key 已儲存')).not.toBeInTheDocument();
  });

  it('lists the sites allowed for read-ahead and removes one', async () => {
    const api = createApi({ listSites: vi.fn().mockResolvedValue(['https://www.bilibili.com', 'https://www.youtube.com']) });
    render(<OptionsApp api={api} />);
    expect(await screen.findByText('www.bilibili.com')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]!);
    await waitFor(() => expect(api.removeSite).toHaveBeenCalledWith('https://www.bilibili.com'));
    await waitFor(() => expect(screen.queryByText('www.bilibili.com')).not.toBeInTheDocument());
    expect(screen.getByText('www.youtube.com')).toBeVisible();
  });
});
