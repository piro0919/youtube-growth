import { getAnalysisResult } from "@/app/actions";
import { type PageProps } from "@/types/page-props";
import { redirect } from "next/navigation";
import Success from "./_components/Success";

// オンデマンド ISR
export const dynamicParams = true;

type SuccessSearchParams = {
  session_id?: string;
};

export default async function Page({
  searchParams,
}: PageProps<
  Record<string, string>,
  SuccessSearchParams
>): Promise<React.JSX.Element> {
  const sessionId = (await searchParams).session_id;

  if (!sessionId) {
    redirect("/");
  }

  const analysisResult = await getAnalysisResult(sessionId);

  // 分析結果がない場合はエラーページへ
  if (!analysisResult) {
    redirect("/analysis/error");
  }

  // 分析が完了していない場合はステータスページへ戻す
  if (!("analysis" in analysisResult && "advice" in analysisResult)) {
    redirect(`/analysis/status?session_id=${sessionId}`);
  }

  // 分析が完了している場合のみSuccessコンポーネントを表示
  return <Success analysisResult={analysisResult} />;
}
