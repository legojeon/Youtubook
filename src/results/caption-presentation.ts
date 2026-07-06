import {
  captionStatusForMeta,
  type CaptionStatus,
} from '../core/captions';

export interface CaptionPresentation {
  txtEnabled: boolean;
  warningKey: 'banner_noCaptions' | 'banner_captionFetchFail' | null;
}

export function captionPresentationForMeta(meta: {
  captionStatus?: CaptionStatus;
  captionsAvailable: boolean;
}): CaptionPresentation {
  const status = captionStatusForMeta(meta);
  if (status === 'available') return { txtEnabled: true, warningKey: null };
  return {
    txtEnabled: false,
    warningKey: status === 'fetch-failed' ? 'banner_captionFetchFail' : 'banner_noCaptions',
  };
}
