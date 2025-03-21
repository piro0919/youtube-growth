/* eslint-disable security/detect-object-injection */
import { type AnalysisComplete } from "@/app/actions";
import Link from "next/link";
import DownloadPDFButton from "../DownloadPDFButton";
import styles from "./style.module.css";

// 日本語の曜日マッピング
const dayNameMap: Record<string, string> = {
  Friday: "金",
  Monday: "月",
  Saturday: "土",
  Sunday: "日",
  Thursday: "木",
  Tuesday: "火",
  Wednesday: "水",
};
// コンテンツカテゴリーの日本語マッピング
const contentCategoryMap: Record<string, string> = {
  discussion: "考察/分析",
  howto: "ハウツー/解説",
  other: "オリジナルコンテンツ",
  ranking: "ランキング/おすすめ",
  reaction: "リアクション",
  review: "レビュー/紹介",
  vlog: "Vlog/日常",
};

/**
 * テキストがリスト形式かを判定する関数
 * 箇条書きの典型的なパターンを検出
 */
function isListContent(text: string): boolean {
  // 例: "- アイテム" または "1. アイテム" "・アイテム" など
  // eslint-disable-next-line no-useless-escape
  return /^[\s]*[-•*・・＊・][\s]|^\d+[\s]*[\.\)）:][\s]/.test(text);
}

/**
 * テキストをパースしてHTMLで表示する関数
 * 箇条書きの場合はリストとして、通常のテキストの場合は段落として表示
 * ** で囲まれたテキストを強調（太字）、* で囲まれたテキストを斜体として処理
 */
function renderContent(content: string): React.JSX.Element {
  // 空のコンテンツの場合や "#" のみの場合は空の段落を返す
  if (!content || content.trim() === "" || content.trim() === "#") {
    return <p className={styles.emptyParagraph}></p>;
  }

  // Markdownの見出し記号を除去
  content = content.replace(/^#+\s*/gm, "");

  // テキストをパースして太字と斜体の書式を適用する関数
  const parseFormatting = (text: string): React.ReactNode => {
    // ** や * がなければそのまま返す
    if (!text.includes("**") && !text.includes("*")) {
      return text;
    }

    const parts: React.ReactNode[] = [];

    let currentText = "";
    let i = 0;

    while (i < text.length) {
      // ** の処理（太字）
      if (text.substring(i, i + 2) === "**") {
        // 現在のテキストを追加
        if (currentText) {
          parts.push(currentText);
          currentText = "";
        }

        // ** の後の位置
        const startPos = i + 2;
        // 次の ** の位置を探す
        const endPos = text.indexOf("**", startPos);

        if (endPos === -1) {
          // 閉じる ** がない場合は残りをテキストとして扱う
          currentText += text.substring(i);

          break;
        }

        // ** で囲まれたテキストを取得
        const boldText = text.substring(startPos, endPos);

        // <strong>タグとして追加
        parts.push(
          <strong key={`bold-${parts.length}`}>
            {parseFormatting(boldText)}
          </strong>,
        );

        // 次の位置へ
        i = endPos + 2;
        continue;
      }

      // * の処理（斜体）- ** と重複しないように条件をチェック
      if (
        text.substring(i, i + 1) === "*" &&
        text.substring(i, i + 2) !== "**"
      ) {
        // 現在のテキストを追加
        if (currentText) {
          parts.push(currentText);
          currentText = "";
        }

        // * の後の位置
        const startPos = i + 1;

        // 次の * の位置を探す（** ではない * を探す）
        let endPos = -1;

        for (let j = startPos; j < text.length; j++) {
          if (
            text[j] === "*" &&
            (j + 1 >= text.length || text[j + 1] !== "*")
          ) {
            endPos = j;

            break;
          }
        }

        if (endPos === -1) {
          // 閉じる * がない場合は残りをテキストとして扱う
          currentText += text.substring(i);

          break;
        }

        // * で囲まれたテキストを取得
        const italicText = text.substring(startPos, endPos);

        // <em>タグとして追加（再帰的に処理して入れ子の書式に対応）
        parts.push(
          <em key={`italic-${parts.length}`}>{parseFormatting(italicText)}</em>,
        );

        // 次の位置へ
        i = endPos + 1;
        continue;
      }

      currentText += text[i];
      i++;
    }

    if (currentText) {
      parts.push(currentText);
    }

    return parts;
  };

  // テキストが箇条書きの場合
  if (isListContent(content)) {
    // 行ごとに分割
    const lines = content.split("\n").filter((line) => line.trim() !== "");

    return (
      <ul className={styles.adviceList}>
        {lines.map((line, i) => {
          // 行頭の記号や番号を除去してテキストのみを抽出
          const cleanedLine = line
            // eslint-disable-next-line no-useless-escape
            .replace(/^[\s]*[-•*・・＊][\s]|^\d+[\s]*[\.\)）:][\s]/, "")
            .trim();

          return cleanedLine ? (
            <li className={styles.adviceListItem} key={i}>
              {parseFormatting(cleanedLine)}
            </li>
          ) : null;
        })}
      </ul>
    );
  }

  // 通常のテキストの場合は段落に分割して表示
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== "#");

  if (paragraphs.length > 1) {
    return (
      <div className={styles.multiParagraph}>
        {paragraphs.map((para, i) => (
          <p className={styles.adviceParagraph} key={i}>
            {parseFormatting(para)}
          </p>
        ))}
      </div>
    );
  }

  // 単一段落の場合
  return <p className={styles.adviceParagraph}>{parseFormatting(content)}</p>;
}

