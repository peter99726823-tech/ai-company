import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 회사 시뮬레이터",
  description: "AI 직원들이 실제로 일하고, 그 과정이 픽셀아트 사무실에 나타나는 개인용 AI 회사 운영 시스템",
};

export const viewport: Viewport = { themeColor: "#0b0d15", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preload" href="/fonts/Galmuri11.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
