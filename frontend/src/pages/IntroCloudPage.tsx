import { useEffect, useRef, useState } from 'react';
import CloudScene from '../components/intro/CloudScene';
import './IntroCloudPage.css';

type Props = { onStart: () => void };

const LEAVE_MS = 700;
const FEATURES = ['운항 현황', '출국장 혼잡도', '운항 여건', '편의시설', '스마트 알림'];

/** 처음 들어온 사용자에게 보여 주는 구름 위 비행 소개 화면입니다. */
export default function IntroCloudPage({ onStart }: Props) {
  const [flat, setFlat] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  const timerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
    // 화면이 보이지 않을 때는 항공기 애니메이션도 멈춥니다.
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const start = () => {
    if (leaving) return;
    setLeaving(true);
    timerRef.current = window.setTimeout(onStart, LEAVE_MS);
  };

  return <main
    className={['intro', flat && 'is-flat', leaving && 'is-leaving', paused && 'is-paused'].filter(Boolean).join(' ')}
    aria-labelledby="intro-title">
    <div className="intro__scene" aria-hidden="true">
      {!flat && <CloudScene leaving={leaving} onUnavailable={() => setFlat(true)} />}
      <div className="intro__flight">
        <div className="intro__plane">
          <svg viewBox="0 0 64 24" focusable="false">
            <path d="M2 12.2 Q4 10.6 9 10.4 L25 10.2 L36 1.5 L41.5 1.5 L35 10.2 L52 10 L57.5 5.2 L61 5.2 L58.6 11 Q60 12 58.6 13 L61 18.8 L57.5 18.8 L52 14 L35 13.8 L41.5 22.5 L36 22.5 L25 13.8 L9 13.6 Q4 13.4 2 12.2 Z" />
          </svg>
        </div>
      </div>
    </div>
    <div className="intro__shade" aria-hidden="true" />
    <div className="intro__flash" aria-hidden="true" />

    <section className="intro__copy">
      <small className="intro__eyebrow">INCHEON AIRPORT LIVE DASHBOARD</small>
      <h1 id="intro-title">내 비행을 위한<br />인천공항의 모든 순간</h1>
      <p className="intro__lead">실시간 운항 현황, 출국장 혼잡도, 날씨와 편의시설 정보를 한 화면에서 확인하세요.</p>
      <ul className="intro__tags" aria-label="주요 기능">
        {FEATURES.map(feature => <li key={feature}>{feature}</li>)}
      </ul>
      <button type="button" className="intro__start" onClick={start} ref={buttonRef} disabled={leaving}>
        대시보드 시작하기<span aria-hidden="true">→</span>
      </button>
    </section>
  </main>;
}
