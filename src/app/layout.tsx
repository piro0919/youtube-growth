// eslint-disable-next-line filenames/match-exported
import { type LayoutProps } from "@/types/page-props";
import { Noto_Sans_JP as NotoSansJP } from "next/font/google";
import "./globals.css";
import "ress";
import type { Metadata } from "next";

const notoSansJP = NotoSansJP({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  description:
    "YouTube Growth は、あなたの YouTube チャンネルの可能性を最大限に引き出すAI駆動のアドバイザーです。チャンネルデータを分析し、視聴者増加、エンゲージメント向上、収益化の最適化のための具体的かつ実用的な成長戦略を提供します。データに基づいたパーソナライズされたアドバイスで、次のレベルへとチャンネルを成長させましょう。",
  title: "YouTube Growth",
};

export default function RootLayout({
  children,
}: LayoutProps): React.JSX.Element {
  return (
    <html lang="ja">
      <body className={notoSansJP.className}>{children}</body>
    </html>
  );
}
