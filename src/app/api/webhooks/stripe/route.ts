import { handlePaymentSuccess } from "@/app/actions";
import { stripe } from "@/lib/stripe";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { type Stripe } from "stripe";

// Webhook署名の検証シークレット
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// eslint-disable-next-line import/prefer-default-export
export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.text();
  const headersList = await headers();
  const sig = headersList.get("stripe-signature");

  let event: Stripe.Event;

  try {
    // Stripe署名を検証
    if (!sig || !endpointSecret) {
      return NextResponse.json(
        { error: "Missing signature or endpoint secret" },
        { status: 400 },
      );
    }

    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    return NextResponse.json(
      { error: `Webhook Error: ${errorMessage}` },
      { status: 400 },
    );
  }

  // イベントタイプに基づいて処理
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    // 決済セッションからセッションIDを取得
    const sessionId = session.metadata?.sessionId;

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing sessionId in metadata" },
        { status: 400 },
      );
    }

    try {
      // 支払い状態を更新
      await handlePaymentSuccess(sessionId, session.id);

      return NextResponse.json({ received: true });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  }

  // その他のイベントは正常に処理
  return NextResponse.json({ received: true });
}
