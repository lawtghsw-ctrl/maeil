// 클래스명 병합 유틸 — 도원 Admin(app/lib/utils.ts, lib/utils.ts)과 동일한 구현을 그대로 사용.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
