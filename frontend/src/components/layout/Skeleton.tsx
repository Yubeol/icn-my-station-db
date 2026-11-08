import type { CSSProperties } from 'react';
import './Skeleton.css';

type Variant = 'rows' | 'block' | 'donut' | 'chart' | 'pass' | 'cards';

type Props = {
  /** 화면 읽기 프로그램에 전달할 문구입니다. */
  label: string;
  variant?: Variant;
  /** rows, cards 형태에서 반복할 개수입니다. */
  count?: number;
  className?: string;
  style?: CSSProperties;
};

const BAR_HEIGHTS = [38, 62, 48, 80, 56, 92, 70, 44, 66, 52, 76, 40];

/** 초기 로딩 동안 실제 화면 모양을 흐릿하게 보여 주는 자리표시자입니다. */
export default function Skeleton({ label, variant = 'rows', count = 3, className = '', style }: Props) {
  return <div className={`icn-skeleton icn-skeleton--${variant} ${className}`} role="status" aria-live="polite" aria-busy="true" style={style}>
    <span className="icn-skeleton__label">{label}</span>
    {variant === 'rows' && Array.from({ length: count }, (_, index) => <div key={index} className="icn-skeleton__row" aria-hidden="true">
      <i className="icn-skeleton__dot" />
      <span><i style={{ width: `${72 - (index % 3) * 12}%` }} /><i style={{ width: `${46 + (index % 2) * 14}%` }} /></span>
    </div>)}
    {variant === 'block' && <i className="icn-skeleton__fill" aria-hidden="true" />}
    {variant === 'donut' && <div className="icn-skeleton__donut" aria-hidden="true">
      <i className="icn-skeleton__ring" />
      <span>{[0, 1, 2, 3].map(index => <i key={index} />)}</span>
    </div>}
    {variant === 'chart' && <div className="icn-skeleton__bars" aria-hidden="true">
      {BAR_HEIGHTS.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
    </div>}
    {variant === 'pass' && <div className="icn-skeleton__pass" aria-hidden="true">
      <div><i /><i /><i /></div>
      <div><i /><i /><i /></div>
    </div>}
    {variant === 'cards' && <div className="icn-skeleton__cards" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <div key={index}><i /><i /><i /><i /></div>)}
    </div>}
  </div>;
}
