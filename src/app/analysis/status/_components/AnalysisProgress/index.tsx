"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./style.module.css";

type AnalysisProgressProps = {
  message: string;
  sessionId: string;
};

export default function AnalysisProgress({
  message,
  sessionId,
}: AnalysisProgressProps): React.JSX.Element {
  const router = useRouter();
  const [progressMessage, setProgressMessage] = useState(message);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const isCheckingRef = useRef(false); // refを使って現在のチェック状態を追跡
  // useCallbackを使用してcheckStatus関数をメモ化
  const checkStatus = useCallback(async () => {
    // refを使ってチェック中かどうかを判断
    if (isCheckingRef.current) return;

    // UIと内部状態の両方を更新
    setIsCheckingStatus(true);
    isCheckingRef.current = true;

    try {
      const response = await fetch(
        `/api/analysis/status?session_id=${sessionId}`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch status");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await response.json()) as any;

      if (data.isComplete) {
        router.push(`/analysis/success?session_id=${sessionId}`);
      } else if (data.message) {
        setProgressMessage(data.message);
      }
    } catch (error) {
      console.error("Error checking status:", error);
    } finally {
      // UIと内部状態の両方を更新
      setIsCheckingStatus(false);
      isCheckingRef.current = false;
    }
  }, [router, sessionId]); // 依存配列から isCheckingStatus を削除

  useEffect(() => {
    // 初回チェック
    checkStatus();

    // 定期的なチェック (10秒ごと)
    const interval = setInterval(() => {
      checkStatus();
    }, 10000);
    // 経過時間の表示用タイマー (1秒ごと)
    const timer = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return (): void => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [checkStatus]);

  // 経過時間のフォーマット
  const formatElapsedTime = (): string => {
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = elapsedTime % 60;

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className={styles.container}>
      <div className={styles.progressNotification}>
        <h1 className={styles.title}>
          <svg
            className={styles.icon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
          分析実行中
        </h1>
        <p className={styles.subtitle}>{progressMessage}</p>
        <div className={styles.loaderContainer}>
          {/* ローディングアニメーションを常に表示 */}
          <div className={`${styles.loader} ${styles.loading}`}></div>
          {isCheckingStatus && (
            <div className={styles.statusIndicator}>
              <span className={styles.statusDot}></span> 更新中...
            </div>
          )}
        </div>
        <div className={styles.progressInfo}>
          <p className={styles.progressText}>
            この処理には数分かかる場合があります。完了すると自動的に結果ページに移動します。
          </p>
          <p className={styles.timeElapsed}>経過時間: {formatElapsedTime()}</p>
        </div>
      </div>
      <div className={styles.progressDetail}>
        <h2 className={styles.detailTitle}>分析プロセスについて</h2>
        <div className={styles.processSteps}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepContent}>
              <h3 className={styles.stepTitle}>データ収集</h3>
              <p className={styles.stepDescription}>
                YouTubeのAPIを使用してチャンネルと動画のデータを収集しています。
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepContent}>
              <h3 className={styles.stepTitle}>データ分析</h3>
              <p className={styles.stepDescription}>
                収集したデータを統計的に分析し、パターンや傾向を抽出しています。
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepContent}>
              <h3 className={styles.stepTitle}>AIアドバイス生成</h3>
              <p className={styles.stepDescription}>
                分析データに基づき、AIがチャンネル成長のための具体的なアドバイスを生成しています。
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <button
          className={`${styles.refreshButton} ${isCheckingStatus ? styles.retrying : ""}`}
          disabled={isCheckingStatus}
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={checkStatus}
        >
          {isCheckingStatus ? "更新中..." : "手動で更新する"}
        </button>
        <Link className={styles.actionButton} href="/">
          トップページに戻る
        </Link>
      </div>
    </div>
  );
}
