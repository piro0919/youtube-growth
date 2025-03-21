import { PrismaClient } from "@prisma/client";

// PrismaClientのグローバルインスタンスを作成
// https://www.prisma.io/docs/guides/performance-and-optimization/connection-management#prismaclient-in-long-running-applications

// globalThisにPrismaClientの型定義を拡張
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// 開発環境では単一のPrismaClientインスタンスを再利用
export const prisma =
  globalThis.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

// 開発環境（Hot Reloadがある環境）では globalThis にクライアントを保存
if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

export default prisma;
