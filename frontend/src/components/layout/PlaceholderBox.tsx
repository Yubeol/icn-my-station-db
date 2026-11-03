type Props = { label: string; className?: string; detail?: string };

/** 내용 표시 영역만 정의합니다. 실제 차트/데이터는 담당 페이지에서 구현합니다. */
export default function PlaceholderBox({ label, className = '', detail }: Props) {
  return <div className={`icn-placeholder ${className}`}><strong>{label}</strong>{detail && <small>{detail}</small>}</div>;
}
