/* eslint-disable security/detect-object-injection */
"use server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { channelId as getYoutubeIdByUrl } from "@gonetone/get-youtube-id-by-url";
import console from "console";
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

type TitleAnalysis = {
  avgLength: number;
  highWords: WordInfo[];
  lowWords: WordInfo[];
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

type DurationAnalysis = {
  avgMinutes: number;
  best: VideoInfo[];
};

type TrendAnalysis = {
  change: number;
  newAvg: number;
  oldAvg: number;
};

type PostingFrequency = {
  daysBetweenPosts: number;
  isConsistent: boolean;
  pattern: string;
  postsPerMonth: number;
  preferredDays: string[];
};

type ContentCategory = {
  commonFormats: Record<string, number>;
  format: string;
  themes: string[];
  topFormat: string;
};

type AnalysisResult = {
  categories: ContentCategory;
  channel: ChannelInfo;
  count: number;
  duration: DurationAnalysis;
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
type AnalysisProgressData = {
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
    processAnalysisAfterPayment(sessionId).catch((error) => {
      console.error("分析処理に失敗:", error);
    });
  } catch (error) {
    console.error("決済完了処理中にエラーが発生しました:", error);
    throw new Error("決済後の処理に失敗しました");
  }
}

// 支払い後に分析を実行する関数
async function processAnalysisAfterPayment(sessionId: string): Promise<void> {
  try {
    const record = await prisma.analysis.findUnique({
      where: { id: sessionId },
    });

    if (!record || !record.isPaid) {
      throw new Error("有効な決済レコードが見つかりません");
    }

    const currentData = record.analysisData as unknown as AnalysisProgressData;
    // 分析ステータスを更新
    const updatedData: AnalysisProgressData = {
      ...currentData,
      status: "ANALYZING",
    };
    // 保存されているオプションを取得、またはデフォルト値を使用
    const options = currentData.options || {
      modelType: "gpt-4-turbo",
      videoCount: 25,
    };

    await prisma.analysis.update({
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysisData: updatedData as any,
        // モデルタイプと動画数を直接フィールドにも保存
        modelType: options.modelType,
        videoCount: options.videoCount,
      },
      where: { id: sessionId },
    });

    // チャンネル分析を実行（オプションを渡す）
    const analysisResult = await analyzeChannel(record.channelInput, options);

    // 分析結果をDBに保存
    await prisma.analysis.update({
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysisData: analysisResult as any,
      },
      where: { id: sessionId },
    });
  } catch (error) {
    console.error("分析実行中にエラーが発生しました:", error);

    const record = await prisma.analysis.findUnique({
      where: { id: sessionId },
    });

    if (!record) {
      throw new Error("分析レコードが見つかりません");
    }

    const currentData = record.analysisData as unknown as AnalysisProgressData;
    // エラー状態を保存
    const errorData: AnalysisProgressData = {
      ...currentData,
      error: error instanceof Error ? error.message : String(error),
      status: "FAILED",
    };

    await prisma.analysis.update({
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysisData: errorData as any,
      },
      where: { id: sessionId },
    });

    // 返金処理を実行
    await refundFailedAnalysis(sessionId);
  }
}

// 分析失敗時の返金処理
async function refundFailedAnalysis(sessionId: string): Promise<void> {
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
async function analyzeChannel(
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

// データ分析（クライアント側でも実行可能な純粋関数）
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

// タイトルの分析
// タイトルの分析
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

  // フォールバック: 高評価単語が見つからない場合は全動画から抽出
  if (highWords.length === 0 && videos.length > 0) {
    const allWords = wordCounter(videos.map((v) => v.title));

    return {
      avgLength,
      highWords: allWords.slice(0, 10),
      lowWords: wordCounter(bottom.map((v) => v.title)).slice(0, 10),
    };
  }

  return {
    avgLength,
    highWords: highWords.slice(0, 10),
    lowWords: wordCounter(bottom.map((v) => v.title)).slice(0, 10),
  };
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

// 動画長分析
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

  return {
    avgMinutes: stats.mean(
      withDuration.map((v) => v.minutes || 0).filter(Boolean),
    ),
    best: byViews.slice(0, 5),
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

// 投稿頻度分析
function analyzePostingFrequency(videos: VideoInfo[]): PostingFrequency {
  if (videos.length < 3) {
    return {
      daysBetweenPosts: 0,
      isConsistent: false,
      pattern: "不明",
      postsPerMonth: 0,
      preferredDays: [],
    };
  }

  // 日付でソート
  const byDate = [...videos].sort(
    (a, b) => new Date(a.published).getTime() - new Date(b.published).getTime(),
  );
  // 投稿間の日数を計算
  const daysBetween: number[] = [];

  for (let i = 1; i < byDate.length; i++) {
    const curr = new Date(byDate[i].published);
    const prev = new Date(byDate[i - 1].published);
    const diffTime = Math.abs(curr.getTime() - prev.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    daysBetween.push(diffDays);
  }

  // 平均日数と標準偏差
  const avgDays = stats.mean(daysBetween);
  const stdDev = stats.stdDev(daysBetween);
  const isConsistent = stdDev < avgDays * 0.5; // 標準偏差が平均の50%未満なら一貫していると判断
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

  // 優先的に投稿している曜日を分析
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const dayCount: Record<string, number> = {};

  dayNames.forEach((day) => (dayCount[day] = 0));

  videos.forEach((video) => {
    const date = new Date(video.published);
    const day = dayNames[date.getDay()];

    dayCount[day]++;
  });

  // 投稿数の多い曜日をソート
  const preferredDays = Object.entries(dayCount)
    .sort((a, b) => b[1] - a[1])
    .filter(([, count]) => count > 0)
    .map(([day]) => day);

  return {
    daysBetweenPosts: parseFloat(avgDays.toFixed(1)),
    isConsistent,
    pattern,
    postsPerMonth: parseFloat(postsPerMonth.toFixed(1)),
    preferredDays: preferredDays.slice(0, 3), // 上位3つの曜日
  };
}

// コンテンツカテゴリ分析
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
  // 各フォーマットの出現回数をカウント
  const formatCounts: Record<string, number> = {};

  videos.forEach((video) => {
    let detected = false;

    // タイトルとタグを結合してチェック
    const content = video.title + " " + video.tags.join(" ");

    for (const [format, patterns] of Object.entries(formatPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          formatCounts[format] = (formatCounts[format] || 0) + 1;
          detected = true;

          break;
        }
      }

      if (detected) break;
    }

    // 検出できなかった場合は「その他」としてカウント
    if (!detected) {
      formatCounts["other"] = (formatCounts["other"] || 0) + 1;
    }
  });

  // 最も多いフォーマットを特定
  const sortedFormats = Object.entries(formatCounts).sort(
    (a, b) => b[1] - a[1],
  );
  const topFormat = sortedFormats.length > 0 ? sortedFormats[0][0] : "不明";
  // 人気タグからテーマを特定
  const themes = videos
    .flatMap((v) => v.tags)
    .filter((tag, i, self) => self.indexOf(tag) === i)
    .slice(0, 10);

  return {
    commonFormats: formatCounts,
    format: topFormat,
    themes,
    topFormat,
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
