import { prisma } from "@/lib/prisma";
import Error from "./_components/Error";

// エラー情報を取得する関数
async function getErrorInfo(): Promise<{
  message: string;
  time: string;
}> {
  try {
    // 最新のエラーレコードを取得
    const errorRecord = await prisma.analysis.findFirst({
      orderBy: { createdAt: "desc" },
      where: { channelId: "error" },
    });

    if (errorRecord) {
      // 型アサーション - データには error プロパティが含まれていると想定
      const errorData = errorRecord.analysisData as {
        error: string;
        timestamp: string;
      };

      return {
        message: errorData.error || "不明なエラーが発生しました",
        time: errorData.timestamp
          ? new Date(errorData.timestamp).toLocaleString()
          : "不明",
      };
    }
  } catch (e) {
    console.error("エラー情報の取得に失敗しました:", e);
  }

  return {
    message: "分析処理中にエラーが発生しました",
    time: new Date().toLocaleString(),
  };
}

export default async function Page(): Promise<React.JSX.Element> {
  const errorInfo = await getErrorInfo();

  return <Error errorInfo={errorInfo} />;
}
