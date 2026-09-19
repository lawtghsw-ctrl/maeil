import type { Config } from "tailwindcss";

// 디자인 토큰 출처: 로피(LawFee) 고객사 대시보드/운영사 어드민 개발반영 스펙
// (1.디자인 토큰 시트) — 브랜드 컬러(#2944AF)와 라운딩/섀도 체계를 그대로 계승하고,
// 로파워(LawPower) 자체 보조 컬러(회생=블루 계열, 파산=골드 계열)를 추가함.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#161626",
          2: "#1F2038",
          3: "#2A2C4D",
        },
        brand: {
          DEFAULT: "#2944AF",
          dark: "#1C3080",
          light: "#5A72D6",
          pale: "#EEF1FB",
        },
        gold: {
          DEFAULT: "#B06A1A",
          tint: "#FBEFDD",
        },
        success: {
          DEFAULT: "#2C7A3F",
          tint: "#E4F1E6",
        },
        danger: {
          DEFAULT: "#B32C2C",
          tint: "#FBEAE7",
        },
        bg: "#F4F6FC",
        card: "#FFFFFF",
        line: "#E5E8F1",
        ink: "#1B1E2B",
        muted: "#6B7280",
        muted2: "#9CA1B0",
      },
      borderRadius: {
        lg2: "10px",
        md2: "8px",
        sm2: "6px",
      },
      boxShadow: {
        sm2: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)",
        md2: "0 2px 8px rgba(16,24,40,.08), 0 1px 2px rgba(16,24,40,.05)",
        lg2: "0 12px 28px rgba(16,24,40,.16), 0 4px 10px rgba(16,24,40,.08)",
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "Malgun Gothic",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
