import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OptionsApp } from '../../src/options/OptionsApp';
import type { OptionsApi } from '../../src/options/browser-api';

function createApi(overrides: Partial<OptionsApi> = {}): OptionsApi {
  return {
    loadKeys: vi.fn().mockResolvedValue({
      deepgramApiKey: 'dg-existing',
      deeplApiKey: 'dl-existing',
    }),
    saveKeys: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('OptionsApp', () => {
  it('loads both keys into password fields', async () => {
    render(<OptionsApp api={createApi()} />);

    expect(await screen.findByLabelText('Deepgram API Key')).toHaveValue(
      'dg-existing',
    );
    expect(screen.getByLabelText('DeepL API Key')).toHaveValue('dl-existing');
    expect(screen.getByLabelText('Deepgram API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByLabelText('DeepL API Key')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('reveals only the selected key', async () => {
    render(<OptionsApp api={createApi()} />);
    await screen.findByLabelText('Deepgram API Key');

    fireEvent.click(
      screen.getByRole('button', { name: '顯示 DeepL API Key' }),
    );

    expect(screen.getByLabelText('Deepgram API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByLabelText('DeepL API Key')).toHaveAttribute(
      'type',
      'text',
    );
  });

  it('saves edited keys and confirms success', async () => {
    const api = createApi();
    render(<OptionsApp api={api} />);
    const deepl = await screen.findByLabelText('DeepL API Key');
    fireEvent.change(deepl, { target: { value: 'dl-new' } });

    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));

    await waitFor(() =>
      expect(api.saveKeys).toHaveBeenCalledWith({
        deepgramApiKey: 'dg-existing',
        deeplApiKey: 'dl-new',
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
    await screen.findByLabelText('DeepL API Key');

    fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));

    expect(
      await screen.findByText('API Key 儲存失敗，請重試。'),
    ).toBeVisible();
    expect(screen.queryByText('API Key 已儲存')).not.toBeInTheDocument();
  });
});