export type SuccessProps = {
  analysisResult: AnalysisComplete;
};

/**
 * サーバーコンポーネント - 分析結果の取得と表示
 */
export default async function Success({
  analysisResult,
}: SuccessProps): Promise<React.JSX.Element> {
  // 分析データを取得
  const { advice, analysis } = analysisResult;
  const { channel } = analysis;
  // 主要なコンテンツタイプの日本語名を取得
  const contentType =
    contentCategoryMap[analysis.categories.topFormat] ||
    analysis.categories.topFormat;
  // トレンド変化率に基づくクラス名を決定
  const getTrendClass = (): string => {
    const change = analysis.trend.change;

    if (change > 5) return styles.trendPositive;
    if (change < -5) return styles.trendNegative;

    return styles.trendNeutral;
  };
  // 日付をフォーマットする関数
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);

    return date.toLocaleDateString("ja-JP", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className={styles.container}>
      {/* 注意バナーの追加 */}
      <div className={styles.warningBanner}>
        <p className={styles.warningText}>
          <svg
            className={styles.warningIcon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
          <strong>YouTube Growth</strong>
          はα版です。このページは予告なく見られなくなる可能性があります。
        </p>
      </div>
      <div className={styles.successNotification}>
        <h1 className={styles.title}>
          <svg
            className={styles.icon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
          分析が完了しました
        </h1>
        <p className={styles.subtitle}>
          「{channel.title}」の詳細な分析結果をご確認いただけます。
        </p>
      </div>
      {/* PDFキャプチャ用にID追加 */}
      <div id="analysis-report">
        {/* チャンネル概要セクション */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>チャンネル概要</h2>
          <div className={styles.statsGrid}>
            <div className={`${styles.statCard} ${styles.statPrimary}`}>
              <h3 className={styles.statLabel}>登録者数</h3>
              <p className={styles.statValue}>
                {channel.subscriberCount.toLocaleString()} 人
              </p>
            </div>
            <div className={`${styles.statCard} ${styles.statSecondary}`}>
              <h3 className={styles.statLabel}>総視聴回数</h3>
              <p className={styles.statValue}>
                {channel.viewCount.toLocaleString()} 回
              </p>
            </div>
            <div className={`${styles.statCard} ${styles.statTertiary}`}>
              <h3 className={styles.statLabel}>動画数</h3>
              <p className={styles.statValue}>
                {channel.videoCount.toLocaleString()} 本
              </p>
            </div>
          </div>
          <div className={styles.channelMeta}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>主要コンテンツ:</span>
              <span className={styles.metaValue}>{contentType}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>分析対象動画数:</span>
              <span className={styles.metaValue}>{analysis.count} 本</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>視聴数成長率:</span>
              <span className={`${styles.metaValue} ${getTrendClass()}`}>
                {analysis.trend.change > 0 ? "+" : ""}
                {analysis.trend.change.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
        {/* 専門家のアドバイスセクション - 修正箇所 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>専門家のアドバイス</h2>
          {advice.sections.map((section, idx) => (
            <div className={styles.adviceBlock} key={idx}>
              <h3 className={styles.adviceTitle}>{section.title}</h3>
              {/* メインセクションのコンテンツ */}
              {section.content && section.content.length > 0 && (
                <div className={styles.adviceContent}>
                  {section.content.map((paragraph, contentIdx) => (
                    <div className={styles.contentWrapper} key={contentIdx}>
                      {renderContent(paragraph)}
                    </div>
                  ))}
                </div>
              )}
              {/* サブセクションのコンテンツ */}
              {section.subsections && section.subsections.length > 0 && (
                <div className={styles.adviceSubsections}>
                  {section.subsections.map((subsection, subIdx) => (
                    <div className={styles.adviceSubsection} key={subIdx}>
                      <h4 className={styles.adviceSubtitle}>
                        {renderContent(subsection.title)}
                      </h4>
                      <div className={styles.subsectionContent}>
                        {subsection.content.map((paragraph, contentIdx) => (
                          <div
                            className={styles.contentWrapper}
                            key={contentIdx}
                          >
                            {renderContent(paragraph)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* 詳細データセクション */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>分析データ詳細</h2>
          <div className={styles.dataGrid}>
            <div className={styles.dataColumn}>
              <h3 className={styles.dataTitle}>視聴データ</h3>
              <ul className={styles.dataList}>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>平均視聴回数:</span>
                  <span className={styles.dataValue}>
                    {Math.round(analysis.stats.avgViews).toLocaleString()} 回
                  </span>
                </li>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>中央値視聴回数:</span>
                  <span className={styles.dataValue}>
                    {Math.round(analysis.stats.medianViews).toLocaleString()} 回
                  </span>
                </li>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>エンゲージメント率:</span>
                  <span className={styles.dataValue}>
                    {analysis.stats.avgEngagement.toFixed(2)}%
                  </span>
                </li>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>平均コメント数:</span>
                  <span className={styles.dataValue}>
                    {Math.round(analysis.stats.avgComments).toLocaleString()}
                  </span>
                </li>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>平均いいね数:</span>
                  <span className={styles.dataValue}>
                    {Math.round(analysis.stats.avgLikes).toLocaleString()}
                  </span>
                </li>
              </ul>
            </div>
            <div className={styles.dataColumn}>
              <h3 className={styles.dataTitle}>投稿パターン</h3>
              <ul className={styles.dataList}>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>投稿頻度:</span>
                  <span className={styles.dataValue}>
                    {analysis.frequency.pattern}
                  </span>
                </li>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>投稿間隔:</span>
                  <span className={styles.dataValue}>
                    平均 {analysis.frequency.daysBetweenPosts} 日
                  </span>
                </li>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>月間投稿数:</span>
                  <span className={styles.dataValue}>
                    約 {analysis.frequency.postsPerMonth.toFixed(1)} 本
                  </span>
                </li>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>優先投稿曜日:</span>
                  <span className={styles.dataValue}>
                    {analysis.frequency.preferredDays
                      .map((day) => dayNameMap[day] || day)
                      .join("・")}
                    曜日
                  </span>
                </li>
                <li className={styles.dataItem}>
                  <span className={styles.dataLabel}>最適投稿曜日:</span>
                  <span className={styles.dataValue}>
                    {dayNameMap[analysis.posting.bestDay] ||
                      analysis.posting.bestDay}
                    曜日 （平均{" "}
                    {Math.round(
                      analysis.posting.bestDayAvgViews,
                    ).toLocaleString()}{" "}
                    回視聴）
                  </span>
                </li>
              </ul>
            </div>
          </div>
          {/* 人気動画セクション - 修正部分（YouTube リンク追加） */}
          <div className={styles.videoSection}>
            <h3 className={styles.dataTitle}>人気動画</h3>
            <div className={styles.videoListContainer}>
              <ul className={styles.videoList}>
                {analysis.top.slice(0, 5).map((video, idx) => (
                  <li className={styles.videoItem} key={idx}>
                    <div className={styles.videoRank}>{idx + 1}</div>
                    <div className={styles.videoContent}>
                      <h4 className={styles.videoTitle}>
                        <a
                          className={styles.videoLink}
                          href={`https://www.youtube.com/watch?v=${video.id}`}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {video.title}
                        </a>
                      </h4>
                      <div className={styles.videoStats}>
                        <span className={styles.videoViews}>
                          {video.views.toLocaleString()} 回視聴
                        </span>
                        <span className={styles.videoDate}>
                          {formatDate(video.published)}
                        </span>
                        {video.engagement && (
                          <span className={styles.videoEngagement}>
                            エンゲージメント率: {video.engagement.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {/* タイトル・タグ分析セクション */}
          <div className={styles.keywordSection}>
            <h3 className={styles.dataTitle}>人気キーワード分析</h3>
            <div className={styles.keywordGrid}>
              <div className={styles.keywordColumn}>
                <h4 className={styles.keywordTitle}>
                  高評価タイトルの頻出キーワード
                </h4>
                <ul className={styles.keywordList}>
                  {analysis.titles.highWords.slice(0, 8).map((word, idx) => (
                    <li className={styles.keywordItem} key={idx}>
                      <span className={styles.keywordLabel}>{word.word}</span>
                      <span className={styles.keywordCount}>
                        {word.count}回
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={styles.keywordColumn}>
                <h4 className={styles.keywordTitle}>人気タグ</h4>
                <ul className={styles.keywordList}>
                  {analysis.tags.slice(0, 8).map((tag, idx) => (
                    <li className={styles.keywordItem} key={idx}>
                      <span className={styles.keywordLabel}>{tag.tag}</span>
                      <span className={styles.keywordCount}>
                        平均 {Math.round(tag.avgViews).toLocaleString()} 回視聴
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          {/* 動画長分析 */}
          <div className={styles.durationSection}>
            <h3 className={styles.dataTitle}>動画長分析</h3>
            <p className={styles.durationSummary}>
              平均動画長:{" "}
              <span className={styles.emphasis}>
                {Math.round(analysis.duration.avgMinutes)}分
              </span>
            </p>
            <p className={styles.durationSummary}>
              最も視聴される動画の長さ:{" "}
              <span className={styles.emphasis}>
                {Math.round(
                  analysis.duration.best[0]?.minutes ||
                    analysis.duration.avgMinutes,
                )}
                分
              </span>
            </p>
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <DownloadPDFButton channelTitle={channel.title} />
        <Link className={styles.actionButton} href="/">
          トップページに戻る
        </Link>
      </div>
      {/* フッター注意文 */}
      <div className={styles.footerWarning}>
        <p>
          <strong>注意:</strong> YouTube
          Growthはα版サービスです。このレポートは予告なく利用できなくなる可能性があります。
          必要なデータはPDFでダウンロードしてください。
        </p>
      </div>
    </div>
  );
}
