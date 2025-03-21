// app/analysis/status/page.tsx
import { getAnalysisResult } from "@/app/actions";
import { type PageProps } from "@/types/page-props";
import { redirect } from "next/navigation";
import AnalysisProgress from "./_components/AnalysisProgress";

export const dynamic = "force-dynamic";

type StatusSearchParams = {
  session_id?: string;
};

export default async function Page({
  searchParams,
}: PageProps<
  Record<string, string>,
  StatusSearchParams
>): Promise<React.JSX.Element> {
  const sessionId = (await searchParams).session_id;

  if (!sessionId) {
    redirect("/");
  }

  const analysisResult = await getAnalysisResult(sessionId);

  if (!analysisResult) {
    redirect("/analysis/error");
  }

  // 分析完了の場合
  if ("analysis" in analysisResult && "advice" in analysisResult) {
    redirect(`/analysis/success?session_id=${sessionId}`);
  }

  // 処理中の状態
  if (
    "status" in analysisResult &&
    (analysisResult.status === "ANALYZING" ||
      analysisResult.status === "PAID_AWAITING_ANALYSIS")
  ) {
    return (
      <AnalysisProgress
        message={analysisResult.message}
        sessionId={sessionId}
      />
    );
  }

  // その他のステータス
  redirect("/analysis/error");
}
