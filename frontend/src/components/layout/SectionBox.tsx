import type { ReactNode } from 'react';

type Props = { title: string; children: ReactNode; onNavigate?: () => void; className?: string };

export default function SectionBox({ title, children, onNavigate, className = '' }: Props) {
  return <section className={`icn-section ${className}`}>
    <div className="icn-section__header"><h2>{title}</h2>{onNavigate && <button className="icn-more" type="button" onClick={onNavigate}>상세 보기 ›</button>}</div>
    <div className="icn-section__body">{children}</div>
  </section>;
}
