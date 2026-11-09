import { useEffect, useRef, useState } from 'react';
import RunwayScene from '../components/intro/RunwayScene';
import './IntroRunwayPage.css';

type Props = { onStart: () => void };

const TAKEOFF_MS = 1400;
const FEATURES = ['운항 현황', '출국장 혼잡도', '운항 여건', '편의시설', '스마트 알림'];

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** 첫 소개 화면: 해 질 무렵 활주로에서 이륙하며 대시보드로 들어갑니다. */
export default function IntroRunwayPage({ onStart }: Props) {
  const [flat, setFlat] = useState(false);
  const [takingOff, setTakingOff] = useState(false);
  const timerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const start = () => {
    if (takingOff) return;
    // 움직임 줄이기 설정이면 이륙 장면 없이 바로 이동합니다.
    if (prefersReducedMotion()) {
      onStart();
      return;
    }
    setTakingOff(true);
    timerRef.current = window.setTimeout(onStart, TAKEOFF_MS);
  };

  return <main className={['intro-runway', flat && 'is-flat', takingOff && 'is-taking-off'].filter(Boolean).join(' ')} aria-labelledby="intro-title">
    <div className="intro-runway__scene" aria-hidden="true">
      {!flat && <RunwayScene takingOff={takingOff} onUnavailable={() => setFlat(true)} />}
    </div>
    <div className="intro-runway__shade" aria-hidden="true" />
    <div className="intro-runway__flash" aria-hidden="true" />

    <section className="intro-runway__copy">
      <small className="intro-runway__eyebrow">INCHEON AIRPORT LIVE DASHBOARD</small>
      <h1 id="intro-title">내 비행을 위한<br />인천공항의 모든 순간</h1>
      <p className="intro-runway__lead">실시간 운항 현황, 출국장 혼잡도, 날씨와 편의시설 정보를 한 화면에서 확인하세요.</p>
      <ul className="intro-runway__tags" aria-label="주요 기능">
        {FEATURES.map(feature => <li key={feature}>{feature}</li>)}
      </ul>
      <button type="button" className="intro-runway__start" onClick={start} ref={buttonRef} disabled={takingOff}>
        대시보드 시작하기<span aria-hidden="true">→</span>
      </button>
    </section>
  </main>;
}
