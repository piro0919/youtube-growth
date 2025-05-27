# YouTube Growth

## マイグレーションファイル作成

`npm run migrate:create -- --name hoge`

## マイグレーション

- `npm run migrate:dev`（Local Docker）
- `npm run migrate:prod`（Vercel Postgres）

## Prisma Studio 起動

- `npm run studio:dev`（Local Docker）
- `npm run studio:prod`（Vercel Postgres）

## Docker Desktop 起動

`open -a Docker`

## Docker 起動

`docker-compose up`

## ローカル開発

- `npm run dev`（Local Docker）
- `npm run dev:prod`（Vercel Postgres）

## Stripe Webhook 開発環境でテスト

1. [Stripe CLI](https://docs.stripe.com/stripe-cli) インストール
2. `stripe login`
3. `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
4. 一時的な webhook 署名シークレットが表示されるので `.env.local` に `STRIPE_WEBHOOK_SECRET` として設定
5. `stripe trigger checkout.session.completed --add checkout_session:metadata.sessionId=test_session_123`
