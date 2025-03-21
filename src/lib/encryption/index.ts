// lib/encryption.ts

/**
 * データの暗号化と復号化のためのユーティリティ
 * セッションデータを安全に保存するために使用
 */

// 環境変数から秘密鍵を取得（必ず環境変数に設定すること）
const SECRET_KEY = process.env.ENCRYPTION_SECRET_KEY;

if (!SECRET_KEY) {
  throw new Error("ENCRYPTION_SECRET_KEY環境変数が設定されていません");
}

/**
 * データを暗号化する
 * @param data 暗号化する文字列
 * @returns 暗号化されたデータ
 */
export function encrypt(data: string): string {
  // 実際の実装では Web Crypto API や他の暗号化ライブラリを使用
  // 以下は単純な実装例
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  // Base64エンコード (実際の実装ではより強力な暗号化を使用すること)
  const base64 = Buffer.from(dataBuffer).toString("base64");

  return base64;
}

/**
 * 暗号化されたデータを復号する
 * @param encryptedData 暗号化されたデータ
 * @returns 復号化された文字列
 */
export function decrypt(encryptedData: string): string {
  // 実際の実装では Web Crypto API や他の暗号化ライブラリを使用
  // 以下は単純な実装例
  const buffer = Buffer.from(encryptedData, "base64");
  const decoder = new TextDecoder();
  const decrypted = decoder.decode(buffer);

  return decrypted;
}

/**
 * 本番環境では、以下のようなより安全な実装を使用することを推奨
 *
 * - node-jose (https://github.com/cisco/node-jose)
 * - iron-session (https://github.com/vvo/iron-session)
 *
 * 例:
 * ```
 * import * as jose from 'node-jose';
 *
 * export async function encrypt(data: string): Promise<string> {
 *   const key = await jose.JWK.asKey({
 *     kty: 'oct',
 *     k: Buffer.from(SECRET_KEY, 'utf8').toString('base64'),
 *     alg: 'A256GCM',
 *   });
 *
 *   const encrypted = await jose.JWE.createEncrypt({ format: 'compact' }, key)
 *     .update(Buffer.from(data, 'utf8'))
 *     .final();
 *
 *   return encrypted;
 * }
 *
 * export async function decrypt(encryptedData: string): Promise<string> {
 *   const key = await jose.JWK.asKey({
 *     kty: 'oct',
 *     k: Buffer.from(SECRET_KEY, 'utf8').toString('base64'),
 *     alg: 'A256GCM',
 *   });
 *
 *   const decrypted = await jose.JWE.createDecrypt(key)
 *     .decrypt(encryptedData);
 *
 *   return decrypted.plaintext.toString('utf8');
 * }
 * ```
 */
