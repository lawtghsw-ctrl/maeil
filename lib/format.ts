// 포맷 유틸 — 로피 스펙의 fmtMan / fmtEokMan 로직을 이식.

export function fmtWon(v: number): string {
  return Math.round(v).toLocaleString("ko-KR") + "원";
}

export function fmtMan(v: number): string {
  const man = Math.round(v / 10000);
  return man.toLocaleString("ko-KR") + "만원";
}

// 1억 이상이면 '억' 단위를 붙여서 큰 금액을 더 읽기 쉽게 표시
// 예: 401,000,000 → '4억 100만원'
export function fmtEokMan(v: number): string {
  const eok = Math.floor(v / 100000000);
  const man = Math.round((v % 100000000) / 10000);
  if (eok > 0) {
    return man > 0
      ? `${eok.toLocaleString("ko-KR")}억 ${man.toLocaleString("ko-KR")}만원`
      : `${eok.toLocaleString("ko-KR")}억원`;
  }
  return fmtMan(v);
}

export function fmtPct(v: number, digits = 1): string {
  return `${v >= 0 ? "" : ""}${v.toFixed(digits)}%`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`;
}

// 오늘 기준 D-day 문자열 (미래=D-n, 오늘=D-day, 과거=D+n)
export function ddayLabel(iso: string, today: Date = new Date()): string {
  const target = new Date(iso + "T00:00:00");
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((target.getTime() - t0.getTime()) / 86400000);
  if (diffDays === 0) return "D-day";
  return diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
}

// 증감 배지 색상 클래스 — invert=true면 "증가=부정(빨강)" 규칙 적용 (미수금 등)
export function deltaClass(pct: number, invert = false): string {
  const positive = pct >= 0;
  const isNegativeSignal = invert ? positive : !positive;
  if (pct === 0) return "text-muted";
  return isNegativeSignal ? "text-danger" : "text-success";
}

export function fmtDeltaPct(pct: number): string {
  const sign = pct > 0 ? "▲" : pct < 0 ? "▼" : "-";
  return `${sign} ${Math.abs(pct).toFixed(1)}%`;
}
