/* eslint-disable security/detect-object-injection */
"use server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { channelId as getYoutubeIdByUrl } from "@gonetone/get-youtube-id-by-url";
import { google, type youtube_v3 } from "googleapis";
import { redirect } from "next/navigation";
import OpenAI from "openai";
import { cache } from "react";

// 型定義
type ChannelInfo = {
  description: string;
  subscriberCount: number;
  title: string;
  uploadsPlaylistId: string;
  videoCount: number;
  viewCount: number;
};

type VideoInfo = {
  comments: number;
  duration: string;
  engagement?: number;
  id: string;
  likes: number;
  minutes?: number;
  published: string;
  tags: string[];
  title: string;
  views: number;
};

type TagInfo = {
  avgViews: number;
  count: number;
  tag: string;
};

type WordInfo = {
  count: number;
  word: string;
};

type DayStats = {
  avgEngagement?: number;
  avgViews?: number;
  count: number;
  engagement: number;
  views: number;
};

type PostingAnalysis = {
  bestDay: string;
  bestDayAvgViews: number;
  days: Record<string, DayStats>;
};

type TrendAnalysis = {
  change: number;
  newAvg: number;
  oldAvg: number;
};

type AdviceSection = {
  content: string[];
  subsections?: {
    content: string[];
    title: string;
  }[];
  title: string;
};

type StructuredAdvice = {
  sections: AdviceSection[];
};

// 分析データのステータスを表す型
type AnalysisStatus =
  | "ANALYZING"
  | "AWAITING_PAYMENT"
  | "COMPLETED"
  | "ERROR"
  | "FAILED"
  | "PAID_AWAITING_ANALYSIS"
  | "REFUND_FAILED"
  | "REFUNDED";

// 基本的なチャンネル情報の型
type ChannelBasicInfo = {
  id: string;
  title: string;
};

type AnalysisOptions = {
  modelType: string;
  videoCount: number;
};

// 進行中または失敗した分析のデータ型
export type AnalysisProgressData = {
  channelBasicInfo: ChannelBasicInfo;
  error?: string;
  message?: string;
  options?: AnalysisOptions; // オプション追加
  refundError?: string;
  refundId?: string;
  refundTimestamp?: string;
  status: Exclude<AnalysisStatus, "COMPLETED">;
  timestamp?: string;
};

// 状態付きの分析結果型
type AnalysisStatusResponse = {
  error?: string;
  message: string;
  status: AnalysisStatus;
};

// 分析データの統合型
type AnalysisDataWithStatus = AnalysisComplete | AnalysisProgressData;

// 分析結果の型定義
export type AnalysisComplete = {
  advice: StructuredAdvice;
  analysis: AnalysisResult;
};

// 設定オプション
const CONFIG = {
  stopWords: [
    "の",
    "に",
    "は",
    "を",
    "た",
    "が",
    "で",
    "て",
    "と",
    "し",
    "れ",
    "さ",
    "ある",
    "いる",
    "も",
    "する",
    "から",
    "な",
    "こと",
  ],
  topResultsCount: 5,
  videosToFetch: 30,
};
// 簡易統計関数
const stats = {
  mean: (arr: number[]): number =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
  median: (arr: number[]): number => {
    if (!arr.length) return 0;

    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  },
  stdDev: (arr: number[]): number => {
    const avg = stats.mean(arr);

    return Math.sqrt(stats.mean(arr.map((x) => (x - avg) ** 2)));
  },
};
// 日本語フォーマット名のマッピング
const formatJapanese: Record<string, string> = {
  discussion: "考察/分析",
  howto: "ハウツー/解説",
  other: "オリジナルコンテンツ",
  ranking: "ランキング/おすすめ",
  reaction: "リアクション",
  review: "レビュー/紹介",
  vlog: "Vlog/日常",
};

// 外部から呼び出されるメインのエントリーポイント
export async function analyzeAndPay(
  formData:
    | FormData
    | { channelInput: string; modelType?: string; videoCount?: number },
): Promise<void> {
  const channelInput =
    formData instanceof FormData
      ? (formData.get("channelInput") as string)
      : formData.channelInput;
  // 新しいオプションを取得
  const modelType =
    formData instanceof FormData
      ? (formData.get("modelType") as string) || "gpt-4-turbo"
      : formData.modelType || "gpt-4-turbo";
  // 動画数オプションの取得（25, 50, 100のいずれか）
  const videoCount =
    formData instanceof FormData
      ? Number(formData.get("videoCount")) || 25
      : formData.videoCount || 25;

  if (!channelInput) {
    throw new Error("チャンネル情報が入力されていません");
  }

  const sessionId = generateSessionId();

  let session;

  try {
    // チャンネルIDかURLかを判断
    let channelId = channelInput;

    const isUrl = /https?:\/\//.test(channelInput);

    if (isUrl) {
      try {
        const extractedId = await getYoutubeIdByUrl(channelInput);

        if (extractedId) {
          channelId = extractedId;
        } else {
          throw new Error("URLからチャンネルIDを抽出できませんでした");
        }
      } catch {
        throw new Error("不正なYouTubeチャンネルURLです");
      }
    }

    // チャンネルの基本情報を取得
    const youtube = getYouTubeClient();
    const { data } = await youtube.channels.list({
      id: [channelId],
      part: ["snippet"],
    });
    const channelBasicInfo = data.items?.[0];

    if (!channelBasicInfo) {
      throw new Error("チャンネルが見つかりませんでした");
    }

    const channelTitle = channelBasicInfo.snippet?.title || "不明なチャンネル";
    // 選択されたオプションに基づいて価格を計算
    const price = calculatePrice(modelType, videoCount);
    const planName = getPlanName(videoCount);
    // オプション情報を含む初期データ
    const initialData: AnalysisProgressData = {
      channelBasicInfo: {
        id: channelId,
        title: channelTitle,
      },
      options: {
        modelType,
        videoCount,
      },
      status: "AWAITING_PAYMENT",
    };

    // DBに未分析状態で保存
    await prisma.analysis.create({
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysisData: initialData as any,
        channelId: channelId,
        channelInput,
        channelTitle,
        id: sessionId,
        isPaid: false,
        // 以下の2行を追加
        modelType: modelType,
        videoCount: videoCount,
      },
    });

    // モデル名を日本語化
    const modelNameJp =
      modelType === "gpt-4-turbo" ? "GPT-4 Turbo" : "GPT-3.5 Turbo";

    // Stripe決済セッションを作成
    session = await stripe.checkout.sessions.create({
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/analysis/cancel`,
      line_items: [
        {
          price_data: {
            currency: "jpy",
            product_data: {
              description: `「${channelTitle}」の${planName}（${videoCount}本、${modelNameJp}）`,
              name: "YouTube Growth",
            },
            unit_amount: price, // 計算した価格
          },
          quantity: 1,
        },
      ],
      metadata: {
        channelInput,
        modelType,
        sessionId,
        videoCount: String(videoCount),
      },
      mode: "payment",
      payment_method_types: ["card"],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/analysis/status?session_id=${sessionId}`,
    });

    if (!session.url) {
      throw new Error("決済セッションの作成に失敗しました");
    }
  } catch (error) {
    console.error("処理中にエラーが発生しました:", error);

    // エラー情報をDBに保存
    try {
      const errorData: AnalysisProgressData = {
        channelBasicInfo: {
          id: "error",
          title: "エラー発生",
        },
        error: error instanceof Error ? error.message : String(error),
        status: "ERROR",
        timestamp: new Date().toISOString(),
      };

      await prisma.analysis.create({
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          analysisData: errorData as any,
          channelId: "error",
          channelInput,
          channelTitle: "エラー発生",
          id: sessionId,
          isPaid: false,
        },
      });
    } catch (dbError) {
      console.error("エラー情報の保存に失敗しました:", dbError);
    }

    redirect("/analysis/error");
  }

  redirect(session.url);
}

// 分析結果を取得するサーバーアクション - 成功ページで使用
export async function getAnalysisResult(
  sessionId: string,
): Promise<AnalysisComplete | AnalysisStatusResponse | null> {
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id: sessionId },
    });

    if (!analysis) {
      return null;
    }

    const data = analysis.analysisData as unknown as AnalysisDataWithStatus;

    // 完了したデータの場合は分析結果をそのまま返す
    if ("analysis" in data && "advice" in data) {
      return data as AnalysisComplete;
    }

    // それ以外の場合はステータスに基づいた情報を返す
    const progressData = data as AnalysisProgressData;

    switch (progressData.status) {
      case "AWAITING_PAYMENT":
        return {
          message: "お支払いをお待ちしています",
          status: "AWAITING_PAYMENT",
        };
      case "PAID_AWAITING_ANALYSIS":
      case "ANALYZING":
        return {
          message: "分析を実行中です。しばらくお待ちください",
          status: "ANALYZING",
        };
      case "FAILED":
        return {
          error: progressData.error,
          message: "分析に失敗しました。サポートにお問い合わせください",
          status: "FAILED",
        };
      case "REFUNDED":
        return {
          message:
            "分析に失敗したため、返金処理を行いました。ご不便をおかけして申し訳ありません",
          status: "REFUNDED",
        };
      case "REFUND_FAILED":
        return {
          message:
            "分析に失敗し、返金処理も失敗しました。サポートにお問い合わせください",
          status: "REFUND_FAILED",
        };
      default:
        return {
          message: "不明なエラーが発生しました",
          status: "ERROR",
        };
    }
  } catch (error) {
    console.error("分析結果の取得中にエラーが発生しました:", error);

    return null;
  }
}

