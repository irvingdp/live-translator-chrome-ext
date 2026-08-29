import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OnboardingApp } from '../../src/onboarding/OnboardingApp';

describe('OnboardingApp', () => {
  it('renders the localized four-step Gemini API key guide', () => {
    render(<OnboardingApp />);

    expect(screen.getByRole('heading', {
      level: 1,
      name: '建立你的 Gemini API Key',
    })).toBeVisible();
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => within(step).getByRole('heading').textContent)).toEqual([
      '登入 Google AI Studio',
      '使用現有 Key 或建立新 Key',
      '命名 Key 並選擇 project',
      '複製 Key 並回到擴充功能設定',
    ]);
  });

  it('uses accessible screenshots with no secret in their source paths', () => {
    render(<OnboardingApp />);

    const screenshots = screen.getAllByRole('img');
    expect(screenshots).toHaveLength(3);
    expect(screenshots.map((image) => image.getAttribute('src'))).toEqual([
      '/onboarding/ai-studio-create-button.png',
      '/onboarding/ai-studio-create-dialog.png',
      '/onboarding/ai-studio-copy-key.png',
    ]);
    for (const screenshot of screenshots) {
      expect(screenshot).toHaveAccessibleName();
    }
  });

  it('opens AI Studio in a separate tab without passing opener access', () => {
    render(<OnboardingApp />);

    const links = screen.getAllByRole('link', { name: '開啟 Google AI Studio' });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://aistudio.google.com/api-keys');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });
});
