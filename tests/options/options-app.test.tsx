import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OptionsApp } from '../../src/options/OptionsApp';
import type { OptionsApi } from '../../src/options/browser-api';

function createApi(overrides: Partial<OptionsApi> = {}): OptionsApi {
  return {
    loadKeys: vi.fn().mockResolvedValue({
      cloudflareAccountId: 'acc',
      cloudflareApiToken: 'cf-existing',
      geminiApiKey: 'gm-existing',
      groqApiKey: '',
    }),
    saveKeys: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('OptionsApp', () => {
  it('loads the keys into password fields, with no Deepgram, DeepL or Microsoft key', async () => {
    render(<OptionsApp api={createApi()} />);

    expect(await screen.findByLabelText('Gemini API Key')).toHaveValue(
      'gm-existing',
    );
    expect(screen.getByLabelText('Cloudflare API Token')).toHaveValue('cf-existing');
    expect(screen.getByLabelText('Gemini API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByLabelText('Cloudflare API Token')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.queryByLabelText('Deepgram API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('DeepL API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Microsoft Translator API Key')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Cloudflare 帳號 ID')).toHaveValue('acc');
  });

  it('reveals only the selected key', async () => {
    render(<OptionsApp api={createApi()} />);
    await screen.findByLabelText('Gemini API Key');

    fireEvent.click(
      screen.getByRole('button', { name: '顯示 Cloudflare API Token' }),
    );

    expect(screen.getByLabelText('Gemini API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByLabelText('Cloudflare API Token')).toHaveAttribute(
      'type',
      'text',
    );
  });

  it('saves edited keys and confirms success', async () => {
    const api = createApi();
    render(<OptionsApp api={api} />);
    const cloudflare = await screen.findByLabelText('Cloudflare API Token');
    fireEvent.change(cloudflare, { target: { value: 'cf-new' } });

    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));

    await waitFor(() =>
      expect(api.saveKeys).toHaveBeenCalledWith({
        cloudflareAccountId: 'acc',
        cloudflareApiToken: 'cf-new',
        geminiApiKey: 'gm-existing',
        groqApiKey: '',
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
    await screen.findByLabelText('Cloudflare API Token');

    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));

    expect(
      await screen.findByText('API Key 儲存失敗，請重試。'),
    ).toBeVisible();
    expect(screen.queryByText('API Key 已儲存')).not.toBeInTheDocument();
  });
});