// 決済成功後に呼び出されるWebhookハンドラー
export async function handlePaymentSuccess(
  sessionId: string,
  stripeSessionId: string,
): Promise<void> {
  try {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    const paymentAmount = session.amount_total || 0;
    const record = await prisma.analysis.findUnique({
      where: { id: sessionId },
    });

    if (!record) {
      throw new Error("分析レコードが見つかりません");
    }

    const currentData = record.analysisData as unknown as AnalysisProgressData;
    const updatedData: AnalysisProgressData = {
      ...currentData,
      status: "PAID_AWAITING_ANALYSIS",
    };
    const updatedAnalysis = await prisma.analysis.update({
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysisData: updatedData as any,
        isPaid: true,
        modelType: currentData.options?.modelType || "gpt-4-turbo",
        paymentAmount,
        stripeSessionId,
        videoCount: currentData.options?.videoCount || 25,
      },
      where: { id: sessionId },
    });

    if (!updatedAnalysis) {
      throw new Error("分析結果の更新に失敗しました");
    }

    // 非同期で分析プロセスを開始
    await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/background-analysis`, {
      body: JSON.stringify({ sessionId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then(async (res) => res.json())
      .then((data) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // eslint-disable-next-line promise/always-return
        if (!data.success) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          console.error("非同期分析処理失敗:", data.error);
        } else {
          console.log("✅ 分析処理をバックグラウンドで開始しました");
        }
      })
      .catch((e) => {
        console.error("fetch通信エラー:", e);
      });
  } catch (error) {
    console.error("決済完了処理中にエラーが発生しました:", error);
    throw new Error("決済後の処理に失敗しました");
  }
}

// 分析失敗時の返金処理
export async function refundFailedAnalysis(sessionId: string): Promise<void> {
  try {
    const record = await prisma.analysis.findUnique({
      where: { id: sessionId },
    });

    if (!record || !record.stripeSessionId) {
      throw new Error("返金対象の決済情報が見つかりません");
    }

    const currentData = record.analysisData as unknown as AnalysisProgressData;
    // セッションから支払い情報を取得
    const session = await stripe.checkout.sessions.retrieve(
      record.stripeSessionId,
    );

    if (session.payment_intent) {
      // 返金処理を実行
      const refund = await stripe.refunds.create({
        payment_intent: session.payment_intent as string,
        reason: "requested_by_customer",
      });
      // 返金情報を記録
      const refundData: AnalysisProgressData = {
        ...currentData,
        refundId: refund.id,
        refundTimestamp: new Date().toISOString(),
        status: "REFUNDED",
      };

      await prisma.analysis.update({
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          analysisData: refundData as any,
        },
        where: { id: sessionId },
      });
    }
  } catch (error) {
    console.error("返金処理中にエラーが発生しました:", error);

    const record = await prisma.analysis.findUnique({
      where: { id: sessionId },
    });

    if (!record) {
      return;
    }

    const currentData = record.analysisData as unknown as AnalysisProgressData;
    // 返金エラー情報を保存
    const errorData: AnalysisProgressData = {
      ...currentData,
      refundError: error instanceof Error ? error.message : String(error),
      status: "REFUND_FAILED",
    };

    await prisma.analysis.update({
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysisData: errorData as any,
      },
      where: { id: sessionId },
    });
  }
}

/**
 * セキュアなセッションIDを生成するヘルパー関数
 */
function generateSessionId(): string {
  const randomBytes = new Uint8Array(16);

  crypto.getRandomValues(randomBytes);

  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// YouTube APIクライアントを初期化する関数
function getYouTubeClient(): youtube_v3.Youtube {
  return google.youtube({
    auth: process.env.YOUTUBE_API_KEY,
    version: "v3",
  });
}

// OpenAIクライアントを初期化する関数
function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * メインの分析処理サーバーアクション
 */
export async function analyzeChannel(
  channelInput: string,
  options: AnalysisOptions = { modelType: "gpt-4-turbo", videoCount: 25 },
): Promise<AnalysisComplete> {
  try {
    // チャンネルIDかURLかを判断
    let channelId = channelInput;

    // URLパターンの判定
    const isUrl = /https?:\/\//.test(channelInput);

    if (isUrl) {
      // URLからチャンネルIDを抽出
      try {
        const extractedId = await getYoutubeIdByUrl(channelInput);

        if (extractedId) {
          channelId = extractedId;
        } else {
          throw new Error("URLからチャンネルIDを抽出できませんでした");
        }
      } catch {
        throw new Error("不正なYouTubeチャンネルURLです");
      }
    }

    // チャンネル情報取得
    const channel = await fetchChannelDetails(channelId);
    // 動画データ取得（指定された動画数）
    const videos = await fetchVideos(
      channel.uploadsPlaylistId,
      options.videoCount,
    );
    // データ分析
    const analysis = analyzeData(videos, channel);
    // AIアドバイス生成（指定されたモデルを使用）
    const advice = await generateAdvice(analysis, options.modelType);

    return { advice, analysis };
  } catch (error) {
    console.error("分析中にエラーが発生しました:", error);
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

// チャンネル情報取得 (Reactのcacheを使用)
const fetchChannelDetails = cache(
  async (channelId: string): Promise<ChannelInfo> => {
    const youtube = getYouTubeClient();
    const { data } = await youtube.channels.list({
      id: [channelId],
      part: ["snippet", "statistics", "contentDetails"],
    });
    const channel = data.items?.[0];

    if (!channel) throw new Error("チャンネルが見つかりませんでした");

    return {
      description: channel.snippet?.description || "",
      subscriberCount: Number(channel.statistics?.subscriberCount || 0),
      title: channel.snippet?.title || "",
      uploadsPlaylistId:
        channel.contentDetails?.relatedPlaylists?.uploads || "",
      videoCount: Number(channel.statistics?.videoCount || 0),
      viewCount: Number(channel.statistics?.viewCount || 0),
    };
  },
);
// 動画リスト取得 (Reactのcacheを使用)
const fetchVideos = cache(
  async (playlistId: string, count: number = 25): Promise<VideoInfo[]> => {
    if (!playlistId) throw new Error("プレイリストIDが不正です");

    const youtube = getYouTubeClient();

    let videoIds: string[] = [];
    let nextPageToken: string | undefined = undefined;

    // 指定された数の動画IDを収集するまでページングを続ける
    do {
      const playlistResponse: youtube_v3.Schema$PlaylistItemListResponse = (
        await youtube.playlistItems.list({
          maxResults: Math.min(50, count - videoIds.length), // 残りの必要数か50のうち小さい方
          pageToken: nextPageToken,
          part: ["contentDetails"],
          playlistId,
        })
      ).data;
      const newIds =
        playlistResponse.items
          ?.map((item) => item.contentDetails?.videoId)
          .filter((id): id is string => typeof id === "string") || [];

      videoIds = [...videoIds, ...newIds];
      nextPageToken = playlistResponse.nextPageToken ?? undefined;

      // 十分な数の動画IDを収集したか、もう次のページがない場合はループを終了
    } while (nextPageToken && videoIds.length < count);

    // 指定された数に制限
    videoIds = videoIds.slice(0, count);

    if (!videoIds.length) return [];

    // 動画IDが多すぎる場合は、複数のリクエストに分割する必要がある
    // YouTube APIは一度に最大50個のIDを指定できる
    const videoDetailsPromises: Promise<youtube_v3.Schema$VideoListResponse>[] =
      [];

    for (let i = 0; i < videoIds.length; i += 50) {
      const idsBatch = videoIds.slice(i, i + 50);

      videoDetailsPromises.push(
        youtube.videos
          .list({
            id: idsBatch,
            part: ["snippet", "statistics", "contentDetails"],
          })
          .then((response) => response.data),
      );
    }

    // すべてのリクエストが完了するのを待つ
    const videoResponses = await Promise.all(videoDetailsPromises);
    // すべてのレスポンスから動画詳細を抽出して結合
    const videos = videoResponses.flatMap(
      (response) =>
        response.items?.map((video) => ({
          comments: Number(video.statistics?.commentCount || 0),
          duration: video.contentDetails?.duration || "",
          id: video.id || "",
          likes: Number(video.statistics?.likeCount || 0),
          published: video.snippet?.publishedAt || "",
          tags: video.snippet?.tags || [],
          title: video.snippet?.title || "",
          views: Number(video.statistics?.viewCount || 0),
        })) || [],
    );

    return videos;
  },
);

// AIアドバイス生成
// AIアドバイス生成
async function generateAdvice(
  analysis: AnalysisResult,
  modelType: string = "gpt-4-turbo",
): Promise<StructuredAdvice> {
  try {
    const openai = getOpenAIClient();
    // データを整形
    const keywords =
      analysis.titles.highWords.length > 0
        ? analysis.titles.highWords
            .slice(0, 5)
            .map((w) => `"${w.word}" (${w.count}回)`)
            .join(", ")
        : "特徴的なキーワードが見つかりませんでした";
    const topTags = analysis.tags
      .slice(0, 5)
      .map((t) => `"${t.tag}" (${Math.round(t.avgViews).toLocaleString()}回)`)
      .join(", ");
    const topVids = analysis.top
      .slice(0, 3)
      .map((v, i) => {
        const mins = v.minutes ? Math.round(v.minutes) : "?";

        return `${i + 1}. "${v.title}" - ${v.views.toLocaleString()}回、${mins}分`;
      })
      .join("\n");
    // 最適な動画長を算出
    const topDurations = analysis.duration.best
      .slice(0, 3)
      .map((v) => (v.minutes ? Math.round(v.minutes) : 0))
      .filter((m) => m > 0);
    const optimalDuration =
      topDurations.length > 0
        ? Math.round(stats.mean(topDurations))
        : Math.round(analysis.duration.avgMinutes);
    // 投稿パターンの抽出
    const postPattern = analysis.frequency.pattern;
    const postDays = analysis.frequency.preferredDays.join("・");
    // プロンプト内のキーワード部分も修正
    const highWordsForPrompt =
      analysis.titles.highWords.length > 0
        ? analysis.titles.highWords
            .slice(0, 3)
            .map((w) => w.word)
            .join("、")
        : "チャンネル特有のキーワード";

    // タイトルパターンを検出
    function findPatterns(videos: VideoInfo[]): string {
      const patterns: Record<string, number> = {
        brackets: 0, // 括弧を含むタイトル
        colon: 0, // コロンを含むタイトル
        emoji: 0, // 絵文字を含むタイトル
        number: 0, // 数字で始まるタイトル
        question: 0, // 疑問形のタイトル
      };

      videos.forEach((v) => {
        if (/^\d+/.test(v.title)) patterns.number++;
        if (/\?/.test(v.title)) patterns.question++;
        // eslint-disable-next-line no-useless-escape
        if (/[\[\(\{\【].*[\]\)\}\】]/.test(v.title)) patterns.brackets++;
        if (/[:：]/.test(v.title)) patterns.colon++;
        // eslint-disable-next-line security/detect-unsafe-regex
        if (/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}]/u.test(v.title))
          patterns.emoji++;
      });

      return Object.entries(patterns)
        .filter(([, count]) => count > Math.max(1, videos.length * 0.2)) // 20%以上で使われているパターンのみ
        .map(([key]) => {
          const names: Record<string, string> = {
            brackets: "括弧を含む",
            colon: "コロンを含む",
            emoji: "絵文字を含む",
            number: "数字で始まる",
            question: "疑問形",
          };

          return names[key];
        })
        .join(", ");
    }

    const patterns = findPatterns(analysis.top);
    const bestDay = analysis.posting.bestDay;
    const bestViews = Math.round(analysis.posting.bestDayAvgViews);
    // コンテンツフォーマットの情報
    const contentFormat = analysis.categories.topFormat;
    const formatName = formatJapanese[contentFormat] || contentFormat;
    // 視聴者との関係性を分析
    const averageCommentLikeRatio =
      analysis.stats.avgComments / analysis.stats.avgLikes;

    let audienceEngagement = "低";

    if (averageCommentLikeRatio > 0.1) audienceEngagement = "高";
    else if (averageCommentLikeRatio > 0.05) audienceEngagement = "中";

    // 動画内容をよりよく理解するために説明文からキーワードを抽出
    const channelKeywords = analysis.channel.description
      .split(/[\s,.!?;:'"()]/)
      .filter(
        (word) => !!word && word.length > 2 && !CONFIG.stopWords.includes(word),
      )
      .slice(0, 8)
      .join(", ");
    // プロンプトを作成
    const prompt = `
# 「${analysis.channel.title}」チャンネル分析

## チャンネル基本情報
- 登録者数: ${analysis.channel.subscriberCount.toLocaleString()}人
- 平均視聴回数: ${Math.round(analysis.stats.avgViews).toLocaleString()}回
- 平均エンゲージメント率: ${analysis.stats.avgEngagement.toFixed(2)}%
- 主要コンテンツタイプ: ${formatName}
- チャンネルのテーマ: ${channelKeywords}

## 投稿パターン
- 現在の投稿頻度: ${postPattern}（${analysis.frequency.daysBetweenPosts}日間隔）
- 優先投稿曜日: ${postDays}曜日
- 一貫性: ${analysis.frequency.isConsistent ? "一定のスケジュールあり" : "不定期"}
- 最適投稿曜日（視聴数）: ${bestDay}（平均${bestViews.toLocaleString()}回）

## 人気動画:
${topVids}

## 人気コンテンツ要素:
- タイトルパターン: ${patterns || "特定のパターンなし"}
- 人気キーワード: ${keywords}
- 効果的なタグ: ${topTags}
- 最適な動画時間: 約${optimalDuration}分
- トレンド変化率: ${analysis.trend.change.toFixed(1)}%
- 視聴者関与度: ${audienceEngagement}（コメント/いいね比率）

## 重要な考慮事項
- 現在の投稿頻度（${postPattern}）に合わせたアドバイスが必要
- 現在の主要コンテンツタイプ（${formatName}）を尊重すること
- 具体的な成功例から学べる要素を抽出すること
- 汎用的ではなく、このチャンネル特有の戦略を提案すること

上記のデータに基づいて、YouTube戦略の専門家として、以下3点について『具体的かつ実行可能な』アドバイスを提供してください：

1. コンテンツ戦略：
   - 成功している動画から導き出せる具体的なコンテンツアイデア（3つ程度）
   - 「一般的なコンテンツ」ではなく「${analysis.channel.title}」特有のアイデアが必要
   - 各アイデアの具体的なタイトル例と構成
   - 既存の視聴者の反応が良い要素を取り入れる方法

2. タイトル・タグの最適化：
    - このチャンネルに効果的なタイトル構成パターン（分析データに基づく）
    - 実際に使える具体的なタイトル例（少なくとも3つ）
    - 『${highWordsForPrompt}』などのキーワードを活用した例
    - 効果的なタグ選定戦略と具体的なタグリスト例

3. 視聴者獲得とエンゲージメント向上策：
   - 現在の投稿パターン（${postPattern}）に基づいた実現可能なスケジュール提案
   - ${formatName}コンテンツに特化したエンゲージメント向上テクニック
   - コメント率を高めるための具体的な呼びかけ例やスクリプト例
   - チャンネル登録を促す効果的なタイミングと声かけの例

各セクションは以下の要件を満たすこと：
- 汎用的なアドバイス（「定期的に投稿しましょう」など）は避け、データに基づく具体的なアクションアイテムを提供
- 実際の例文や具体的な方法を含める
- 「なぜ」それが効果的なのかを分析データと関連付けて説明
- チャンネルの現状に即した実現可能なアドバイスであること

禁止事項：
- 「質の高いコンテンツを作る」などの抽象的なアドバイス
- 「一貫性を保つ」などの一般論
- 実行方法が明確でないアドバイス

フォーマットは「## セクション名」で明確に区切り、箇条書きとパラグラフを効果的に使用して読みやすくしてください。`;
    // OpenAI APIリクエスト
    const response = await openai.chat.completions.create({
      max_tokens: 1500,
      messages: [
        {
          content:
            "あなたはYouTubeチャンネル成長の専門コンサルタントです。提供されたデータを詳細に分析し、チャンネル固有の具体的で実行可能なアドバイスを提供してください。",
          role: "system",
        },
        { content: prompt, role: "user" },
      ],
      model: modelType, // 動的にモデルを切り替え
      temperature: 0.5,
    });
    const content = response.choices[0].message.content || "";
    // AIの応答を構造化データに変換
    const structuredAdvice: StructuredAdvice = { sections: [] };
    // セクションごとに分割（見出しの ## で区切る）
    const sections = content.split(/^##\s+/m).filter((s) => !!s.trim());

    for (const section of sections) {
      // 最初の行がタイトル、残りがコンテンツ
      const lines = section.split("\n");
      const sectionTitle = lines[0].trim();
      // タイトル行を除いたものがコンテンツの元データ
      const rawContent = lines.slice(1).join("\n").trim();
      // サブセクションを検出
      const subsections = [];
      const subsectionParts = rawContent
        .split(/^###\s+/m)
        .filter((s) => !!s.trim());

      // メインコンテンツは、サブセクションがある場合は最初のブロック
      // サブセクションがない場合は全体
      let mainContent: string[] = [];

      if (subsectionParts.length > 0) {
        // サブセクションが存在する場合
        if (rawContent.startsWith("###")) {
          // 最初から ### で始まる場合、メインコンテンツはなし
          mainContent = [];
        } else {
          // ### の前にテキストがある場合、それがメインコンテンツ
          const mainContentEnd = rawContent.indexOf("###");

          if (mainContentEnd > 0) {
            mainContent = [rawContent.substring(0, mainContentEnd).trim()];
          }
        }

        // サブセクションの処理
        for (const subSection of subsectionParts) {
          if (!subSection.trim()) continue;

          const subLines = subSection.split("\n");
          const subTitle = subLines[0].trim();
          const subContent = subLines.slice(1).join("\n").trim();

          if (subTitle && subContent) {
            subsections.push({
              content: [subContent],
              title: subTitle,
            });
          }
        }
      } else {
        // サブセクションがない場合、全体がメインコンテンツ
        mainContent = [rawContent];
      }

      // メインコンテンツから空行や "#" だけの行を除外
      mainContent = mainContent
        .filter((c) => !!c.trim() && c.trim() !== "#")
        .map((c) => c.replace(/^#\s*/, "").trim());

      // セクションを追加
      structuredAdvice.sections.push({
        content: mainContent,
        subsections: subsections.length > 0 ? subsections : undefined,
        title: sectionTitle,
      });
    }

    // 構造化データが作成できなかった場合はフォールバック
    if (structuredAdvice.sections.length === 0) {
      return createStructuredFallbackAdvice(analysis);
    }

    return structuredAdvice;
  } catch (err) {
    // エラー時はフォールバック
    console.error("AIアドバイス生成エラー:", err);

    return createStructuredFallbackAdvice(analysis);
  }
}

// フォールバックのアドバイス生成関数
function createStructuredFallbackAdvice(
  analysis: AnalysisResult,
): StructuredAdvice {
  return {
    sections: [
      {
        content: [
          `分析データによると、「${analysis.channel.title}」チャンネルでは${
            formatJapanese[analysis.categories?.topFormat] ||
            analysis.categories?.topFormat ||
            "オリジナルコンテンツ"
          }コンテンツが特に好評で、関連するコンテンツが高い視聴数を獲得しています。`,
        ],
        subsections: [
          {
            content: [
              "現在の人気動画の続編や派生コンテンツを作成してください。",
              "シリーズ化により既存視聴者の継続視聴が期待できます。",
            ],
            title: "シリーズコンテンツの展開",
          },
          {
            content: [
              "よくある失敗パターンと解決法を紹介するコンテンツを作成してください。",
              "実際のコメント欄から抽出した質問や悩みに答える形式で、視聴者の関与度を高めます。",
            ],
            title: "視聴者の悩み解決型コンテンツ",
          },
        ],
        title: "コンテンツ戦略の最適化",
      },
      {
        content: [
          "分析データから、効果的なタイトル作成とタグ設定の具体的な戦略を提案します。",
        ],
        subsections: [
          {
            content: [
              "成功しているタイトルパターンを分析し、同様の構造を使用してください。",
              "人気キーワードをタイトルの先頭または重要な位置に配置してください。",
            ],
            title: "タイトル構成の最適化",
          },
        ],
        title: "タイトル・タグの最適化方法",
      },
      {
        content: ["視聴者獲得とエンゲージメント向上のための戦略を提案します。"],
        subsections: [
          {
            content: [
              `現在の投稿パターン（${analysis.frequency.pattern || "不定期"}）を維持しながら、最も視聴回数の多い曜日である${analysis.posting.bestDay || "最適な曜日"}に投稿するようにスケジュールを調整してください。`,
              "コメント欄での積極的な返信を行い、視聴者コミュニティを構築してください。",
            ],
            title: "最適な投稿スケジュール",
          },
          {
            content: [
              "動画内で明確な質問を投げかけ、視聴者に意見やフィードバックを求めてください。",
              "動画の最も効果的な部分（視聴者維持率の高いセクション）で、チャンネル登録を促す呼びかけを行ってください。",
            ],
            title: "エンゲージメント向上テクニック",
          },
        ],
        title: "視聴者獲得とエンゲージメント向上策",
      },
    ],
  };
}

// タグの分析
function analyzeVideoTags(videos: VideoInfo[]): TagInfo[] {
  const tagUse: Record<string, number> = {};
  const tagViews: Record<string, number> = {};

  videos.forEach((video) => {
    video.tags.forEach((tag) => {
      tagUse[tag] = (tagUse[tag] || 0) + 1;
      tagViews[tag] = (tagViews[tag] || 0) + video.views;
    });
  });

  return Object.keys(tagUse)
    .map((tag) => ({
      avgViews: tagViews[tag] / tagUse[tag],
      count: tagUse[tag],
      tag,
    }))
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.avgViews - a.avgViews);
}

// 投稿パターン分析
function analyzePostingPatterns(videos: VideoInfo[]): PostingAnalysis {
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const days: Record<string, DayStats> = Object.fromEntries(
    dayNames.map((d) => [d, { count: 0, engagement: 0, views: 0 }]),
  );

  videos.forEach((v) => {
    const date = new Date(v.published);
    const day = dayNames[date.getDay()];

    days[day].count++;
    days[day].views += v.views;
    days[day].engagement += (v.likes / v.views) * 100;
  });

  // 平均を計算
  Object.entries(days).forEach(([, day]) => {
    if (day.count) {
      day.avgViews = day.views / day.count;
      day.avgEngagement = day.engagement / day.count;
    }
  });

  // 最適な曜日を見つける
  const sortedDays = Object.entries(days).sort(
    (a, b) => (b[1].avgViews || 0) - (a[1].avgViews || 0),
  );
  const bestDay = sortedDays.length > 0 ? sortedDays[0][0] : "";
  const bestDayAvgViews =
    sortedDays.length > 0 ? sortedDays[0][1].avgViews || 0 : 0;

  return {
    bestDay,
    bestDayAvgViews,
    days,
  };
}

// トレンド分析
function analyzeTimeTrends(videos: VideoInfo[]): TrendAnalysis {
  if (videos.length < 10) return { change: 0, newAvg: 0, oldAvg: 0 };

  // 日付順にソート
  const byDate = [...videos].sort(
    (a, b) => new Date(a.published).getTime() - new Date(b.published).getTime(),
  );
  // 古い10件と新しい10件を比較
  const oldVideos = byDate.slice(0, 10);
  const newVideos = byDate.slice(-10);
  const oldAvg = stats.mean(oldVideos.map((v) => v.views));
  const newAvg = stats.mean(newVideos.map((v) => v.views));

  // 変化率
  return {
    change: oldAvg ? ((newAvg - oldAvg) / oldAvg) * 100 : 0,
    newAvg,
    oldAvg,
  };
}

// 価格計算ヘルパー関数
function calculatePrice(modelType: string, videoCount: number): number {
  if (modelType === "gpt-4-turbo") {
    // GPT-4 Turboの価格体系
    if (videoCount <= 25) return 600;
    if (videoCount <= 50) return 800;

    return 1200; // 100本
  } else {
    // GPT-3.5 Turboの価格体系
    if (videoCount <= 25) return 400;
    if (videoCount <= 50) return 600;

    return 900; // 100本
  }
}

// 動画数に基づくプラン名の取得
function getPlanName(videoCount: number): string {
  if (videoCount <= 25) return "最新トレンド分析";
  if (videoCount <= 50) return "標準分析";

  return "総合分析";
}

// タイトルの分析と最適化提案の実装
function analyzeVideoTitles(
  videos: VideoInfo[],
  top: VideoInfo[],
  bottom: VideoInfo[],
): TitleAnalysis {
  // タイトル長の平均
  const avgLength = stats.mean(videos.map((v) => v.title.length));

  // 単語の出現頻度分析
  function wordCounter(titles: string[]): WordInfo[] {
    const words: Record<string, number> = {};

    titles.forEach((title) => {
      // 単語分割の正規表現を改善
      // より多くのセパレータを追加
      title
        // eslint-disable-next-line no-useless-escape
        .split(/[\s,.!?;:'"()\/\-_&\+\[\]{}【】「」『』、。]/u)
        .filter(
          (word) =>
            !!word &&
            word.length > 1 &&
            !CONFIG.stopWords.includes(word) &&
            // 数字のみの単語は除外
            !/^\d+$/.test(word),
        )
        .forEach((word) => {
          words[word] = (words[word] || 0) + 1;
        });
    });

    // 頻度1の単語も含めるが、単語が多すぎる場合は上位のみ
    const result = Object.entries(words)
      .map(([word, count]) => ({ count, word }))
      .sort((a, b) => b.count - a.count);

    // 単語がない場合のフォールバック
    if (result.length === 0 && titles.length > 0) {
      // 簡易的に単語を抽出（より緩い条件）
      const fallbackWords: Record<string, number> = {};

      titles.forEach((title) => {
        // 2文字以上の文字列を全て抽出
        for (let i = 0; i < title.length - 1; i++) {
          const segment = title.slice(i, i + 2);

          if (segment.trim() && !/^\d+$/.test(segment)) {
            fallbackWords[segment] = (fallbackWords[segment] || 0) + 1;
          }
        }
      });

      return Object.entries(fallbackWords)
        .map(([word, count]) => ({ count, word }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    return result;
  }

  // 高評価動画のタイトルから単語を抽出
  const highWords = wordCounter(top.map((v) => v.title));
  // タイトルパターンの分析
  const patterns = analyzePatterns(top);
  // サムネイル関連の特徴を分析
  const thumbnailFeatures = analyzeThumbnailFeatures(top);
  // タイトル最適化の提案を生成
  const titleSuggestions = generateTitleSuggestions(top, highWords, patterns);

  // フォールバック: 高評価単語が見つからない場合は全動画から抽出
  if (highWords.length === 0 && videos.length > 0) {
    const allWords = wordCounter(videos.map((v) => v.title));

    return {
      avgLength,
      highWords: allWords.slice(0, 10),
      lowWords: wordCounter(bottom.map((v) => v.title)).slice(0, 10),
      patterns,
      thumbnailFeatures,
      titleSuggestions,
    };
  }

  return {
    avgLength,
    highWords: highWords.slice(0, 10),
    lowWords: wordCounter(bottom.map((v) => v.title)).slice(0, 10),
    patterns,
    thumbnailFeatures,
    titleSuggestions,
  };
}

// タイトルのパターン分析
function analyzePatterns(topVideos: VideoInfo[]): TitlePatterns {
  const patterns = {
    bracketUsage: 0, // 括弧の使用率
    colonUsage: 0, // コロンの使用率
    emojiUsage: 0, // 絵文字の使用率
    numberInBeginning: 0, // 数字で始まる率
    questionUsage: 0, // 疑問形の使用率
    typicalLength: 0, // 平均文字数
  };

  if (!topVideos.length) return patterns;

  topVideos.forEach((video) => {
    // 数字で始まるか
    if (/^\d+/.test(video.title)) patterns.numberInBeginning++;

    // 疑問形か
    if (/[?？]/.test(video.title)) patterns.questionUsage++;

    // 括弧を使用しているか
    // eslint-disable-next-line no-useless-escape
    if (/[\[\(\{\【].*[\]\)\}\】]/.test(video.title)) patterns.bracketUsage++;

    // コロンを使用しているか
    if (/[:：]/.test(video.title)) patterns.colonUsage++;

    // 絵文字を使用しているか
    // eslint-disable-next-line security/detect-unsafe-regex
    if (/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}]/u.test(video.title)) {
      patterns.emojiUsage++;
    }
  });

  // 平均長さを計算
  patterns.typicalLength = Math.round(
    stats.mean(topVideos.map((v) => v.title.length)),
  );

  // パーセンテージに変換
  const videoCount = topVideos.length;

  return {
    bracketUsage: Math.round((patterns.bracketUsage / videoCount) * 100),
    colonUsage: Math.round((patterns.colonUsage / videoCount) * 100),
    emojiUsage: Math.round((patterns.emojiUsage / videoCount) * 100),
    numberInBeginning: Math.round(
      (patterns.numberInBeginning / videoCount) * 100,
    ),
    questionUsage: Math.round((patterns.questionUsage / videoCount) * 100),
    typicalLength: patterns.typicalLength,
  };
}

// サムネイル特徴の分析（この関数は実際には画像分析は行わない）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function analyzeThumbnailFeatures(_: VideoInfo[]): ThumbnailFeatures {
  // ここではサムネイルの画像自体は分析できないため、
  // タイトルと視聴回数の相関からサムネイルの推奨事項を提案

  return {
    recommendations: [
      "人気動画のサムネイルには顔のアップが含まれている可能性が高い",
      "テキストを含めるなら、3-4単語程度に抑えると効果的",
      "鮮やかな色と強いコントラストを使用すると注目を集めやすい",
      "サムネイルとタイトルで整合性を保つことが重要",
    ],
  };
}

// タイトル提案の生成
function generateTitleSuggestions(
  topVideos: VideoInfo[],
  highWords: WordInfo[],
  patterns: TitlePatterns,
): TitleSuggestion[] {
  if (!topVideos.length || !highWords.length) {
    return [];
  }

  // 人気上位キーワードを取得
  const topKeywords = highWords.slice(0, 5).map((w) => w.word);

  // 基本的なパターンを決定
  let patternTemplate = "";

  if (patterns.questionUsage > 40) {
    patternTemplate = "疑問形";
  } else if (patterns.bracketUsage > 40) {
    patternTemplate = "括弧付き";
  } else if (patterns.colonUsage > 40) {
    patternTemplate = "コロン区切り";
  } else {
    patternTemplate = "シンプル";
  }

  // 各動画カテゴリに応じた提案を生成
  const suggestions: TitleSuggestion[] = [
    {
      description: "最も効果的なキーワードを使った疑問形の提案",
      example: `${topKeywords[0] || "トピック"}について知っていますか？知らないと${topKeywords[1] || "損"}する${topKeywords[2] || "情報"}`,
      pattern: "疑問形",
    },
    {
      description: "数字付きのリスト形式の提案",
      example: `【${Math.floor(Math.random() * 5) + 3}選】今すぐ試したい${topKeywords[0] || "方法"}｜初心者でも${topKeywords[1] || "簡単"}`,
      pattern: "数字+括弧",
    },
    {
      description: "コロン形式の提案",
      example: `${topKeywords[0] || "テーマ"}：誰も教えてくれない${topKeywords[1] || "秘訣"}と${topKeywords[2] || "コツ"}`,
      pattern: "コロン区切り",
    },
  ];

  // チャンネルの特性に基づく、もっとも推奨される形式を追加
  suggestions.push({
    description: "チャンネルの特性に最適化された提案",
    example:
      patterns.emojiUsage > 30
        ? `✨${topKeywords[0] || "トピック"}の${topKeywords[1] || "ポイント"} 🔥 ${patterns.typicalLength < 30 ? "" : "詳しく解説します"}`
        : `【${topKeywords[0] || "重要"}】${topKeywords[1] || "テーマ"}の${topKeywords[2] || "ポイント"}と正しい${topKeywords[3] || "方法"}`,
    pattern: patternTemplate,
  });

  return suggestions;
}

// 型定義の拡張
type TitlePatterns = {
  bracketUsage: number; // 括弧の使用率(%)
  colonUsage: number; // コロンの使用率(%)
  emojiUsage: number; // 絵文字の使用率(%)
  numberInBeginning: number; // 数字で始まる率(%)
  questionUsage: number; // 疑問形の使用率(%)
  typicalLength: number; // 平均文字数
};

type ThumbnailFeatures = {
  recommendations: string[]; // サムネイルに関する推奨事項
};

type TitleSuggestion = {
  description: string; // 提案の説明
  example: string; // 提案例
  pattern: string; // 使用パターン
};

// TitleAnalysis型の拡張
type TitleAnalysis = {
  avgLength: number;
  highWords: WordInfo[];
  lowWords: WordInfo[];
  patterns?: TitlePatterns; // 追加: タイトルパターン分析
  thumbnailFeatures?: ThumbnailFeatures; // 追加: サムネイル推奨事項
  titleSuggestions?: TitleSuggestion[]; // 追加: タイトル提案
};

// 動画長分析の拡張実装
function analyzeDurations(videos: VideoInfo[]): DurationAnalysis {
  // ISO 8601形式から分に変換
  function toMinutes(iso: string): number {
    const h = iso.match(/(\d+)H/)?.[1] || 0;
    const m = iso.match(/(\d+)M/)?.[1] || 0;
    const s = iso.match(/(\d+)S/)?.[1] || 0;

    return Number(h) * 60 + Number(m) + Number(s) / 60;
  }

  const withDuration = videos.map((v) => ({
    ...v,
    minutes: toMinutes(v.duration),
  }));
  // 長さ別の視聴率
  const byViews = [...withDuration].sort((a, b) => b.views - a.views);
  // 動画時間別に視聴データを集計するためのバケットを作成
  const timeBuckets: Record<string, DurationBucket> = {
    "0-3分": {
      avgEngagement: 0,
      avgViews: 0,
      count: 0,
      totalEngagement: 0,
      totalViews: 0,
      videos: [],
    },
    "3-5分": {
      avgEngagement: 0,
      avgViews: 0,
      count: 0,
      totalEngagement: 0,
      totalViews: 0,
      videos: [],
    },
    "5-10分": {
      avgEngagement: 0,
      avgViews: 0,
      count: 0,
      totalEngagement: 0,
      totalViews: 0,
      videos: [],
    },
    "10-15分": {
      avgEngagement: 0,
      avgViews: 0,
      count: 0,
      totalEngagement: 0,
      totalViews: 0,
      videos: [],
    },
    "15-20分": {
      avgEngagement: 0,
      avgViews: 0,
      count: 0,
      totalEngagement: 0,
      totalViews: 0,
      videos: [],
    },
    "20分以上": {
      avgEngagement: 0,
      avgViews: 0,
      count: 0,
      totalEngagement: 0,
      totalViews: 0,
      videos: [],
    },
  };

  // 各動画を適切な時間バケットに分類
  withDuration.forEach((video) => {
    const minutes = video.minutes || 0;
    const engagement = (video.likes / Math.max(1, video.views)) * 100;

    let bucket: string;

    if (minutes <= 3) bucket = "0-3分";
    else if (minutes <= 5) bucket = "3-5分";
    else if (minutes <= 10) bucket = "5-10分";
    else if (minutes <= 15) bucket = "10-15分";
    else if (minutes <= 20) bucket = "15-20分";
    else bucket = "20分以上";

    timeBuckets[bucket].count++;
    timeBuckets[bucket].totalViews += video.views;
    timeBuckets[bucket].totalEngagement += engagement;

    // 各バケットに最大5つまで動画を保存（視聴数順）
    if (timeBuckets[bucket].videos.length < 5) {
      timeBuckets[bucket].videos.push({
        engagement: engagement,
        id: video.id,
        minutes: minutes,
        title: video.title,
        views: video.views,
      });
    } else {
      // 既存の動画の中で最も視聴数が少ないものを見つけて置き換えるかどうか判断
      const minViewsIndex = timeBuckets[bucket].videos.reduce(
        (minIndex, curr, currIndex, arr) =>
          curr.views < arr[minIndex].views ? currIndex : minIndex,
        0,
      );

      if (video.views > timeBuckets[bucket].videos[minViewsIndex].views) {
        timeBuckets[bucket].videos[minViewsIndex] = {
          engagement: engagement,
          id: video.id,
          minutes: minutes,
          title: video.title,
          views: video.views,
        };
      }
    }
  });

  // 各バケットの平均値を計算
  Object.values(timeBuckets).forEach((bucket) => {
    if (bucket.count > 0) {
      bucket.avgViews = bucket.totalViews / bucket.count;
      bucket.avgEngagement = bucket.totalEngagement / bucket.count;
      // 視聴数で動画をソート
      bucket.videos.sort((a, b) => b.views - a.views);
    }
  });

  // 最適な動画時間を特定（視聴数とエンゲージメントの両方を考慮）
  const bucketEntries = Object.entries(timeBuckets).filter(
    ([, bucket]) => bucket.count >= 2,
  ); // 少なくとも2つ以上のデータがあるバケットのみ
  // 視聴数で最適なバケットを特定
  const optimalViewsBucket =
    bucketEntries.length > 0
      ? bucketEntries.reduce(
          (max, curr) => (curr[1].avgViews > max[1].avgViews ? curr : max),
          bucketEntries[0],
        )
      : null;
  // エンゲージメントで最適なバケットを特定
  const optimalEngagementBucket =
    bucketEntries.length > 0
      ? bucketEntries.reduce(
          (max, curr) =>
            curr[1].avgEngagement > max[1].avgEngagement ? curr : max,
          bucketEntries[0],
        )
      : null;
  // 完全な分析結果
  const completeDurationAnalysis: CompleteDurationAnalysis = {
    buckets: timeBuckets,
    optimalForEngagement: optimalEngagementBucket
      ? optimalEngagementBucket[0]
      : null,
    optimalForViews: optimalViewsBucket ? optimalViewsBucket[0] : null,
  };
  // 成長する可能性のある動画長
  const growthOpportunity = identifyGrowthOpportunity(timeBuckets);
  // ジャンルに対する最適な長さの推奨事項
  const genreRecommendation = recommendDurationByGenre(withDuration);

  return {
    avgMinutes: stats.mean(
      withDuration.map((v) => v.minutes || 0).filter(Boolean),
    ),
    best: byViews.slice(0, 5),
    completeDurationAnalysis,
    genreRecommendation,
    growthOpportunity,
  };
}

// ジャンルに対する最適な動画長を推奨
function recommendDurationByGenre(
  videos: Array<VideoInfo & { minutes?: number }>,
): GenreDurationRecommendation {
  // ジャンル別の推奨時間（一般的な推奨値）
  const genreRecommendations = {
    discussion: [8, 15], // 考察/分析
    howto: [5, 12], // ハウツー/解説
    other: [6, 15], // オリジナルコンテンツ
    ranking: [7, 12], // ランキング/おすすめ
    reaction: [8, 15], // リアクション
    review: [6, 10], // レビュー/紹介
    vlog: [10, 20], // Vlog/日常
  } as const;

  type Genre = keyof typeof genreRecommendations;

  // タイトルからジャンルを推定
  function estimateGenre(video: VideoInfo & { minutes?: number }): Genre {
    const title = video.title.toLowerCase();
    const tags = video.tags.join(" ").toLowerCase();
    const content = title + " " + tags;

    if (
      /考察|解説|分析|まとめ|議論|理由|なぜ|違い|どっち|どちら|analysis|theory|explained|why/i.test(
        content,
      )
    ) {
      return "discussion";
    }

    if (
      /方法|やり方|仕方|手順|解説|講座|ガイド|チュートリアル|入門|初心者|基本|使い方|how\s*to|tutorial|guide|tips/i.test(
        content,
      )
    ) {
      return "howto";
    }

    if (
      /ランキング|人気|おすすめ|ベスト|トップ|選び方|ranking|top\s*\d+|best/i.test(
        content,
      )
    ) {
      return "ranking";
    }

    if (
      /リアクション|反応|見てみた|聞いてみた|初見|reaction|reacting/i.test(
        content,
      )
    ) {
      return "reaction";
    }

    if (
      /レビュー|感想|使ってみた|試してみた|紹介|インプレ|購入品|開封|比較|review|unboxing|versus/i.test(
        content,
      )
    ) {
      return "review";
    }

    if (
      /日常|休日|旅行|旅|観光|vlog|ルーティン|生活|暮らし|一日|daily|routine|day/i.test(
        content,
      )
    ) {
      return "vlog";
    }

    return "other";
  }

  // 各ジャンルの動画数とその平均視聴数を集計
  const genreStats = {
    discussion: { avgMinutes: 0, avgViews: 0, count: 0 },
    howto: { avgMinutes: 0, avgViews: 0, count: 0 },
    other: { avgMinutes: 0, avgViews: 0, count: 0 },
    ranking: { avgMinutes: 0, avgViews: 0, count: 0 },
    reaction: { avgMinutes: 0, avgViews: 0, count: 0 },
    review: { avgMinutes: 0, avgViews: 0, count: 0 },
    vlog: { avgMinutes: 0, avgViews: 0, count: 0 },
  };

  videos.forEach((video) => {
    const genre = estimateGenre(video);

    genreStats[genre].count += 1;
    genreStats[genre].avgViews += video.views;
    genreStats[genre].avgMinutes += video.minutes || 0;
  });

  // 平均を計算
  Object.keys(genreStats).forEach((genre) => {
    const key = genre as Genre;

    if (genreStats[key].count > 0) {
      genreStats[key].avgViews /= genreStats[key].count;
      genreStats[key].avgMinutes /= genreStats[key].count;
    }
  });

  // 主要ジャンルを特定（動画数が最も多いもの）
  let mainGenre: Genre = "other";
  let maxCount = 0;

  (Object.keys(genreStats) as Array<Genre>).forEach((genre) => {
    if (genreStats[genre].count > maxCount) {
      maxCount = genreStats[genre].count;
      mainGenre = genre;
    }
  });

  // 一般的な推奨範囲
  const generalRange = genreRecommendations[mainGenre];
  // チャンネル固有の最適範囲を計算（主要ジャンルの平均±20%）
  const channelSpecificMinutes = genreStats[mainGenre].avgMinutes || 10;
  const channelSpecificRange = [
    Math.max(1, Math.round(channelSpecificMinutes * 0.8)),
    Math.round(channelSpecificMinutes * 1.2),
  ];
  // ジャンル名を日本語に変換
  const genreNameJapanese: Record<Genre, string> = {
    discussion: "考察/分析",
    howto: "ハウツー/解説",
    other: "オリジナルコンテンツ",
    ranking: "ランキング/おすすめ",
    reaction: "リアクション",
    review: "レビュー/紹介",
    vlog: "Vlog/日常",
  };

  return {
    channelSpecificRange,
    generalRange,
    mainGenre,
    mainGenreName: genreNameJapanese[mainGenre],
    recommendation: `${channelSpecificRange[0]}〜${channelSpecificRange[1]}分`,
  };
}

// チャンネルで伸びる可能性のある動画長を特定
function identifyGrowthOpportunity(
  buckets: Record<string, DurationBucket>,
): GrowthOpportunity | null {
  // 各バケットの動画数とパフォーマンスを分析
  const bucketStats = Object.entries(buckets)
    .map(([range, data]) => ({
      avgEngagement: data.avgEngagement,
      avgViews: data.avgViews,
      count: data.count,
      performanceScore: data.avgViews * (1 + data.avgEngagement / 100), // 視聴数とエンゲージメントを組み合わせたスコア
      range,
    }))
    .filter((bucket) => bucket.count > 0); // データがあるバケットのみ

  // 十分なデータがない場合はnullを返す
  if (bucketStats.length < 2) return null;

  // 最もパフォーマンスの高いバケット
  const bestPerformer = bucketStats.reduce(
    (max, curr) => (curr.performanceScore > max.performanceScore ? curr : max),
    bucketStats[0],
  );
  // 最も制作数の多いバケット
  const mostProduced = bucketStats.reduce(
    (max, curr) => (curr.count > max.count ? curr : max),
    bucketStats[0],
  );

  // データが十分にある場合のみ、改善の余地があるか判断
  if (bestPerformer.range !== mostProduced.range && mostProduced.count >= 3) {
    return {
      currentFocus: mostProduced.range,
      currentFocusCount: mostProduced.count,
      reasonEngagement: (
        bestPerformer.avgEngagement - mostProduced.avgEngagement
      ).toFixed(2),
      reasonViews: Math.round(bestPerformer.avgViews - mostProduced.avgViews),
      recommendation: bestPerformer.range,
    };
  }

  return null;
}

// 新しい型定義
type DurationBucket = {
  avgEngagement: number; // 平均エンゲージメント率
  avgViews: number; // 平均視聴回数
  count: number; // このバケットの動画数
  totalEngagement: number; // 合計エンゲージメント率
  totalViews: number; // 合計視聴回数
  videos: {
    // このバケットの代表的な動画（最大5つ）
    engagement: number; // エンゲージメント率
    id: string; // 動画ID
    minutes: number; // 動画長（分）
    title: string; // タイトル
    views: number; // 視聴回数
  }[];
};

type CompleteDurationAnalysis = {
  buckets: Record<string, DurationBucket>; // 時間帯別のバケット
  optimalForEngagement: null | string; // エンゲージメントに最適な時間帯
  optimalForViews: null | string; // 視聴数に最適な時間帯
};

type GenreDurationRecommendation = {
  channelSpecificRange: number[]; // チャンネル固有の推奨範囲（分）
  generalRange: readonly number[]; // 一般的な推奨範囲（分）
  mainGenre: string; // 主要ジャンル
  mainGenreName: string; // 主要ジャンルの日本語名
  recommendation: string; // 最終的な推奨時間
};

type GrowthOpportunity = {
  currentFocus: string; // 現在最も多く作られている動画長
  currentFocusCount: number; // その動画数
  reasonEngagement: string; // エンゲージメント率の差（推定）
  reasonViews: number; // 視聴数の差（推定）
  recommendation: string; // 推奨される動画長
};

// DurationAnalysis型の拡張
type DurationAnalysis = {
  avgMinutes: number;
  best: VideoInfo[];
  completeDurationAnalysis?: CompleteDurationAnalysis; // 追加: 詳細な時間帯別分析
  genreRecommendation?: GenreDurationRecommendation; // 追加: ジャンル別推奨時間
  growthOpportunity?: GrowthOpportunity | null; // 追加: 成長機会
};

// コンテンツカテゴリと成功率の分析
function analyzeContentCategories(videos: VideoInfo[]): ContentCategory {
  // タイトルとタグからコンテンツフォーマットを推測
  const formatPatterns: Record<string, RegExp[]> = {
    discussion: [
      /考察|解説|分析|まとめ|議論|理由|なぜ|違い|どっち|どちら/i,
      /analysis|theory|explained|why|difference|discussion/i,
    ],
    howto: [
      /方法|やり方|仕方|手順|解説|講座|ガイド|チュートリアル|入門|初心者|基本|使い方|コツ|ポイント/i,
      /how\s*to|tutorial|guide|tips|tricks/i,
    ],
    ranking: [
      /ランキング|人気|おすすめ|ベスト|トップ|選び方|厳選/i,
      /ranking|top\s*\d+|best\s*\d+/i,
    ],
    reaction: [
      /リアクション|反応|見てみた|聞いてみた|初見|初めて|驚き/i,
      /reaction|reacting\s*to|first\s*time/i,
    ],
    review: [
      /レビュー|感想|使ってみた|試してみた|紹介|インプレ|購入品|開封|比較|評価/i,
      /review|unboxing|versus|comparison/i,
    ],
    vlog: [
      /日常|休日|休み|旅行|旅|観光|vlog|ルーティン|生活|暮らし|一日/i,
      /vlog|diary|daily|routine|day\s*in/i,
    ],
  };

  type ContentType = "other" | keyof typeof formatPatterns;

  // 日本語フォーマット名のマッピング
  const formatJapanese: Record<ContentType, string> = {
    discussion: "考察/分析",
    howto: "ハウツー/解説",
    other: "オリジナルコンテンツ",
    ranking: "ランキング/おすすめ",
    reaction: "リアクション",
    review: "レビュー/紹介",
    vlog: "Vlog/日常",
  };
  // 各フォーマットのコンテンツを分類
  const categorizedVideos: Record<ContentType, VideoInfo[]> = {
    discussion: [],
    howto: [],
    other: [],
    ranking: [],
    reaction: [],
    review: [],
    vlog: [],
  };
  // 各フォーマットの出現回数をカウント
  const formatCounts: Record<ContentType, number> = {
    discussion: 0,
    howto: 0,
    other: 0,
    ranking: 0,
    reaction: 0,
    review: 0,
    vlog: 0,
  };

  // 各動画のフォーマットを特定して分類
  videos.forEach((video) => {
    let detected: ContentType | null = null;

    // タイトルとタグを結合してチェック
    const content = video.title + " " + video.tags.join(" ");

    for (const [format, patterns] of Object.entries(formatPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          const formatKey = format as ContentType;

          formatCounts[formatKey]++;
          categorizedVideos[formatKey].push(video);
          detected = formatKey;

          break;
        }
      }

      if (detected) break;
    }

    // 検出できなかった場合は「その他」としてカウント
    if (!detected) {
      formatCounts.other++;
      categorizedVideos.other.push(video);
    }
  });

  // 各コンテンツタイプの成功指標を計算
  const typePerformance: TypePerformance[] = [];
  const totalAvgViews = stats.mean(videos.map((v) => v.views));
  const totalAvgEngagement = stats.mean(
    videos.map((v) => (v.likes / v.views) * 100),
  );

  // 各タイプの成功率を計算
  Object.entries(categorizedVideos).forEach(([type, typeVideos]) => {
    if (typeVideos.length > 0) {
      const typeName = type as ContentType;
      const avgViews = stats.mean(typeVideos.map((v) => v.views));
      const avgEngagement = stats.mean(
        typeVideos.map((v) => (v.likes / v.views) * 100),
      );
      const relativeViewsPerformance =
        totalAvgViews > 0 ? (avgViews / totalAvgViews) * 100 : 100;
      const relativeEngagementPerformance =
        totalAvgEngagement > 0
          ? (avgEngagement / totalAvgEngagement) * 100
          : 100;
      const combinedScore =
        (relativeViewsPerformance + relativeEngagementPerformance) / 2;
      // 成功事例と失敗事例を見つける
      const sortedByViews = [...typeVideos].sort((a, b) => b.views - a.views);
      const topPerformer = sortedByViews.length > 0 ? sortedByViews[0] : null;
      const worstPerformer =
        sortedByViews.length > 1
          ? sortedByViews[sortedByViews.length - 1]
          : null;
      // 特徴的な要素を分析
      const successFactors = analyzeSuccessFactors(
        sortedByViews.slice(0, Math.min(3, sortedByViews.length)),
      );

      typePerformance.push({
        avgEngagement,
        avgViews,
        combinedScore,
        count: typeVideos.length,
        name: typeName,
        nameJapanese: formatJapanese[typeName],
        percentage: (typeVideos.length / videos.length) * 100,
        relativeEngagementPerformance,
        relativeViewsPerformance,
        successFactors,
        topPerformer: topPerformer
          ? {
              id: topPerformer.id,
              title: topPerformer.title,
              views: topPerformer.views,
            }
          : null,
        worstPerformer: worstPerformer
          ? {
              id: worstPerformer.id,
              title: worstPerformer.title,
              views: worstPerformer.views,
            }
          : null,
      });
    }
  });

  // 成功スコアでソート
  typePerformance.sort((a, b) => b.combinedScore - a.combinedScore);

  // 最も効果的なタイプとその特徴
  const mostEffectiveType =
    typePerformance.length > 0 ? typePerformance[0] : null;
  const leastEffectiveType =
    typePerformance.length > 1
      ? typePerformance[typePerformance.length - 1]
      : null;
  // チャンネル特有のニッチを特定
  const nichePotential = identifyNichePotential(typePerformance);
  // 分散の分析
  const contentDistribution = analyzeContentDistribution(typePerformance);
  // 最も多いフォーマットを特定
  const sortedFormats = Object.entries(formatCounts).sort(
    (a, b) => b[1] - a[1],
  );
  const topFormat =
    sortedFormats.length > 0 ? (sortedFormats[0][0] as ContentType) : "other";
  // 人気タグからテーマを特定
  const themes = videos
    .flatMap((v) => v.tags)
    .filter((tag, i, self) => self.indexOf(tag) === i)
    .slice(0, 10);

  return {
    commonFormats: formatCounts,
    contentDistribution,
    format: topFormat,
    leastEffectiveType,
    mostEffectiveType,
    nichePotential,
    themes,
    topFormat,
    typePerformance,
  };
}

// 成功動画からの特徴的要素の分析
function analyzeSuccessFactors(successVideos: VideoInfo[]): SuccessFactors {
  if (successVideos.length === 0) {
    return {
      commonPhrases: [],
      tagSuggestions: [],
    };
  }

  // タイトルの共通フレーズを探す
  const titleWords: Record<string, number> = {};

  successVideos.forEach((video) => {
    video.title
      // eslint-disable-next-line no-useless-escape
      .split(/[\s,.!?;:'"()\/\-_&\+\[\]{}【】「」『』、。]/u)
      .filter((word) => word.length > 1)
      .forEach((word) => {
        titleWords[word] = (titleWords[word] || 0) + 1;
      });
  });

  // 3本中2本以上で使用されている単語を抽出
  const commonPhrases = Object.entries(titleWords)
    .filter(
      ([, count]) =>
        count >= Math.max(2, Math.ceil(successVideos.length * 0.5)),
    )
    .map(([word]) => word);
  // 共通して使用されているタグを抽出
  const tagUsage: Record<string, number> = {};

  successVideos.forEach((video) => {
    video.tags.forEach((tag) => {
      tagUsage[tag] = (tagUsage[tag] || 0) + 1;
    });
  });

  const commonTags = Object.entries(tagUsage)
    .filter(
      ([, count]) =>
        count >= Math.max(2, Math.ceil(successVideos.length * 0.5)),
    )
    .map(([tag]) => tag);

  return {
    commonPhrases,
    tagSuggestions: commonTags,
  };
}

// チャンネルの潜在的なニッチを特定
function identifyNichePotential(
  typePerformance: TypePerformance[],
): NichePotential | null {
  if (typePerformance.length < 2) return null;

  // 動画数が少ないが、平均視聴数が高いコンテンツタイプを探す
  const potentialNiches = typePerformance.filter(
    (type) =>
      type.count < 5 && // 比較的少ない動画数
      type.relativeViewsPerformance > 120 && // チャンネル平均より20%以上高い視聴数
      type.combinedScore > 110, // 総合スコアも高い
  );

  if (potentialNiches.length === 0) return null;

  // 最も有望なニッチを選択
  const topNiche = potentialNiches.reduce(
    (best, current) =>
      current.combinedScore > best.combinedScore ? current : best,
    potentialNiches[0],
  );

  return {
    name: topNiche.name,
    nameJapanese: topNiche.nameJapanese,
    potentialGrowth: ((topNiche.relativeViewsPerformance - 100) / 10).toFixed(
      1,
    ), // 10%ごとに1ポイント
    recommendation: `「${topNiche.nameJapanese}」コンテンツをもっと制作することで視聴回数${Math.round(topNiche.relativeViewsPerformance - 100)}%向上の可能性があります`,
  };
}

// コンテンツの分散状況を分析
function analyzeContentDistribution(
  typePerformance: TypePerformance[],
): ContentDistribution {
  if (typePerformance.length === 0) {
    return {
      diversificationScore: 0,
      isBalanced: false,
      recommendation: "コンテンツ分析のために十分なデータがありません",
    };
  }

  // コンテンツの分散度を計算（0-100、高いほど多様）
  const totalVideos = typePerformance.reduce(
    (sum, type) => sum + type.count,
    0,
  );

  if (totalVideos === 0)
    return {
      diversificationScore: 0,
      isBalanced: false,
      recommendation: "データなし",
    };

  // エントロピーベースの多様性スコア計算
  const entropy = typePerformance.reduce((sum, type) => {
    const p = type.count / totalVideos;

    return sum - p * Math.log2(p);
  }, 0);
  // 最大可能エントロピー（全て均等に分布した場合）
  const maxEntropy = Math.log2(typePerformance.length);
  // 正規化されたスコア（0-100）
  const diversificationScore = Math.round((entropy / maxEntropy) * 100);
  // 特定のタイプが全体の60%以上を占めているか
  const isDominated = typePerformance.some(
    (type) => type.count / totalVideos > 0.6,
  );
  // バランスの評価（40-70%が理想的）
  const isBalanced = diversificationScore >= 40 && diversificationScore <= 70;

  // 推奨事項
  let recommendation = "";

  if (diversificationScore < 30) {
    recommendation =
      "コンテンツの多様化が推奨されます。現在のフォーカスに加えて新しいタイプのコンテンツを試してみてください。";
  } else if (diversificationScore > 80) {
    recommendation =
      "コンテンツタイプが多すぎる可能性があります。最も成功しているタイプにより焦点を当てることを検討してください。";
  } else {
    recommendation =
      "コンテンツのバランスは良好です。最も成功している2-3種類のコンテンツタイプを中心に展開しましょう。";
  }

  return {
    diversificationScore,
    isBalanced,
    isDominated,
    recommendation,
  };
}

// 新しい型定義
type VideoSummary = {
  id: string;
  title: string;
  views: number;
};

type SuccessFactors = {
  commonPhrases: string[]; // 成功動画で共通して使用されている単語やフレーズ
  tagSuggestions: string[]; // 推奨されるタグ
};

type TypePerformance = {
  avgEngagement: number; // 平均エンゲージメント率
  avgViews: number; // 平均視聴回数
  combinedScore: number; // 総合スコア（視聴数とエンゲージメントの相対スコアの平均）
  count: number; // このタイプの動画数
  name: string; // タイプ名（英語）
  nameJapanese: string; // タイプ名（日本語）
  percentage: number; // チャンネル全体に占める割合（%）
  relativeEngagementPerformance: number; // チャンネル平均に対する相対的なエンゲージメント（%）
  relativeViewsPerformance: number; // チャンネル平均に対する相対的な視聴数（%）
  successFactors: SuccessFactors; // 成功要因の分析
  topPerformer: null | VideoSummary; // 最も成功した動画
  worstPerformer: null | VideoSummary; // 最も成功しなかった動画
};

type NichePotential = {
  name: string; // ニッチのタイプ名（英語）
  nameJapanese: string; // ニッチのタイプ名（日本語）
  potentialGrowth: string; // 成長可能性スコア
  recommendation: string; // 推奨事項
};

type ContentDistribution = {
  diversificationScore: number; // コンテンツの多様性スコア（0-100）
  isBalanced: boolean; // バランスが取れているか
  isDominated?: boolean; // 特定のタイプが支配的か
  recommendation: string; // 推奨事項
};

// ContentCategory型の拡張
type ContentCategory = {
  commonFormats: Record<string, number>;
  contentDistribution?: ContentDistribution; // 追加: コンテンツ分散の分析
  format: string;
  leastEffectiveType?: null | TypePerformance; // 追加: 最も効果の低いコンテンツタイプ
  mostEffectiveType?: null | TypePerformance; // 追加: 最も効果的なコンテンツタイプ
  nichePotential?: NichePotential | null; // 追加: 潜在的なニッチ
  themes: string[];
  topFormat: string;
  typePerformance?: TypePerformance[]; // 追加: 各タイプのパフォーマンス
};

// エンゲージメントと成長に関する相関分析
function analyzeEngagementGrowthCorrelation(
  videos: VideoInfo[],
): EngagementGrowthAnalysis {
  // 日付でソート（古い順）
  const sortedVideos = [...videos].sort(
    (a, b) => new Date(a.published).getTime() - new Date(b.published).getTime(),
  );

  // 十分なデータがない場合は分析不可
  if (sortedVideos.length < 5) {
    return {
      correlationScore: 0,
      engagementComparisonData: {
        differencePercentage: 0,
        highEngagementGrowth: 0,
        lowEngagementGrowth: 0,
      },
      engagementTrend: {
        changePercentage: 0,
        isImproving: false,
        trendDescription: "データ不足",
      },
      growthRateTrend: {
        changePercentage: 0,
        isImproving: false,
        trendDescription: "データ不足",
      },
      hasStrongCorrelation: false,
      highEngagementFeatures: [],
      insight:
        "十分なデータがないため分析できません。少なくとも5つ以上の動画が必要です。",
      lowEngagementFeatures: [],
      recommendationsBasedOnCorrelation: [],
    };
  }

  // データ準備：各動画の基本指標
  type EnhancedVideoData = {
    comments: number;
    date: Date;
    engagement: number; // いいね率（いいね÷視聴数）
    id: string;
    likes: number;
    order: number; // 投稿順序（0から始まる）
    published: string;
    relativeGrowth: number; // 前回からの成長率
    title: string;
    views: number;
  };

  const enhancedData: EnhancedVideoData[] = sortedVideos.map((video, index) => {
    // 動画ごとのエンゲージメント率を計算（いいね÷視聴数）
    const engagement = (video.likes / Math.max(1, video.views)) * 100;

    // 前回との相対成長率を計算（最初の動画は基準値として0）
    let relativeGrowth = 0;

    if (index > 0 && sortedVideos[index - 1].views > 0) {
      relativeGrowth =
        ((video.views - sortedVideos[index - 1].views) /
          sortedVideos[index - 1].views) *
        100;
    }

    return {
      comments: video.comments,
      date: new Date(video.published),
      engagement,
      id: video.id,
      likes: video.likes,
      order: index,
      published: video.published,
      relativeGrowth,
      title: video.title,
      views: video.views,
    };
  });
  // 前半と後半に分けて傾向を分析（時系列的な変化を見る）
  const halfPoint = Math.floor(enhancedData.length / 2);
  const firstHalf = enhancedData.slice(0, halfPoint);
  const secondHalf = enhancedData.slice(halfPoint);
  // エンゲージメント傾向の分析
  const avgEngagementFirstHalf = stats.mean(firstHalf.map((v) => v.engagement));
  const avgEngagementSecondHalf = stats.mean(
    secondHalf.map((v) => v.engagement),
  );
  const engagementChangePercentage =
    avgEngagementFirstHalf > 0
      ? ((avgEngagementSecondHalf - avgEngagementFirstHalf) /
          avgEngagementFirstHalf) *
        100
      : 0;
  // 成長率傾向の分析（最初の動画は基準なので除外）
  const avgGrowthFirstHalf = stats.mean(
    firstHalf.slice(1).map((v) => v.relativeGrowth),
  );
  const avgGrowthSecondHalf = stats.mean(
    secondHalf.map((v) => v.relativeGrowth),
  );
  const growthChangePercentage =
    avgGrowthFirstHalf > 0
      ? ((avgGrowthSecondHalf - avgGrowthFirstHalf) / avgGrowthFirstHalf) * 100
      : 0;
  // エンゲージメントと成長の順位相関を計算
  // エンゲージメント率と次回の視聴成長率の関係を調べる（1つずれたデータで相関を見る）
  const correlationPairs: { engagement: number; nextGrowth: number }[] = [];

  for (let i = 0; i < enhancedData.length - 1; i++) {
    correlationPairs.push({
      engagement: enhancedData[i].engagement,
      nextGrowth: enhancedData[i + 1].relativeGrowth,
    });
  }

  // ピアソンの積率相関係数を計算
  const correlationScore = calculateCorrelation(
    correlationPairs.map((p) => p.engagement),
    correlationPairs.map((p) => p.nextGrowth),
  );
  // 強い相関があるかを判定
  const hasStrongCorrelation = Math.abs(correlationScore) > 0.5;
  // エンゲージメントが高い動画と低い動画の特徴を分析
  const highEngagementVideos = [...enhancedData]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, Math.min(3, enhancedData.length));
  const lowEngagementVideos = [...enhancedData]
    .sort((a, b) => a.engagement - b.engagement)
    .slice(0, Math.min(3, enhancedData.length));
  // エンゲージメントが成長に与える影響の分析
  const growthWithHighEngagement = enhancedData
    .filter(
      (v) => v.engagement > stats.mean(enhancedData.map((d) => d.engagement)),
    )
    .map((v) => v.order)
    .slice(0, -1) // 最後の動画の後の成長は測定不可
    .map((order) => enhancedData[order + 1]?.relativeGrowth || 0);
  const growthWithLowEngagement = enhancedData
    .filter(
      (v) => v.engagement <= stats.mean(enhancedData.map((d) => d.engagement)),
    )
    .map((v) => v.order)
    .slice(0, -1) // 最後の動画の後の成長は測定不可
    .map((order) => enhancedData[order + 1]?.relativeGrowth || 0);
  const avgGrowthAfterHighEngagement =
    growthWithHighEngagement.length > 0
      ? stats.mean(growthWithHighEngagement)
      : 0;
  const avgGrowthAfterLowEngagement =
    growthWithLowEngagement.length > 0
      ? stats.mean(growthWithLowEngagement)
      : 0;

  // 相関に基づく洞察を生成
  let insight = "";

  if (hasStrongCorrelation && correlationScore > 0) {
    insight = `エンゲージメント率と次回動画の成長に強い正の相関(${correlationScore.toFixed(2)})が見られます。高いエンゲージメントが次回の視聴増加に繋がっています。`;
  } else if (hasStrongCorrelation && correlationScore < 0) {
    insight = `エンゲージメント率と次回動画の成長に強い負の相関(${correlationScore.toFixed(2)})が見られます。これは意外な結果であり、別の要因が成長に影響していると考えられます。`;
  } else {
    insight = `エンゲージメント率と次回動画の成長に明確な相関(${correlationScore.toFixed(2)})は見られません。視聴者の獲得には別の要因が大きく影響していると考えられます。`;
  }

  // 高エンゲージメント動画の共通点を分析
  const highEngagementFeatures = analyzeCommonFeatures(highEngagementVideos);
  // 相関に基づく推奨事項
  const recommendationsBasedOnCorrelation: string[] = [];

  if (correlationScore > 0.3) {
    // 正の相関が見られる場合の推奨事項
    recommendationsBasedOnCorrelation.push(
      "エンゲージメントを高めることがチャンネル成長に直接影響しています。コメント返信やコール・トゥ・アクションを強化しましょう。",
    );

    if (highEngagementFeatures.length > 0) {
      recommendationsBasedOnCorrelation.push(
        `高エンゲージメント動画の共通点（${highEngagementFeatures.join("、")}）を今後の動画制作に取り入れてください。`,
      );
    }

    recommendationsBasedOnCorrelation.push(
      `エンゲージメント率が平均より高い動画の後は、次回動画の視聴数が平均${avgGrowthAfterHighEngagement.toFixed(1)}%増加していますが、低エンゲージメント動画の後は${avgGrowthAfterLowEngagement.toFixed(1)}%です。この差が成長への影響を示しています。`,
    );

    // 低エンゲージメント動画の分析結果も追加
    const lowEngagementFeatures = analyzeCommonFeatures(lowEngagementVideos);

    if (lowEngagementFeatures.length > 0) {
      recommendationsBasedOnCorrelation.push(
        `エンゲージメントが低い動画に共通する特徴（${lowEngagementFeatures.join("、")}）は避けるか改善することを検討してください。`,
      );
    }
  } else if (correlationScore < -0.3) {
    // 負の相関が見られる場合の推奨事項
    recommendationsBasedOnCorrelation.push(
      "意外な傾向として、エンゲージメントと次回視聴数に負の相関が見られます。これはコンテンツタイプの違いや特定の視聴者層の行動パターンによる可能性があります。",
    );

    recommendationsBasedOnCorrelation.push(
      "新規視聴者の獲得とエンゲージメントのバランスを見直し、両方を最適化する戦略が必要です。",
    );
  } else {
    // 明確な相関がない場合の推奨事項
    recommendationsBasedOnCorrelation.push(
      "エンゲージメントよりも、SEO最適化やコンテンツの質、一貫性などが視聴数増加に重要な可能性があります。",
    );

    recommendationsBasedOnCorrelation.push(
      "エンゲージメントとチャンネル成長を別々の指標として捉え、それぞれに適した戦略を立ててください。",
    );
  }

  // 傾向の表現を生成
  const engagementTrendDescription = generateTrendDescription(
    engagementChangePercentage,
    "エンゲージメント率",
  );
  const growthTrendDescription = generateTrendDescription(
    growthChangePercentage,
    "視聴数成長率",
  );
  // 低エンゲージメント動画の特徴も分析
  const lowEngagementFeatures = analyzeCommonFeatures(lowEngagementVideos);
  // エンゲージメントの比較データを作成
  const engagementComparisonData = {
    differencePercentage:
      avgGrowthAfterHighEngagement - avgGrowthAfterLowEngagement,
    highEngagementGrowth: avgGrowthAfterHighEngagement,
    lowEngagementGrowth: avgGrowthAfterLowEngagement,
  };

  return {
    correlationScore,
    engagementComparisonData,
    engagementTrend: {
      changePercentage: engagementChangePercentage,
      isImproving: engagementChangePercentage > 0,
      trendDescription: engagementTrendDescription,
    },
    growthRateTrend: {
      changePercentage: growthChangePercentage,
      isImproving: growthChangePercentage > 0,
      trendDescription: growthTrendDescription,
    },
    hasStrongCorrelation,
    highEngagementFeatures,
    insight,
    lowEngagementFeatures,
    recommendationsBasedOnCorrelation,
  };
}

// ピアソンの積率相関係数を計算する関数
function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  // 平均を計算
  const xMean = x.reduce((sum, val) => sum + val, 0) / n;
  const yMean = y.reduce((sum, val) => sum + val, 0) / n;

  // 分子（共分散）と分母（標準偏差の積）を計算
  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = x[i] - xMean;
    const yDiff = y[i] - yMean;

    numerator += xDiff * yDiff;
    xDenominator += xDiff * xDiff;
    yDenominator += yDiff * yDiff;
  }

  // 分母が0の場合は相関なし
  if (xDenominator === 0 || yDenominator === 0) return 0;

  return numerator / Math.sqrt(xDenominator * yDenominator);
}

// 高エンゲージメント動画の共通点を分析
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function analyzeCommonFeatures(videos: any[]): string[] {
  if (videos.length < 2) return [];

  const features: string[] = [];
  // コメント対いいね比率の分析
  const commentToLikeRatios = videos.map(
    (v) => v.comments / Math.max(1, v.likes),
  );
  const avgCommentToLikeRatio = stats.mean(commentToLikeRatios);

  if (avgCommentToLikeRatio > 0.1) {
    features.push("視聴者参加を促す内容");
  }

  // 動画タイトルの長さ分析
  const titleLengths = videos.map((v) => v.title.length);
  const avgTitleLength = stats.mean(titleLengths);

  if (avgTitleLength < 30) {
    features.push("簡潔なタイトル");
  } else if (avgTitleLength > 50) {
    features.push("詳細なタイトル");
  }

  // 投稿時間帯の分析
  const hours = videos.map((v) => v.date.getHours());
  const uniqueHours = new Set(hours);

  if (uniqueHours.size < videos.length) {
    features.push("特定の時間帯への投稿");
  }

  // 曜日分析
  const days = videos.map((v) => v.date.getDay());
  const uniqueDays = new Set(days);

  if (uniqueDays.size < videos.length) {
    features.push("特定の曜日への投稿");
  }

  return features;
}

// 変化率からトレンド説明文を生成
function generateTrendDescription(
  changePercentage: number,
  metricName: string,
): string {
  if (Math.abs(changePercentage) < 5) {
    return `${metricName}は安定しています`;
  } else if (changePercentage >= 5 && changePercentage < 20) {
    return `${metricName}は緩やかに上昇傾向です`;
  } else if (changePercentage >= 20) {
    return `${metricName}は大幅に改善しています`;
  } else if (changePercentage <= -5 && changePercentage > -20) {
    return `${metricName}は緩やかに下降傾向です`;
  } else {
    return `${metricName}は大幅に減少しています`;
  }
}

// 型定義
type TrendInfo = {
  changePercentage: number; // 変化率（%）
  isImproving: boolean; // 改善しているか
  trendDescription: string; // トレンドの説明
};

type EngagementComparisonData = {
  differencePercentage: number; // 両者の差
  highEngagementGrowth: number; // 高エンゲージメント動画後の平均成長率
  lowEngagementGrowth: number; // 低エンゲージメント動画後の平均成長率
};

type EngagementGrowthAnalysis = {
  correlationScore: number; // 相関係数（-1.0〜1.0）
  engagementComparisonData: EngagementComparisonData; // エンゲージメント比較データ
  engagementTrend: TrendInfo; // エンゲージメントの傾向
  growthRateTrend: TrendInfo; // 成長率の傾向
  hasStrongCorrelation: boolean; // 強い相関関係があるか
  highEngagementFeatures?: string[]; // 高エンゲージメント動画の特徴
  insight: string; // 分析からの洞察
  lowEngagementFeatures?: string[]; // 低エンゲージメント動画の特徴
  recommendationsBasedOnCorrelation: string[]; // 相関に基づく推奨事項
};

// analyzeData関数の拡張バージョン
function analyzeData(
  videos: VideoInfo[],
  channel: ChannelInfo,
): AnalysisResult {
  // 動画を視聴回数でソート
  const byViews = [...videos].sort((a, b) => b.views - a.views);
  const topVideos = byViews.slice(0, CONFIG.topResultsCount);
  const bottomVideos = byViews.slice(-CONFIG.topResultsCount);
  // エンゲージメント率を計算
  const withEngagement = videos.map((v) => ({
    ...v,
    engagement: (v.likes / v.views) * 100,
  }));
  const byEngagement = [...withEngagement].sort(
    (a, b) => (b.engagement || 0) - (a.engagement || 0),
  );
  const topEngagement = byEngagement.slice(0, CONFIG.topResultsCount);
  // 各分析を実行
  const tagStats = analyzeVideoTags(videos);
  const titleStats = analyzeVideoTitles(videos, topVideos, bottomVideos);
  const postingStats = analyzePostingPatterns(videos);
  const durationStats = analyzeDurations(videos);
  const trendStats = analyzeTimeTrends(videos);
  const frequencyStats = analyzePostingFrequency(videos);
  const categoryStats = analyzeContentCategories(videos);
  // 新しい分析を追加
  const engagementGrowthStats = analyzeEngagementGrowthCorrelation(videos);
  // 統計概要を計算
  const viewCounts = videos.map((v) => v.views);
  const likeCounts = videos.map((v) => v.likes);
  const commentCounts = videos.map((v) => v.comments);

  // 分析結果の構築
  return {
    categories: categoryStats,
    channel,
    count: videos.length,
    duration: durationStats,
    engagementGrowth: engagementGrowthStats, // 新しい分析結果を追加
    frequency: frequencyStats,
    posting: postingStats,
    stats: {
      avgComments: stats.mean(commentCounts),
      avgEngagement: stats.mean(withEngagement.map((v) => v.engagement || 0)),
      avgLikes: stats.mean(likeCounts),
      avgViews: stats.mean(viewCounts),
      medianViews: stats.median(viewCounts),
      viewsStdDev: stats.stdDev(viewCounts),
    },
    tags: tagStats,
    titles: titleStats,
    top: topVideos,
    topEngagement,
    trend: trendStats,
  };
}

// AnalysisResult型の拡張
type AnalysisResult = {
  categories: ContentCategory;
  channel: ChannelInfo;
  count: number;
  duration: DurationAnalysis;
  engagementGrowth?: EngagementGrowthAnalysis; // 追加: エンゲージメントと成長の相関分析
  frequency: PostingFrequency;
  posting: PostingAnalysis;
  stats: {
    avgComments: number;
    avgEngagement: number;
    avgLikes: number;
    avgViews: number;
    medianViews: number;
    viewsStdDev: number;
  };
  tags: TagInfo[];
  titles: TitleAnalysis;
  top: VideoInfo[];
  topEngagement: VideoInfo[];
  trend: TrendAnalysis;
};

// 投稿頻度分析と最適化
function analyzePostingFrequency(videos: VideoInfo[]): PostingFrequency {
  if (videos.length < 3) {
    return {
      daysBetweenPosts: 0,
      isConsistent: false,
      optimizedSchedule: {
        achievableFrequency: "不明",
        recommendedDays: [],
        recommendedScheduleText:
          "十分なデータがないため、推奨スケジュールを作成できません。",
        sustainabilityScore: 0,
      },
      pattern: "不明",
      postsPerMonth: 0,
      preferredDays: [],
      scheduleDiscipline: 0,
    };
  }

  // 日付でソート
  const byDate = [...videos].sort(
    (a, b) => new Date(a.published).getTime() - new Date(b.published).getTime(),
  );
  // 投稿間の日数を計算
  const daysBetween: number[] = [];
  const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]; // 日〜土の投稿回数

  // 投稿の日時データを収集
  type PostInfo = {
    date: Date;
    day: number; // 曜日（0=日曜、6=土曜）
    daysBefore?: number; // 前回の投稿からの日数
    hour: number; // 投稿時間（時）
    views: number; // 視聴数
  };

  const postInfos: PostInfo[] = byDate.map((video, index) => {
    const date = new Date(video.published);
    const day = date.getDay();

    dayOfWeekCounts[day]++;

    // 前回の投稿からの日数を計算
    let daysBefore: number | undefined = undefined;

    if (index > 0) {
      const prevDate = new Date(byDate[index - 1].published);
      const diffTime = Math.abs(date.getTime() - prevDate.getTime());

      daysBefore = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      daysBetween.push(daysBefore);
    }

    return {
      date,
      day,
      daysBefore,
      hour: date.getHours(),
      views: video.views,
    };
  });
  // 平均日数と標準偏差
  const avgDays = stats.mean(daysBetween);
  const stdDev = stats.stdDev(daysBetween);
  const isConsistent = stdDev < avgDays * 0.5; // 標準偏差が平均の50%未満なら一貫していると判断
  // スケジュールの規律性スコアを計算（0〜100）
  // 標準偏差が小さいほど規律性が高い
  const scheduleDiscipline = Math.min(
    100,
    Math.max(0, 100 - (stdDev / avgDays) * 100),
  );
  // 月あたりの投稿数を計算
  const postsPerMonth = 30 / Math.max(1, avgDays);

  // パターンを判定
  let pattern = "不定期";

  if (isConsistent) {
    if (avgDays <= 1.5) pattern = "毎日";
    else if (avgDays <= 3.5) pattern = "2-3日ごと";
    else if (avgDays <= 7.5) pattern = "週1回";
    else if (avgDays <= 14.5) pattern = "隔週";
    else if (avgDays <= 31) pattern = "月1回";
    else pattern = "月1回未満";
  }

  // 曜日ごとの平均視聴数を分析
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

  type DayStats = {
    avgViews: number;
    count: number;
    day: number;
    dayName: string;
    totalViews: number;
  };

  const dayStats: DayStats[] = dayNames.map((dayName, day) => {
    const posts = postInfos.filter((post) => post.day === day);
    const totalViews = posts.reduce((sum, post) => sum + post.views, 0);
    const count = posts.length;
    const avgViews = count > 0 ? totalViews / count : 0;

    return { avgViews, count, day, dayName, totalViews };
  });
  // 投稿数の多い曜日をソート
  const byPostCount = [...dayStats].sort((a, b) => b.count - a.count);
  const preferredDays = byPostCount
    .filter((day) => day.count > 0)
    .map((day) => day.dayName);
  // 視聴数の多い曜日をソート
  const byViewCount = [...dayStats]
    .filter((day) => day.count > 0) // 投稿があった曜日のみ
    .sort((a, b) => b.avgViews - a.avgViews);
  // 時間帯分析
  const hourCounts = Array(24).fill(0) as number[];
  const hourViews = Array(24).fill(0) as number[];

  postInfos.forEach((post) => {
    hourCounts[post.hour]++;
    hourViews[post.hour] += post.views;
  });

  const hourStats = hourCounts.map((count, hour) => {
    return {
      avgViews: count > 0 ? hourViews[hour] / count : 0,
      count,
      hour,
      totalViews: hourViews[hour],
    };
  });
  // 最も視聴数が多い時間帯（投稿が3回以上ある時間帯のみ考慮）
  const bestHours = hourStats
    .filter((hour) => hour.count >= 3)
    .sort((a, b) => b.avgViews - a.avgViews)
    .slice(0, 3)
    .map((hour) => hour.hour);
  // 一貫性と視聴数の両方を考慮した最適な投稿頻度を提案
  const optimizedSchedule = calculateOptimizedSchedule(
    byViewCount,
    bestHours,
    avgDays,
    isConsistent,
    pattern,
    videos.length,
    scheduleDiscipline,
  );

  return {
    daysBetweenPosts: parseFloat(avgDays.toFixed(1)),
    isConsistent,
    optimizedSchedule,
    pattern,
    postsPerMonth: parseFloat(postsPerMonth.toFixed(1)),
    preferredDays: preferredDays.slice(0, 3), // 上位3つの曜日
    scheduleDiscipline: Math.round(scheduleDiscipline),
  };
}

// 最適な投稿スケジュールを計算
function calculateOptimizedSchedule(
  daysByViews: Array<{
    avgViews: number;
    count: number;
    day: number;
    dayName: string;
  }>,
  bestHours: number[],
  currentDaysBetween: number,
  isConsistent: boolean,
  currentPattern: string,
  totalVideos: number,
  disciplineScore: number,
): OptimizedSchedule {
  // データが十分にない場合のフォールバック
  if (daysByViews.length < 2 || totalVideos < 5) {
    return {
      achievableFrequency: "データ不足",
      recommendedDays: [],
      recommendedScheduleText:
        "十分なデータがないため、明確な推奨はできません。",
      sustainabilityScore: 0,
    };
  }

  // 推奨する曜日（視聴数が多い順に最大3つ）
  const recommendedDays = daysByViews.slice(0, 3).map((d) => d.dayName);

  // 現在のパターンと投稿の安定性に基づいて達成可能な頻度を提案
  let achievableFrequency: string;
  let sustainabilityScore: number = 0;

  if (currentDaysBetween <= 2.5) {
    // 現在が高頻度の場合
    if (disciplineScore > 70) {
      // 規律性が高い場合は維持
      achievableFrequency = "現在の頻度（" + currentPattern + "）を維持";
      sustainabilityScore = 80;
    } else {
      // 規律性が低い場合は少し減らす
      achievableFrequency = "週3-4回";
      sustainabilityScore = 60;
    }
  } else if (currentDaysBetween <= 7) {
    // 中頻度の場合
    if (disciplineScore > 60) {
      achievableFrequency = "現在の頻度（" + currentPattern + "）を維持";
      sustainabilityScore = 85;
    } else {
      // 規律性に少し問題がある場合
      achievableFrequency = currentDaysBetween <= 4 ? "週2回" : "週1回";
      sustainabilityScore = 70;
    }
  } else {
    // 低頻度の場合
    // 投稿間隔を少し短くする（質を保ちながら）
    const newInterval = Math.max(5, currentDaysBetween * 0.8);

    if (newInterval < 7) {
      achievableFrequency = "週1回";
    } else if (newInterval < 14) {
      achievableFrequency = "隔週";
    } else {
      achievableFrequency = "月1-2回";
    }

    sustainabilityScore = 75;
  }

  // 推奨時間帯の文字列を作成
  const timeRecommendation =
    bestHours.length > 0
      ? `${bestHours.map((h) => `${h}時台`).join("、")}に投稿すると効果的です。`
      : "";
  // 視聴数が多い曜日と現在多く投稿している曜日に大きな乖離がある場合の提案
  const currentTopDays = new Set(daysByViews.slice(0, 2).map((d) => d.day));
  const mostPostedDays = daysByViews
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
  const daysMismatch = mostPostedDays.some((d) => !currentTopDays.has(d.day));

  let scheduleAdjustment = "";

  if (!isConsistent && recommendedDays.length >= 2) {
    scheduleAdjustment = `現在の投稿パターンは不規則ですが、${recommendedDays.slice(0, 2).join("・")}曜日に固定すると視聴数向上が期待できます。`;
  } else if (daysMismatch) {
    // 投稿頻度が高い曜日と視聴数が高い曜日の乖離がある場合
    scheduleAdjustment = `現在は${mostPostedDays.map((d) => d.dayName).join("・")}曜日に多く投稿していますが、${recommendedDays.slice(0, 2).join("・")}曜日への移行を検討してください。`;
  }

  // 推奨スケジュールのテキスト生成
  const recommendedScheduleText =
    `分析の結果、${achievableFrequency}の投稿が最適です。特に${recommendedDays.join("・")}曜日の視聴効果が高いです。` +
    (timeRecommendation ? ` ${timeRecommendation}` : "") +
    (scheduleAdjustment ? ` ${scheduleAdjustment}` : "") +
    ` このスケジュールの持続可能性は${sustainabilityScore}/100です。`;

  return {
    achievableFrequency,
    bestHours,
    recommendedDays,
    recommendedScheduleText,
    sustainabilityScore,
  };
}

// 型定義
type OptimizedSchedule = {
  achievableFrequency: string; // 達成可能な頻度
  bestHours?: number[]; // 最適な時間帯
  recommendedDays: string[]; // 推奨する曜日
  recommendedScheduleText: string; // 推奨スケジュールの説明
  sustainabilityScore: number; // 持続可能性スコア（0-100）
};

// PostingFrequency型の拡張
type PostingFrequency = {
  daysBetweenPosts: number;
  isConsistent: boolean;
  optimizedSchedule: OptimizedSchedule; // 追加: 最適化されたスケジュール
  pattern: string;
  postsPerMonth: number;
  preferredDays: string[];
  scheduleDiscipline: number; // 追加: スケジュールの規律性スコア
};
