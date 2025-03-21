import Link from "next/link";
import styles from "./style.module.css";

export type ErrorProps = {
  errorInfo: {
    message: string;
    time: string;
  };
};

export default function Error({ errorInfo }: ErrorProps): React.JSX.Element {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>分析エラー</h1>
      <svg
        className={styles.errorIcon}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
      </svg>
      <div className={styles.errorMessage}>
        <p className={styles.errorPrimary}>{errorInfo.message}</p>
        <p className={styles.errorSecondary}>
          エラー発生時刻: {errorInfo.time}
        </p>
      </div>
      <div className={styles.actions}>
        <Link className={styles.button} href="/">
          トップページに戻る
        </Link>
      </div>
      <p className={styles.helpText}>
        問題が解決しない場合は、別のチャンネルIDまたはURLで試すか、
        しばらく時間をおいてから再度お試しください。
      </p>
    </div>
  );
}
