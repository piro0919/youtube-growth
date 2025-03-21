/* eslint-disable security/detect-object-injection */
import { type AnalysisComplete } from "@/app/actions";
import Image from "next/image";
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
export default function Success({
  analysisResult,
}: SuccessProps): React.JSX.Element {
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
          {/* Success.tsx内の人気動画セクションを更新し、サムネイルを表示する */}
          {/* 人気動画セクション - サムネイル追加 */}
          <div className={styles.videoSection}>
            <h3 className={styles.dataTitle}>人気動画</h3>
            <div className={styles.videoListContainer}>
              <ul className={styles.videoList}>
                {analysis.top.slice(0, 5).map((video, idx) => (
                  <li className={styles.videoItem} key={idx}>
                    <div className={styles.videoRank}>{idx + 1}</div>
                    {/* サムネイル表示を追加 */}
                    <div className={styles.videoThumbnail}>
                      <Image
                        alt={`${video.title}のサムネイル`}
                        className={styles.videoThumbnailImg}
                        fill={true}
                        src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                      />
                    </div>
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
                          <span className={styles.videoStatsIcon}>👁️</span>
                          {video.views.toLocaleString()} 回視聴
                        </span>
                        <span className={styles.videoDate}>
                          <span className={styles.videoStatsIcon}>📅</span>
                          {formatDate(video.published)}
                        </span>
                        {video.engagement && (
                          <span className={styles.videoEngagement}>
                            <span className={styles.videoStatsIcon}>❤️</span>
                            {video.engagement.toFixed(2)}%
                          </span>
                        )}
                        {video.minutes && (
                          <span className={styles.videoDuration}>
                            <span className={styles.videoStatsIcon}>⏱️</span>
                            {Math.round(video.minutes)}分
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
          {/* エンゲージメント・成長相関分析セクション - Success関数内の適切な場所に追加 */}
          {analysis.engagementGrowth && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>
                エンゲージメントと成長の相関分析
              </h2>
              <div className={styles.correlationOverview}>
                <div className={styles.correlationScoreCard}>
                  <h3 className={styles.correlationTitle}>相関スコア</h3>
                  <div className={styles.correlationScoreWrapper}>
                    <div
                      className={`
              ${styles.correlationScore}
              ${
                Math.abs(analysis.engagementGrowth.correlationScore) > 0.5
                  ? analysis.engagementGrowth.correlationScore > 0
                    ? styles.strongPositive
                    : styles.strongNegative
                  : styles.weakCorrelation
              }
            `}
                    >
                      {analysis.engagementGrowth.correlationScore.toFixed(2)}
                    </div>
                    <div className={styles.correlationLabel}>
                      {Math.abs(analysis.engagementGrowth.correlationScore) >
                      0.7
                        ? "強い相関"
                        : Math.abs(analysis.engagementGrowth.correlationScore) >
                            0.3
                          ? "中程度の相関"
                          : "弱い相関"}
                    </div>
                  </div>
                </div>
                <div className={styles.insightCard}>
                  <h3 className={styles.insightTitle}>主要な洞察</h3>
                  <p className={styles.insightText}>
                    {analysis.engagementGrowth.insight}
                  </p>
                </div>
              </div>
              <div className={styles.engagementComparisonCard}>
                <h3 className={styles.comparisonTitle}>エンゲージメント効果</h3>
                <div className={styles.comparisonGrid}>
                  <div className={styles.comparisonItem}>
                    <div className={styles.comparisonLabel}>
                      高エンゲージメント動画後の成長
                    </div>
                    <div
                      className={`${styles.comparisonValue} ${styles.highValue}`}
                    >
                      {analysis.engagementGrowth.engagementComparisonData.highEngagementGrowth.toFixed(
                        1,
                      )}
                      %
                    </div>
                  </div>
                  <div className={styles.comparisonItem}>
                    <div className={styles.comparisonLabel}>
                      低エンゲージメント動画後の成長
                    </div>
                    <div
                      className={`${styles.comparisonValue} ${styles.lowValue}`}
                    >
                      {analysis.engagementGrowth.engagementComparisonData.lowEngagementGrowth.toFixed(
                        1,
                      )}
                      %
                    </div>
                  </div>
                  <div className={styles.comparisonItem}>
                    <div className={styles.comparisonLabel}>差分</div>
                    <div
                      className={`${styles.comparisonValue} ${analysis.engagementGrowth.engagementComparisonData.differencePercentage > 0 ? styles.positiveEffect : styles.negativeEffect}`}
                    >
                      {analysis.engagementGrowth.engagementComparisonData
                        .differencePercentage > 0
                        ? "+"
                        : ""}
                      {analysis.engagementGrowth.engagementComparisonData.differencePercentage.toFixed(
                        1,
                      )}
                      %
                    </div>
                  </div>
                </div>
              </div>
              {/* トレンド情報 */}
              <div className={styles.trendGrid}>
                <div className={styles.trendCard}>
                  <h3 className={styles.trendTitle}>エンゲージメント傾向</h3>
                  <div
                    className={`${styles.trendValue} ${analysis.engagementGrowth.engagementTrend.isImproving ? styles.trendPositive : styles.trendNegative}`}
                  >
                    {analysis.engagementGrowth.engagementTrend
                      .changePercentage > 0
                      ? "+"
                      : ""}
                    {analysis.engagementGrowth.engagementTrend.changePercentage.toFixed(
                      1,
                    )}
                    %
                  </div>
                  <p className={styles.trendDescription}>
                    {analysis.engagementGrowth.engagementTrend.trendDescription}
                  </p>
                </div>
                <div className={styles.trendCard}>
                  <h3 className={styles.trendTitle}>成長率傾向</h3>
                  <div
                    className={`${styles.trendValue} ${analysis.engagementGrowth.growthRateTrend.isImproving ? styles.trendPositive : styles.trendNegative}`}
                  >
                    {analysis.engagementGrowth.growthRateTrend
                      .changePercentage > 0
                      ? "+"
                      : ""}
                    {analysis.engagementGrowth.growthRateTrend.changePercentage.toFixed(
                      1,
                    )}
                    %
                  </div>
                  <p className={styles.trendDescription}>
                    {analysis.engagementGrowth.growthRateTrend.trendDescription}
                  </p>
                </div>
              </div>
              {/* 高エンゲージメント特徴と推奨事項 */}
              <div className={styles.engagementFeaturesGrid}>
                <div className={styles.featuresCard}>
                  <h3 className={styles.featuresTitle}>
                    高エンゲージメント動画の特徴
                  </h3>
                  {analysis.engagementGrowth.highEngagementFeatures &&
                  analysis.engagementGrowth.highEngagementFeatures.length >
                    0 ? (
                    <ul className={styles.featuresList}>
                      {analysis.engagementGrowth.highEngagementFeatures.map(
                        (feature, idx) => (
                          <li className={styles.featureItem} key={idx}>
                            <div className={styles.featureBullet}></div>
                            <div className={styles.featureText}>{feature}</div>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <p className={styles.noDataMessage}>
                      十分なデータがありません
                    </p>
                  )}
                </div>
                <div className={styles.featuresCard}>
                  <h3 className={styles.featuresTitle}>
                    低エンゲージメント動画の特徴
                  </h3>
                  {analysis.engagementGrowth.lowEngagementFeatures &&
                  analysis.engagementGrowth.lowEngagementFeatures.length > 0 ? (
                    <ul className={styles.featuresList}>
                      {analysis.engagementGrowth.lowEngagementFeatures.map(
                        (feature, idx) => (
                          <li className={styles.featureItem} key={idx}>
                            <div className={styles.featureBullet}></div>
                            <div className={styles.featureText}>{feature}</div>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <p className={styles.noDataMessage}>
                      十分なデータがありません
                    </p>
                  )}
                </div>
              </div>
              {/* 推奨事項 */}
              <div className={styles.recommendationsCard}>
                <h3 className={styles.recommendationsTitle}>
                  分析に基づく推奨事項
                </h3>
                {analysis.engagementGrowth.recommendationsBasedOnCorrelation &&
                analysis.engagementGrowth.recommendationsBasedOnCorrelation
                  .length > 0 ? (
                  <ul className={styles.recommendationsList}>
                    {analysis.engagementGrowth.recommendationsBasedOnCorrelation.map(
                      (recommendation, idx) => (
                        <li className={styles.recommendationItem} key={idx}>
                          {recommendation}
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p className={styles.noDataMessage}>推奨事項はありません</p>
                )}
              </div>
            </div>
          )}
          {/* 動画長の詳細分析セクション - エンゲージメント分析セクションの直後に追加 */}
          {analysis.duration.completeDurationAnalysis && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>動画長の詳細分析</h2>
              {/* ジャンル別推奨時間 */}
              {analysis.duration.genreRecommendation && (
                <div className={styles.durationRecommendationCard}>
                  <h3 className={styles.durationCardTitle}>
                    <span className={styles.durationIcon}>⏱️</span>
                    最適な動画長（ジャンル分析）
                  </h3>
                  <div className={styles.durationRecommendationContent}>
                    <div className={styles.genreInfo}>
                      <div className={styles.genreLabel}>メインジャンル:</div>
                      <div className={styles.genreValue}>
                        {analysis.duration.genreRecommendation.mainGenreName}
                      </div>
                    </div>
                    <div className={styles.recommendationBoxes}>
                      <div className={styles.recommendationBox}>
                        <div className={styles.recommendationBoxLabel}>
                          チャンネル最適時間
                        </div>
                        <div className={styles.recommendationBoxValue}>
                          {analysis.duration.genreRecommendation.recommendation}
                        </div>
                        <div className={styles.recommendationBoxSubtext}>
                          このチャンネル特有の最適な長さ
                        </div>
                      </div>
                      <div className={styles.recommendationBox}>
                        <div className={styles.recommendationBoxLabel}>
                          業界標準時間
                        </div>
                        <div className={styles.recommendationBoxValue}>
                          {
                            analysis.duration.genreRecommendation
                              .generalRange[0]
                          }
                          〜
                          {
                            analysis.duration.genreRecommendation
                              .generalRange[1]
                          }
                          分
                        </div>
                        <div className={styles.recommendationBoxSubtext}>
                          {analysis.duration.genreRecommendation.mainGenreName}
                          ジャンルの一般的な推奨時間
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* 時間帯別分析 */}
              {analysis.duration.completeDurationAnalysis.buckets && (
                <div className={styles.durationBucketsContainer}>
                  <h3 className={styles.durationCardTitle}>
                    時間帯別のパフォーマンス
                  </h3>
                  <div className={styles.durationBucketsGrid}>
                    {Object.entries(
                      analysis.duration.completeDurationAnalysis.buckets,
                    )
                      .filter(([, bucket]) => bucket.count > 0)
                      .map(([range, bucket]) => (
                        <div
                          className={`
                ${styles.durationBucketCard}
                ${
                  analysis.duration.completeDurationAnalysis!
                    .optimalForViews === range
                    ? styles.optimalBucket
                    : ""
                }
              `}
                          key={range}
                        >
                          <div className={styles.bucketHeader}>
                            <h4 className={styles.bucketTitle}>{range}</h4>
                            {analysis.duration.completeDurationAnalysis!
                              .optimalForViews === range && (
                              <div className={styles.optimalBadge}>最適</div>
                            )}
                          </div>
                          <div className={styles.bucketStats}>
                            <div className={styles.bucketStat}>
                              <span className={styles.bucketStatLabel}>
                                動画数:
                              </span>
                              <span className={styles.bucketStatValue}>
                                {bucket.count}本
                              </span>
                            </div>
                            <div className={styles.bucketStat}>
                              <span className={styles.bucketStatLabel}>
                                平均視聴:
                              </span>
                              <span className={styles.bucketStatValue}>
                                {Math.round(bucket.avgViews).toLocaleString()}回
                              </span>
                            </div>
                            <div className={styles.bucketStat}>
                              <span className={styles.bucketStatLabel}>
                                エンゲージメント:
                              </span>
                              <span className={styles.bucketStatValue}>
                                {bucket.avgEngagement.toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                  {/* 最適な時間帯の解説 */}
                  <div className={styles.durationInsightBox}>
                    <h4 className={styles.insightTitle}>分析結果</h4>
                    {analysis.duration.completeDurationAnalysis
                      .optimalForViews ? (
                      <p className={styles.insightText}>
                        <strong className={styles.highlightText}>
                          {
                            analysis.duration.completeDurationAnalysis
                              .optimalForViews
                          }
                        </strong>
                        の動画が最も高い視聴数を獲得しています
                        {analysis.duration.completeDurationAnalysis
                          .optimalForEngagement &&
                        analysis.duration.completeDurationAnalysis
                          .optimalForEngagement !==
                          analysis.duration.completeDurationAnalysis
                            .optimalForViews ? (
                          <>
                            。また、エンゲージメント率が最も高いのは
                            <strong className={styles.highlightText}>
                              {
                                analysis.duration.completeDurationAnalysis
                                  .optimalForEngagement
                              }
                            </strong>
                            の動画です
                          </>
                        ) : null}
                        。
                      </p>
                    ) : (
                      <p className={styles.insightText}>
                        動画長による明確な傾向は見られません。様々な長さで試してみることをお勧めします。
                      </p>
                    )}
                  </div>
                </div>
              )}
              {/* 成長機会の分析 */}
              {analysis.duration.growthOpportunity && (
                <div className={styles.growthOpportunityCard}>
                  <h3 className={styles.durationCardTitle}>
                    <span className={styles.growthIcon}>📈</span>
                    成長機会の分析
                  </h3>
                  <div className={styles.growthOpportunityContent}>
                    <div className={styles.growthOpportunityMessage}>
                      <p className={styles.growthText}>
                        現在は
                        <strong>
                          {analysis.duration.growthOpportunity.currentFocus}
                        </strong>
                        の動画が最も多く （
                        {analysis.duration.growthOpportunity.currentFocusCount}
                        本）投稿されていますが、
                        <strong className={styles.recommendedLength}>
                          {analysis.duration.growthOpportunity.recommendation}
                        </strong>
                        の動画の方が高いパフォーマンスを示しています。
                      </p>
                    </div>
                    <div className={styles.growthStatsGrid}>
                      <div className={styles.growthStat}>
                        <div className={styles.growthStatLabel}>視聴数の差</div>
                        <div
                          className={`${styles.growthStatValue} ${styles.positiveValue}`}
                        >
                          +
                          {analysis.duration.growthOpportunity.reasonViews.toLocaleString()}
                          回
                        </div>
                      </div>
                      <div className={styles.growthStat}>
                        <div className={styles.growthStatLabel}>
                          エンゲージメントの差
                        </div>
                        <div
                          className={`${styles.growthStatValue} ${styles.positiveValue}`}
                        >
                          +
                          {analysis.duration.growthOpportunity.reasonEngagement}
                          %
                        </div>
                      </div>
                    </div>
                    <div className={styles.growthRecommendation}>
                      <p className={styles.recommendationText}>
                        <strong className={styles.recommendationHighlight}>
                          推奨:
                        </strong>
                        {analysis.duration.growthOpportunity.recommendation}
                        の動画制作に注力すると視聴数の増加が期待できます。
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {/* 動画長分析セクションの「高パフォーマンスの動画例」にサムネイルを追加 */}
              {/* 代表的な動画例 - サムネイル付き */}
              {analysis.duration.best && analysis.duration.best.length > 0 && (
                <div className={styles.bestDurationVideosCard}>
                  <h3 className={styles.durationCardTitle}>
                    高パフォーマンスの動画例
                  </h3>
                  <ul className={styles.bestDurationVideosList}>
                    {analysis.duration.best.slice(0, 3).map((video, idx) => (
                      <li className={styles.videoItem} key={idx}>
                        {/* サムネイル表示を追加 */}
                        <div className={styles.videoThumbnail}>
                          <Image
                            alt={`${video.title}のサムネイル`}
                            className={styles.videoThumbnailImg}
                            fill={true}
                            src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                          />
                        </div>
                        <div className={styles.videoContent}>
                          <div className={styles.videoDurationBadge}>
                            <div className={styles.videoDurationBadgeLabel}>
                              {Math.round(video.minutes || 0)}分
                            </div>
                          </div>
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
                              <span className={styles.videoStatsIcon}>👁️</span>
                              {video.views.toLocaleString()}回
                            </span>
                            {video.engagement && (
                              <span className={styles.videoEngagement}>
                                <span className={styles.videoStatsIcon}>
                                  ❤️
                                </span>
                                エンゲージメント率:{" "}
                                {video.engagement.toFixed(2)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {/* コンテンツカテゴリ分析セクション - 動画長分析セクションの直後に追加 */}
          {analysis.categories.typePerformance && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>コンテンツタイプ分析</h2>
              {/* コンテンツタイプの概要 */}
              <div className={styles.contentTypeOverview}>
                <div className={styles.contentTypeChart}>
                  <h3 className={styles.contentChartTitle}>コンテンツ配分</h3>
                  <div className={styles.contentTypeGrid}>
                    {analysis.categories.typePerformance.map((type, idx) => (
                      <div
                        style={{
                          backgroundColor:
                            type.name === analysis.categories.topFormat
                              ? "rgba(66, 153, 225, 0.7)"
                              : "rgba(160, 174, 192, 0.4)",
                          width: `${Math.max(5, Math.min(100, type.percentage))}%`,
                        }}
                        className={`${styles.contentTypeBar} ${type.name === analysis.categories.topFormat ? styles.primaryContentType : ""}`}
                        key={idx}
                      >
                        <div className={styles.contentTypeLabel}>
                          {type.nameJapanese}
                        </div>
                        <div className={styles.contentTypePercent}>
                          {Math.round(type.percentage)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={styles.contentDistributionCard}>
                  <h3 className={styles.contentDistributionTitle}>
                    コンテンツ多様性
                  </h3>
                  {analysis.categories.contentDistribution && (
                    <>
                      <div className={styles.diversityScoreMeter}>
                        <div className={styles.diversityScoreLabel}>
                          多様性スコア
                        </div>
                        <div className={styles.diversityScoreValue}>
                          <div
                            className={`
                    ${styles.diversityScore}
                    ${
                      analysis.categories.contentDistribution
                        .diversificationScore > 70
                        ? styles.highDiversity
                        : analysis.categories.contentDistribution
                              .diversificationScore > 40
                          ? styles.balancedDiversity
                          : styles.lowDiversity
                    }
                  `}
                          >
                            {
                              analysis.categories.contentDistribution
                                .diversificationScore
                            }
                          </div>
                          <div className={styles.diversityMaxLabel}>/100</div>
                        </div>
                        <div className={styles.diversityStatusLabel}>
                          {analysis.categories.contentDistribution.isBalanced
                            ? "バランス良好"
                            : analysis.categories.contentDistribution
                                  .diversificationScore > 70
                              ? "過度に多様"
                              : "多様性に欠ける"}
                        </div>
                      </div>
                      <div className={styles.diversityRecommendation}>
                        <p className={styles.diversityText}>
                          {
                            analysis.categories.contentDistribution
                              .recommendation
                          }
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* コンテンツタイプ詳細比較 */}
              <div className={styles.contentTypeComparisonCard}>
                <h3 className={styles.comparisonCardTitle}>
                  コンテンツタイプのパフォーマンス比較
                </h3>
                <div className={styles.contentTypeTable}>
                  <div className={styles.contentTypeTableHeader}>
                    <div className={styles.typeColumn}>コンテンツタイプ</div>
                    <div className={styles.statsColumn}>動画数</div>
                    <div className={styles.statsColumn}>平均視聴数</div>
                    <div className={styles.statsColumn}>対チャンネル平均</div>
                    <div className={styles.statsColumn}>エンゲージメント</div>
                  </div>
                  <div className={styles.contentTypeTableBody}>
                    {analysis.categories.typePerformance.map((type, idx) => (
                      <div
                        className={`
                ${styles.contentTypeRow}
                ${type.name === analysis.categories.topFormat ? styles.primaryTypeRow : ""}
                ${type.name === analysis.categories.mostEffectiveType?.name ? styles.mostEffectiveRow : ""}
              `}
                        key={idx}
                      >
                        <div className={styles.typeColumn}>
                          <div className={styles.typeNameBadge}>
                            {type.nameJapanese}
                            {type.name ===
                              analysis.categories.mostEffectiveType?.name && (
                              <span className={styles.topPerformerBadge}>
                                最効果的
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={styles.statsColumn}>{type.count}本</div>
                        <div className={styles.statsColumn}>
                          {Math.round(type.avgViews).toLocaleString()}回
                        </div>
                        <div
                          className={`
                ${styles.statsColumn}
                ${type.relativeViewsPerformance > 100 ? styles.positivePerformance : styles.negativePerformance}
              `}
                        >
                          {type.relativeViewsPerformance > 100 ? "+" : ""}
                          {Math.round(type.relativeViewsPerformance - 100)}%
                        </div>
                        <div className={styles.statsColumn}>
                          {type.avgEngagement.toFixed(2)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* 潜在的なニッチ市場の分析 */}
              {analysis.categories.nichePotential && (
                <div className={styles.nichePotentialCard}>
                  <h3 className={styles.nichePotentialTitle}>
                    <span className={styles.nicheIcon}>💡</span>
                    潜在的なニッチ市場
                  </h3>
                  <div className={styles.nichePotentialContent}>
                    <div className={styles.nicheType}>
                      <span className={styles.nicheTypeLabel}>
                        ニッチタイプ:
                      </span>
                      <span className={styles.nicheTypeValue}>
                        {analysis.categories.nichePotential.nameJapanese}
                      </span>
                    </div>
                    <div className={styles.nicheGrowthPotential}>
                      <span className={styles.nicheGrowthLabel}>
                        成長可能性スコア:
                      </span>
                      <span className={styles.nicheGrowthValue}>
                        {analysis.categories.nichePotential.potentialGrowth} /
                        10
                      </span>
                    </div>
                    <div className={styles.nicheRecommendation}>
                      <p className={styles.nicheRecommendationText}>
                        {analysis.categories.nichePotential.recommendation}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {/* 最も効果的なコンテンツタイプの詳細 */}
              {analysis.categories.mostEffectiveType && (
                <div className={styles.bestTypeDetailCard}>
                  <h3 className={styles.bestTypeTitle}>
                    <span className={styles.trophyIcon}>🏆</span>
                    最も効果的なコンテンツタイプ:{" "}
                    {analysis.categories.mostEffectiveType.nameJapanese}
                  </h3>
                  <div className={styles.bestTypeGrid}>
                    <div className={styles.bestTypeStats}>
                      <div className={styles.bestTypeStat}>
                        <div className={styles.bestTypeStatLabel}>
                          平均視聴数
                        </div>
                        <div className={styles.bestTypeStatValue}>
                          {Math.round(
                            analysis.categories.mostEffectiveType.avgViews,
                          ).toLocaleString()}{" "}
                          回
                        </div>
                      </div>
                      <div className={styles.bestTypeStat}>
                        <div className={styles.bestTypeStatLabel}>
                          平均エンゲージメント
                        </div>
                        <div className={styles.bestTypeStatValue}>
                          {analysis.categories.mostEffectiveType.avgEngagement.toFixed(
                            2,
                          )}
                          %
                        </div>
                      </div>
                      <div className={styles.bestTypeStat}>
                        <div className={styles.bestTypeStatLabel}>
                          チャンネル平均比
                        </div>
                        <div className={styles.bestTypeStatValue}>
                          {Math.round(
                            analysis.categories.mostEffectiveType
                              .relativeViewsPerformance,
                          )}
                          %
                        </div>
                      </div>
                    </div>
                    {/* コンテンツタイプ分析の「最高パフォーマンス動画」にサムネイルを追加 */}
                    {analysis.categories.mostEffectiveType &&
                      analysis.categories.mostEffectiveType.topPerformer && (
                        <div className={styles.bestTypeTopVideo}>
                          <div className={styles.topVideoHeader}>
                            最高パフォーマンス動画
                          </div>
                          {/* サムネイル表示を追加 */}
                          <div className={styles.topVideoThumbnail}>
                            <Image
                              alt={`${analysis.categories.mostEffectiveType.topPerformer.title}のサムネイル`}
                              className={styles.topVideoThumbnailImg}
                              fill={true}
                              src={`https://i.ytimg.com/vi/${analysis.categories.mostEffectiveType.topPerformer.id}/mqdefault.jpg`}
                            />
                          </div>
                          <a
                            className={styles.topVideoLink}
                            href={`https://www.youtube.com/watch?v=${analysis.categories.mostEffectiveType.topPerformer.id}`}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {
                              analysis.categories.mostEffectiveType.topPerformer
                                .title
                            }
                          </a>
                          <div className={styles.topVideoViews}>
                            <span className={styles.videoStatsIcon}>👁️</span>
                            {analysis.categories.mostEffectiveType.topPerformer.views.toLocaleString()}{" "}
                            回視聴
                          </div>
                        </div>
                      )}
                  </div>
                  {/* 成功要因 */}
                  {analysis.categories.mostEffectiveType.successFactors && (
                    <div className={styles.successFactorsCard}>
                      <h4 className={styles.successFactorsTitle}>成功要因</h4>
                      <div className={styles.successFactorsGrid}>
                        {analysis.categories.mostEffectiveType.successFactors
                          .commonPhrases &&
                          analysis.categories.mostEffectiveType.successFactors
                            .commonPhrases.length > 0 && (
                            <div className={styles.successFactorsList}>
                              <div className={styles.successFactorsLabel}>
                                よく使われるフレーズ:
                              </div>
                              <div className={styles.tagList}>
                                {analysis.categories.mostEffectiveType.successFactors.commonPhrases
                                  .slice(0, 5)
                                  .map((phrase, i) => (
                                    <span className={styles.tagPill} key={i}>
                                      {phrase}
                                    </span>
                                  ))}
                              </div>
                            </div>
                          )}
                        {analysis.categories.mostEffectiveType.successFactors
                          .tagSuggestions &&
                          analysis.categories.mostEffectiveType.successFactors
                            .tagSuggestions.length > 0 && (
                            <div className={styles.successFactorsList}>
                              <div className={styles.successFactorsLabel}>
                                効果的なタグ:
                              </div>
                              <div className={styles.tagList}>
                                {analysis.categories.mostEffectiveType.successFactors.tagSuggestions
                                  .slice(0, 5)
                                  .map((tag, i) => (
                                    <span className={styles.tagPill} key={i}>
                                      {tag}
                                    </span>
                                  ))}
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* タイトルパターン最適化セクション - コンテンツカテゴリ分析セクションの直後に追加 */}
          {analysis.titles.patterns && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>タイトル最適化分析</h2>
              {/* タイトルパターン分析 */}
              <div className={styles.titlePatternsCard}>
                <h3 className={styles.titleCardHeading}>
                  <span className={styles.titleIcon}>📊</span>
                  効果的なタイトルパターン
                </h3>
                <div className={styles.patternsGrid}>
                  <div className={styles.patternMetricsCard}>
                    <h4 className={styles.patternMetricsTitle}>
                      人気動画のタイトル特徴
                    </h4>
                    <div className={styles.patternsList}>
                      <div className={styles.patternItem}>
                        <div className={styles.patternLabel}>最適な長さ</div>
                        <div className={styles.patternValue}>
                          {analysis.titles.patterns.typicalLength}文字
                        </div>
                        <div
                          style={{
                            width: `${Math.min(100, analysis.titles.patterns.typicalLength)}%`,
                          }}
                          className={styles.patternBar}
                        ></div>
                      </div>
                      <div className={styles.patternItem}>
                        <div className={styles.patternLabel}>疑問形の使用</div>
                        <div className={styles.patternValue}>
                          {analysis.titles.patterns.questionUsage}%
                        </div>
                        <div
                          style={{
                            width: `${analysis.titles.patterns.questionUsage}%`,
                          }}
                          className={styles.patternBar}
                        ></div>
                      </div>
                      <div className={styles.patternItem}>
                        <div className={styles.patternLabel}>括弧の使用</div>
                        <div className={styles.patternValue}>
                          {analysis.titles.patterns.bracketUsage}%
                        </div>
                        <div
                          style={{
                            width: `${analysis.titles.patterns.bracketUsage}%`,
                          }}
                          className={styles.patternBar}
                        ></div>
                      </div>
                      <div className={styles.patternItem}>
                        <div className={styles.patternLabel}>コロンの使用</div>
                        <div className={styles.patternValue}>
                          {analysis.titles.patterns.colonUsage}%
                        </div>
                        <div
                          style={{
                            width: `${analysis.titles.patterns.colonUsage}%`,
                          }}
                          className={styles.patternBar}
                        ></div>
                      </div>
                      <div className={styles.patternItem}>
                        <div className={styles.patternLabel}>数字で始まる</div>
                        <div className={styles.patternValue}>
                          {analysis.titles.patterns.numberInBeginning}%
                        </div>
                        <div
                          style={{
                            width: `${analysis.titles.patterns.numberInBeginning}%`,
                          }}
                          className={styles.patternBar}
                        ></div>
                      </div>
                      <div className={styles.patternItem}>
                        <div className={styles.patternLabel}>絵文字の使用</div>
                        <div className={styles.patternValue}>
                          {analysis.titles.patterns.emojiUsage}%
                        </div>
                        <div
                          style={{
                            width: `${analysis.titles.patterns.emojiUsage}%`,
                          }}
                          className={styles.patternBar}
                        ></div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.patternInsightsCard}>
                    <h4 className={styles.patternInsightsTitle}>
                      このチャンネルに効果的なパターン
                    </h4>
                    <div className={styles.patternInsightsList}>
                      {analysis.titles.patterns.bracketUsage > 40 && (
                        <div className={styles.patternInsight}>
                          <div className={styles.insightIcon}>✓</div>
                          <div className={styles.insightText}>
                            <strong>括弧の活用:</strong> 人気動画の
                            {analysis.titles.patterns.bracketUsage}
                            %が括弧を使用しており、重要なキーワードを強調するのに効果的です。
                          </div>
                        </div>
                      )}
                      {analysis.titles.patterns.questionUsage > 30 && (
                        <div className={styles.patternInsight}>
                          <div className={styles.insightIcon}>✓</div>
                          <div className={styles.insightText}>
                            <strong>疑問形の活用:</strong>{" "}
                            疑問形のタイトルは視聴者の好奇心を刺激し、クリック率を高めています。
                          </div>
                        </div>
                      )}
                      {analysis.titles.patterns.numberInBeginning > 30 && (
                        <div className={styles.patternInsight}>
                          <div className={styles.insightIcon}>✓</div>
                          <div className={styles.insightText}>
                            <strong>数字の活用:</strong>{" "}
                            数字で始まるタイトル（例：「5つの方法」）は具体性を示し、視聴者の注目を集めています。
                          </div>
                        </div>
                      )}
                      {analysis.titles.patterns.colonUsage > 30 && (
                        <div className={styles.patternInsight}>
                          <div className={styles.insightIcon}>✓</div>
                          <div className={styles.insightText}>
                            <strong>コロンの活用:</strong>{" "}
                            コロン（:）を使ったタイトルは主題と詳細を明確に区分し、視認性を高めています。
                          </div>
                        </div>
                      )}
                      {analysis.titles.patterns.emojiUsage > 20 && (
                        <div className={styles.patternInsight}>
                          <div className={styles.insightIcon}>✓</div>
                          <div className={styles.insightText}>
                            <strong>絵文字の活用:</strong>{" "}
                            絵文字は視覚的アクセントとなり、検索結果での目立ちやすさを向上させています。
                          </div>
                        </div>
                      )}
                      <div className={styles.patternInsight}>
                        <div className={styles.insightIcon}>✓</div>
                        <div className={styles.insightText}>
                          <strong>最適な長さ:</strong> 約
                          {analysis.titles.patterns.typicalLength}
                          文字のタイトルが最も効果的です。短すぎず長すぎない長さを目指しましょう。
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* キーワード効果分析 */}
              <div className={styles.keywordsEffectCard}>
                <h3 className={styles.titleCardHeading}>
                  <span className={styles.titleIcon}>🔍</span>
                  高パフォーマンスキーワード
                </h3>
                <div className={styles.keywordsComparison}>
                  <div className={styles.keywordsSection}>
                    <h4 className={styles.keywordsSectionTitle}>
                      高評価タイトルの頻出ワード
                    </h4>
                    <div className={styles.keywordsCloud}>
                      {analysis.titles.highWords
                        .slice(0, 10)
                        .map((word, idx) => (
                          <div
                            style={{
                              fontSize: `${Math.max(1, Math.min(2, 1 + word.count / 10))}em`,
                              opacity: 0.6 + word.count / 20,
                            }}
                            className={styles.keywordBubble}
                            key={idx}
                          >
                            {word.word}
                            <span className={styles.keywordCount}>
                              +{word.count}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                  <div className={styles.keywordsSection}>
                    <h4 className={styles.keywordsSectionTitle}>
                      低評価タイトルの頻出ワード
                    </h4>
                    <div className={styles.keywordsCloud}>
                      {analysis.titles.lowWords.slice(0, 8).map((word, idx) => (
                        <div
                          style={{
                            fontSize: `${Math.max(1, Math.min(1.8, 1 + word.count / 12))}em`,
                            opacity: 0.6 + word.count / 20,
                          }}
                          className={styles.keywordBubbleNegative}
                          key={idx}
                        >
                          {word.word}
                          <span className={styles.keywordCountNegative}>
                            -{word.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className={styles.keywordsTips}>
                  <div className={styles.keywordTip}>
                    <div className={styles.tipIcon}>💡</div>
                    <div className={styles.tipText}>
                      高評価タイトルのキーワードは人気動画でよく使われている単語です。これらをタイトルに組み込むと視聴数が向上する可能性があります。
                    </div>
                  </div>
                  <div className={styles.keywordTip}>
                    <div className={styles.tipIcon}>⚠️</div>
                    <div className={styles.tipText}>
                      低評価タイトルのキーワードは視聴数の少ない動画に頻出する単語です。これらの使用は控えるか、より効果的な文脈で使用することを検討してください。
                    </div>
                  </div>
                </div>
              </div>
              {/* タイトル提案 */}
              {analysis.titles.titleSuggestions &&
                analysis.titles.titleSuggestions.length > 0 && (
                  <div className={styles.titleSuggestionsCard}>
                    <h3 className={styles.titleCardHeading}>
                      <span className={styles.titleIcon}>✍️</span>
                      タイトル構成の提案
                    </h3>
                    <div className={styles.suggestionsList}>
                      {analysis.titles.titleSuggestions.map(
                        (suggestion, idx) => (
                          <div className={styles.suggestionItem} key={idx}>
                            <div className={styles.suggestionHeader}>
                              <div className={styles.suggestionPattern}>
                                {suggestion.pattern}
                              </div>
                              <div className={styles.suggestionDescription}>
                                {suggestion.description}
                              </div>
                            </div>
                            <div className={styles.suggestionExample}>
                              <div className={styles.exampleLabel}>例:</div>
                              <div className={styles.exampleText}>
                                {suggestion.example}
                              </div>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                    <div className={styles.titleCompositionTips}>
                      <div className={styles.compositionTip}>
                        <h4 className={styles.tipTitle}>
                          効果的なタイトル構成のポイント
                        </h4>
                        <ul className={styles.tipsList}>
                          <li className={styles.tipItem}>
                            最も重要なキーワードを先頭か冒頭近くに配置する
                          </li>
                          <li className={styles.tipItem}>
                            具体的な数字を含めると視認性とクリック率が向上する（「いくつか」より「5つの」が効果的）
                          </li>
                          <li className={styles.tipItem}>
                            視聴者にとっての明確なメリットや価値を表現する
                          </li>
                          <li className={styles.tipItem}>
                            センセーショナルすぎる表現は避け、内容に忠実なタイトルを心がける
                          </li>
                          <li className={styles.tipItem}>
                            検索されやすいキーワードと視聴者の感情を刺激する言葉のバランスを取る
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              {/* サムネイル推奨事項 */}
              {analysis.titles.thumbnailFeatures &&
                analysis.titles.thumbnailFeatures.recommendations && (
                  <div className={styles.thumbnailRecommendationsCard}>
                    <h3 className={styles.titleCardHeading}>
                      <span className={styles.titleIcon}>🖼️</span>
                      サムネイル最適化の推奨事項
                    </h3>
                    <div className={styles.recommendationsList}>
                      {analysis.titles.thumbnailFeatures.recommendations.map(
                        (recommendation, idx) => (
                          <div className={styles.recommendationItem} key={idx}>
                            <div className={styles.recommendationIcon}>
                              {idx === 0
                                ? "👁️"
                                : idx === 1
                                  ? "📝"
                                  : idx === 2
                                    ? "🎨"
                                    : "📊"}
                            </div>
                            <div className={styles.recommendationText}>
                              {recommendation}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
            </div>
          )}
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
