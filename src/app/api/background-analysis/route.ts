// app/api/background-analysis/route.ts
export const runtime = "nodejs";
import { processAnalysisAfterPayment } from "@/lib/server/analysis";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing sessionId", success: false },
        { status: 400 },
      );
    }

    await processAnalysisAfterPayment(sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API実行エラー:", error);

    return NextResponse.json(
      { error: String(error), success: false },
      { status: 500 },
    );
  }
}
