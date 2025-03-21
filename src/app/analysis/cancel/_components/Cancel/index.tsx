import Link from "next/link";
import styles from "./style.module.css";

export default function Cancel(): React.JSX.Element {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>決済がキャンセルされました</h1>
      <div className={styles.cancelMessage}>
        <p className={styles.messageText}>
          YouTubeチャンネル分析の決済処理がキャンセルされました。
        </p>
        <p className={styles.messageText}>
          分析を再開するには、再度トップページからお試しください。
        </p>
      </div>
      <div className={styles.actions}>
        <Link className={styles.button} href="/">
          トップページに戻る
        </Link>
      </div>
      <div className={styles.helpText}>
        <h3 className={styles.helpTitle}>よくある質問</h3>
        <dl className={styles.faqList}>
          <dt className={styles.faqQuestion}>料金はかかりましたか？</dt>
          <dd className={styles.faqAnswer}>
            いいえ、決済をキャンセルされた場合は料金は一切かかりません。
          </dd>
          <dt className={styles.faqQuestion}>
            入力したチャンネル情報は保存されていますか？
          </dt>
          <dd className={styles.faqAnswer}>
            いいえ、決済がキャンセルされると情報は保存されません。再度入力する必要があります。
          </dd>
          <dt className={styles.faqQuestion}>決済に問題がありました</dt>
          <dd className={styles.faqAnswer}>
            決済処理に問題がある場合は、別のクレジットカードを試すか、
            お問い合わせフォームからサポートにご連絡ください。
          </dd>
        </dl>
      </div>
    </div>
  );
}
