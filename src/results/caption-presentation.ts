import {
  captionStatusForMeta,
  type CaptionStatus,
} from '../core/captions';

const ABSENT_WARNING =
  '이 영상은 자막이 없어 장면만 추출됩니다. 대본 TXT는 제공되지 않습니다.';
const FETCH_FAILED_WARNING =
  '자막은 있지만 가져오지 못했습니다. 원본 탭에서 다시 시도해주세요.';

export interface CaptionPresentation {
  txtEnabled: boolean;
  warning: string | null;
}

export function captionPresentationForStatus(status: CaptionStatus): CaptionPresentation {
  if (status === 'available') return { txtEnabled: true, warning: null };
  return {
    txtEnabled: false,
    warning: status === 'fetch-failed' ? FETCH_FAILED_WARNING : ABSENT_WARNING,
  };
}

export function captionPresentationForMeta(meta: {
  captionStatus?: CaptionStatus;
  captionsAvailable: boolean;
}): CaptionPresentation {
  return captionPresentationForStatus(captionStatusForMeta(meta));
}
