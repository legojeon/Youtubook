import { describe, expect, it } from 'vitest';
import { captionPresentationForMeta } from './caption-presentation';

describe('captionPresentationForMeta', () => {
  it('enables TXT without a warning only for available captions', () => {
    expect(captionPresentationForMeta({
      captionsAvailable: true,
      captionStatus: 'available',
    })).toEqual({ txtEnabled: true, warning: null });
  });

  it('shows the persistent no-caption warning for absent captions', () => {
    expect(captionPresentationForMeta({
      captionsAvailable: false,
      captionStatus: 'absent',
    })).toEqual({
      txtEnabled: false,
      warning: '이 영상은 자막이 없어 장면만 추출됩니다. 대본 TXT는 제공되지 않습니다.',
    });
  });

  it('shows a retry warning for caption fetch failures', () => {
    expect(captionPresentationForMeta({
      captionsAvailable: false,
      captionStatus: 'fetch-failed',
    })).toEqual({
      txtEnabled: false,
      warning: '자막은 있지만 가져오지 못했습니다. 원본 탭에서 다시 시도해주세요.',
    });
  });

  it('normalizes legacy metadata from captionsAvailable', () => {
    expect(captionPresentationForMeta({ captionsAvailable: true }).txtEnabled).toBe(true);
    expect(captionPresentationForMeta({ captionsAvailable: false }).warning)
      .toContain('자막이 없어');
  });
});
