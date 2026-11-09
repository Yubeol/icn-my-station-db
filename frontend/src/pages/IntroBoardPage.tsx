import { useEffect, useRef, useState } from 'react';
import BoardScene from '../components/intro/BoardScene';
import './IntroBoardPage.css';

type Props = { onStart: () => void };

const LEAVE_MS = 800;
const FEATURES = ['운항 현황', '출국장 혼잡도', '운항 여건', '편의시설', '스마트 알림'];

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** 첫 소개 화면: 어두운 출국장의 출발 전광판으로 입장합니다. */
export default function IntroBoardPage({ onStart }: Props) {
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const start = () => {
    if (leaving) return;
    // 움직임 줄이기 설정이면 카메라 이동 없이 바로 전환합니다.
    if (prefersReducedMotion()) {
      onStart();
      return;
    }
    setLeaving(true);
    timerRef.current = window.setTimeout(onStart, LEAVE_MS);
  };

  return <main className={`intro-hall ${leaving ? 'is-leaving' : ''}`} aria-labelledby="intro-title">
    <div className="intro-hall__room" aria-hidden="true">
      <i className="intro-hall__light intro-hall__light--one" />
      <i className="intro-hall__light intro-hall__light--two" />
      <i className="intro-hall__light intro-hall__light--three" />
      <i className="intro-hall__floor" />
    </div>

    <div className="intro-hall__stage">
      <div className="intro-hall__board">
        <BoardScene />
        <i className="intro-hall__mount" aria-hidden="true" />
      </div>

      <section className="intro-hall__copy">
        <h1 id="intro-title">내 비행을 위한 인천공항의 모든 순간</h1>
        <p>실시간 운항 현황, 출국장 혼잡도, 날씨와 편의시설 정보를 한 화면에서 확인하세요.</p>
        <ul className="intro-hall__tags" aria-label="주요 기능">
          {FEATURES.map(feature => <li key={feature}>{feature}</li>)}
        </ul>
        <button type="button" className="intro-hall__start" onClick={start} ref={buttonRef} disabled={leaving}>
          대시보드 시작하기<span aria-hidden="true">→</span>
        </button>
      </section>
    </div>
    <div className="intro-hall__fade" aria-hidden="true" />
  </main>;
}
