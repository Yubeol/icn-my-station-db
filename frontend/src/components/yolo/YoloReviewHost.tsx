import { useYolo } from '../../hooks/useYoloLive'
import YoloReviewViewer from './YoloReviewViewer'

/** 판정 모드 CCTV 뷰어를 앱 어디서든 열 수 있도록 맨 위에 한 번만 두는 자리입니다. 열려는 쪽은 useYolo().openReview(event)를 부릅니다. */
export default function YoloReviewHost() {
  const { reviewing, closeReview } = useYolo()
  return reviewing ? <YoloReviewViewer event={reviewing} onClose={closeReview} /> : null
}
