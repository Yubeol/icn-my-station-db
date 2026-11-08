import { useEffect, useRef, useState } from 'react';
import ParticleScene from '../components/intro/ParticleScene';
import './IntroPage.css';

type Props = { onStart: () => void };

const EXIT_MS = 800;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** 첫 소개 화면: 항공기, ICN, 터미널로 변하는 입자 장면입니다. */
export default function IntroPage({ onStart }: Props) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const start = () => {
    if (exiting) return;
    // 움직임 줄이기 설정이면 바로 이동합니다.
    if (prefersReducedMotion()) {
      onStart();
      return;
    }
    setExiting(true);
    timerRef.current = window.setTimeout(onStart, EXIT_MS);
  };

  return <main className={`intro-hero ${exiting ? 'is-exiting' : ''}`} aria-labelledby="intro-title">
    <ParticleScene exiting={exiting} />

    <section className="intro-hero__copy">
      <small className="intro-hero__eyebrow">INCHEON AIRPORT LIVE DASHBOARD</small>
      <h1 id="intro-title">내 비행을 위한<br />인천공항의 모든 순간</h1>
      <p className="intro-hero__lead">실시간 운항 현황, 출국장 혼잡도, 날씨와 편의시설 정보를 한 화면에서 확인하세요.</p>
      <button type="button" className="intro-hero__start" onClick={start} ref={buttonRef} disabled={exiting}>
        대시보드 시작하기<span aria-hidden="true">→</span>
      </button>
      <p className="intro-hero__hint">마우스를 움직이거나 클릭해 보세요.</p>
    </section>
  </main>;
}
