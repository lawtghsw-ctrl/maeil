import type { Config } from "tailwindcss";

// 도원 Admin(tg_m)과 동일한 디자인으로 맞추기 위해, 커스텀 컬러/라운딩/섀도 토큰을 모두
// 제거하고 Tailwind 기본 팔레트(slate/blue/emerald/amber/red)만 사용합니다.
// 폰트/배경색 등은 app/globals.css에서 도원 Admin과 동일하게 지정합니다.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
