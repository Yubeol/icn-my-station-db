import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 700;

/** 값이 바뀌면 이전 값에서 새 값까지 부드럽게 올라가거나 내려가는 숫자입니다. */
export default function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const progress = Math.min((time - started) / DURATION_MS, 1);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{shown.toLocaleString('ko-KR')}</>;
}
