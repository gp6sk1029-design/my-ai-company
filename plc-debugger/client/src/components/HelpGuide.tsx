interface Props {
  onClose: () => void;
}

export default function HelpGuide({ onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8" onClick={onClose}>
      <div
        className="bg-dark-surface rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-white">使い方ガイド</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>

        <div className="space-y-6 text-sm text-gray-300">
          <section>
            <h3 className="font-semibold text-white mb-2">推奨ワークフロー</h3>
            <ol className="list-decimal list-inside space-y-2">
              <li>Sysmac Studio で <code className="text-plc">.smc2</code> ファイルを保存（HMI画面定義も含まれます）</li>
              <li>変数テーブルを CSV エクスポート（マルチビュー → 変数テーブル → 右クリック → エクスポート）</li>
              <li>（推奨）HMI各画面のスクリーンショットを撮影</li>
              <li>本アプリにファイルをまとめてドラッグ&ドロップ</li>
              <li>「バグ分析」ボタンで自動分析開始</li>
              <li>HMI分析タブで画面遷移・操作安全性・アラーム網羅性を確認</li>
              <li>不具合がある場合は右パネルで現象を入力（画面キャプチャも貼付可）</li>
            </ol>
          </section>

          <section>
            <h3 className="font-semibold text-white mb-2">ファイル形式の優先度</h3>
            <div className="space-y-1">
              <p><span className="text-yellow-400">★★★</span> <code>.smc2</code> — PLC + HMI 全情報（強く推奨）</p>
              <p><span className="text-yellow-400">★★★</span> HMIスクリーンショット — ビジュアルUX分析用（.smc2と併用推奨）</p>
              <p><span className="text-yellow-400">★★☆</span> CSV変数テーブル + STテキスト — .smc2が使えない場合</p>
              <p><span className="text-yellow-400">★☆☆</span> PDF — ラダー図は精度が落ちる（最終手段）</p>
            </div>
          </section>

          <section>
            <h3 className="font-semibold text-white mb-2">分析タブの見方</h3>
            <ul className="space-y-1">
              <li><span className="text-plc font-medium">PLC分析</span> — プログラムのバグ・問題点</li>
              <li><span className="text-hmi font-medium">HMI分析</span> — HMI画面単体の問題点</li>
              <li><span className="text-cross font-medium">クロスリファレンス</span> — PLC↔HMI間の整合性</li>
              <li><span className="text-hmi font-medium">画面遷移図</span> — Mermaid形式のダイアグラム</li>
              <li><span className="text-purple-400 font-medium">スクリーンショット</span> — 画像のビジュアル分析</li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold text-white mb-2">severity（重要度）</h3>
            <ul className="space-y-1">
              <li><span className="text-severity-critical font-medium">CRITICAL</span> — 安全性に関わる重大な問題</li>
              <li><span className="text-severity-warning font-medium">WARNING</span> — 潜在的な不具合・改善推奨</li>
              <li><span className="text-severity-info font-medium">INFO</span> — 保守性・可読性の改善提案</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
