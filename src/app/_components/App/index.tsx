"use client";
import { analyzeAndPay } from "@/app/actions";
import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import logo from "./_assets/logo.png";
import styles from "./style.module.css";

// Zodスキーマの定義
const channelFormSchema = z.object({
  channelInput: z
    .string()
    .min(1, "チャンネルIDまたはURLを入力してください")
    .refine(
      (value) => {
        // YouTubeチャンネルIDの形式（UCで始まる24文字の英数字）
        const channelIdPattern = /^UC[\w-]{22}$/;
        // YouTubeチャンネルURLの形式
        const channelUrlPatterns = [
          /youtube\.com\/channel\/UC[\w-]{22}/,
          /youtube\.com\/@[\w-]+/,
          /youtube\.com\/c\/[\w-]+/,
          /youtube\.com\/user\/[\w-]+/,
        ];

        // チャンネルIDの直接入力チェック
        if (channelIdPattern.test(value)) {
          return true;
        }

        // チャンネルURLのチェック
        return channelUrlPatterns.some((pattern) => pattern.test(value));
      },
      {
        message: "有効なYouTubeチャンネルIDまたはURLを入力してください",
      },
    ),
  modelType: z.enum(["gpt-3.5-turbo", "gpt-4-turbo"]),
  videoCount: z.enum(["25", "50", "100"]),
});

// フォームの入力値の型
type ChannelFormInputs = z.infer<typeof channelFormSchema>;

// 料金表の定義
const PRICE_TABLE = {
  "gpt-3.5-turbo": {
    "25": 400,
    "50": 600,
    "100": 900,
  },
  "gpt-4-turbo": {
    "25": 600,
    "50": 800,
    "100": 1200,
  },
};
// プラン名の定義
const PLAN_NAMES = {
  "25": "最新トレンド分析",
  "50": "標準分析",
  "100": "総合分析",
};

export default function App(): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | string>(null);
  // react-hook-form の設定（zodによるバリデーション付き）
  const {
    formState: { errors },
    handleSubmit,
    register,
    watch,
  } = useForm<ChannelFormInputs>({
    defaultValues: {
      channelInput: "",
      modelType: "gpt-4-turbo",
      videoCount: "25",
    },
    resolver: zodResolver(channelFormSchema),
  });
  // 現在選択されている値を取得
  const selectedModel = watch("modelType");
  const selectedVideoCount = watch("videoCount");
  // 現在の料金を計算
  // eslint-disable-next-line security/detect-object-injection
  const currentPrice = PRICE_TABLE[selectedModel][selectedVideoCount];
  // フォーム送信時の処理
  const onSubmit = async (data: ChannelFormInputs): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      // 統合されたサーバーアクションを呼び出し
      // 分析実行→Stripe決済→リダイレクト
      await analyzeAndPay({
        channelInput: data.channelInput,
        modelType: data.modelType,
        videoCount: parseInt(data.videoCount),
      });

      // 注意: ここには到達しない（リダイレクトされるため）
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "処理中にエラーが発生しました",
      );
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.titleContainer}>
        <h1 className={styles.title}>YouTube Growth</h1>
        <Image alt="YouTube Growth" height={50} src={logo} width={200} />
      </div>
      <form
        className={styles.form}
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className={styles.inputGroup}>
          <label className={styles.label} htmlFor="channelInput">
            <a
              className={styles.link}
              href="https://www.youtube.com/account_advanced"
              rel="noopener noreferrer"
              target="_blank"
            >
              チャンネルID
            </a>
            またはURL
          </label>
          <div className={styles.inputWrapper}>
            <input
              className={styles.input}
              disabled={loading}
              id="channelInput"
              placeholder="例: UC--... または https://www.youtube.com/channel/..."
              {...register("channelInput")}
            />
          </div>
          {errors.channelInput && (
            <p className={styles.errorText}>{errors.channelInput.message}</p>
          )}
        </div>
        <div className={styles.optionsContainer}>
          <div className={styles.optionGroup}>
            <label className={styles.optionLabel}>AIモデル</label>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  {...register("modelType")}
                  className={styles.radioInput}
                  disabled={loading}
                  value="gpt-4-turbo"
                />
                <span className={styles.radioText}>GPT-4 Turbo</span>
                <span className={styles.radioHint}>（高精度）</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  {...register("modelType")}
                  className={styles.radioInput}
                  disabled={loading}
                  value="gpt-3.5-turbo"
                />
                <span className={styles.radioText}>GPT-3.5 Turbo</span>
                <span className={styles.radioHint}>（標準）</span>
              </label>
            </div>
          </div>
          <div className={styles.optionGroup}>
            <label className={styles.optionLabel}>分析動画数</label>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  {...register("videoCount")}
                  className={styles.radioInput}
                  disabled={loading}
                  value="25"
                />
                <span className={styles.radioText}>25本</span>
                <span className={styles.radioHint}>（最新動向）</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  {...register("videoCount")}
                  className={styles.radioInput}
                  disabled={loading}
                  value="50"
                />
                <span className={styles.radioText}>50本</span>
                <span className={styles.radioHint}>（標準分析）</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  {...register("videoCount")}
                  className={styles.radioInput}
                  disabled={loading}
                  value="100"
                />
                <span className={styles.radioText}>100本</span>
                <span className={styles.radioHint}>（詳細分析）</span>
              </label>
            </div>
          </div>
        </div>
        <div className={styles.priceContainer}>
          <div className={styles.priceDetails}>
            <div className={styles.planName}>
              {
                // eslint-disable-next-line security/detect-object-injection
                PLAN_NAMES[selectedVideoCount]
              }
              （{selectedVideoCount}本、
              {selectedModel === "gpt-4-turbo"
                ? "GPT-4 Turbo"
                : "GPT-3.5 Turbo"}
              ）
            </div>
            <div className={styles.priceAmount}>
              <span className={styles.currency}>¥</span>
              <span className={styles.priceValue}>
                {currentPrice.toLocaleString()}
              </span>
              <span className={styles.priceTax}>（税込）</span>
            </div>
          </div>
          <p className={styles.priceInfo}>
            ※ボタンをクリックすると分析後に決済ページに移動します
          </p>
          <p className={styles.priceInfo}>
            ※本サービスはα版のため、今後仕様や価格が変更される可能性があります
          </p>
        </div>
        <div className={styles.buttonGroup}>
          <button
            className={`${styles.button} ${loading ? styles.buttonDisabled : ""}`}
            disabled={loading}
            type="submit"
          >
            {loading ? "処理中..." : "分析開始"}
          </button>
        </div>
      </form>
      {error && (
        <div className={styles.error}>
          <p className={styles.errorMessage}>{error}</p>
        </div>
      )}
    </div>
  );
}
