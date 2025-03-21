import {
  type AnalysisProgressData,
  analyzeChannel,
  refundFailedAnalysis,
} from "@/app/actions";
import { prisma } from "@/lib/prisma";

// 支払い後に分析を実行する関数
// eslint-disable-next-line import/prefer-default-export
export async function processAnalysisAfterPayment(
  sessionId: string,
): Promise<void> {
  try {
    const record = await prisma.analysis.findUnique({
      where: { id: sessionId },
    });

    if (!record || !record.isPaid) {
      throw new Error("有効な決済レコードが見つかりません");
    }

    const currentData = record.analysisData as unknown as AnalysisProgressData;

    await prisma.analysis.update({
      data: {
        analysisData: { ...currentData, status: "ANALYZING" },
      },
      where: { id: sessionId },
    });

    const options = currentData.options || {
      modelType: "gpt-4-turbo",
      videoCount: 25,
    };
    const analysisResult = await analyzeChannel(record.channelInput, options);

    await prisma.analysis.update({
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysisData: analysisResult as any,
      },
      where: { id: sessionId },
    });
  } catch (error) {
    console.error("分析エラー:", error);

    const record = await prisma.analysis.findUnique({
      where: { id: sessionId },
    });

    if (!record) return;

    const currentData = record.analysisData as unknown as AnalysisProgressData;

    await prisma.analysis.update({
      data: {
        analysisData: {
          ...currentData,
          error: error instanceof Error ? error.message : String(error),
          status: "FAILED",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      where: { id: sessionId },
    });

    await refundFailedAnalysis(sessionId);
  }
}
