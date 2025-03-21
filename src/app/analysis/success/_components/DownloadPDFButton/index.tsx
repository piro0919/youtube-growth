// eslint-disable-next-line filenames/match-exported
"use client";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import styles from "./style.module.css";

export type DownloadPDFButtonProps = {
  channelTitle: string;
};

// PDFダウンロードボタンコンポーネント
export default function DownloadPDFButton({
  channelTitle,
}: DownloadPDFButtonProps): React.JSX.Element {
  // PDF生成関数
  const generatePDF = async (): Promise<void> => {
    const reportElement = document.getElementById("analysis-report");

    if (!reportElement) return;

    try {
      // ローディング状態を表示
      const loadingElement = document.createElement("div");

      loadingElement.className = styles.loadingOverlay;
      // eslint-disable-next-line no-unsanitized/property
      loadingElement.innerHTML = `
        <div class="${styles.loadingContent}">
          <div class="${styles.loadingSpinner}"></div>
          <p>PDFを生成中...</p>
        </div>
      `;
      document.body.appendChild(loadingElement);

      // PDFを生成
      const canvas = await html2canvas(reportElement as HTMLElement, {
        allowTaint: true,
        logging: false,
        scale: 2, // 高品質な出力のため
        scrollY: -window.scrollY, // スクロール位置を考慮
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        format: "a4",
        orientation: "portrait",
        unit: "mm",
      });
      // 画像をPDFに合わせてスケーリング
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

      // 複数ページに分割して処理
      let heightLeft = pdfHeight;
      let position = 0;
      let pageNumber = 1;

      pdf.addImage(imgData, "PNG", 0, position, pdfWidth, pdfHeight);
      heightLeft -= pdf.internal.pageSize.getHeight();

      while (heightLeft >= 0) {
        position = -pdf.internal.pageSize.getHeight() * pageNumber;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, pdfWidth, pdfHeight);
        heightLeft -= pdf.internal.pageSize.getHeight();
        pageNumber++;
      }

      // ファイル名にチャンネル名と日付を含める
      const date = new Date().toLocaleDateString("ja-JP").replace(/\//g, "-");

      pdf.save(`${channelTitle}_分析レポート_${date}.pdf`);
    } catch (error) {
      console.error("PDF生成エラー:", error);
      alert("PDFの生成中にエラーが発生しました。");
    } finally {
      // ローディング表示を削除
      const loadingElement = document.querySelector(
        `.${styles.loadingOverlay}`,
      );

      if (loadingElement) {
        document.body.removeChild(loadingElement);
      }
    }
  };

  return (
    <button
      aria-label="PDFでダウンロード"
      className={styles.pdfButton}
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onClick={generatePDF}
    >
      <svg
        className={styles.downloadIcon}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
      分析レポートをPDFで保存
    </button>
  );
}
