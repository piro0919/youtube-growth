// app/api/analysis/status/route.ts
import { getAnalysisResult } from "@/app/actions";
import { NextResponse } from "next/server";

// eslint-disable-next-line import/prefer-default-export
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Session ID is required" },
      { status: 400 },
    );
  }

  const result = await getAnalysisResult(sessionId);
  // 分析が完了しているかチェック
  const isComplete = result && "analysis" in result && "advice" in result;

  return NextResponse.json({
    isComplete,
    message: result && "message" in result ? result.message : null,
    status: result && "status" in result ? result.status : null,
  });
}
