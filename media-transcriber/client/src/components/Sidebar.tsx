import { useEffect } from 'react';
import type { HistoryItem } from '../types';

interface Props {
  isOpen: boolean;
  history: HistoryItem[];
  setHistory: (items: HistoryItem[]) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  onNewUpload: () => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Sidebar({ isOpen, history, setHistory, onSelect, onClose, onNewUpload }: Props) {
  useEffect(() => {
    if (isOpen) {
      fetch('/api/history')
        .then(res => res.json())
        .then(data => setHistory(data))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* オーバーレイ */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* サイドバー */}
      <div className="fixed left-0 top-0 bottom-0 w-80 bg-dark-surface border-r border-dark-border z-50 flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-dark-border">
          <h2 className="font-bold">録音履歴</h2>
          <button onClick={onClose} className="p-1 hover:bg-dark-hover rounded">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 新規アップロードボタン */}
        <div className="p-3">
          <button onClick={onNewUpload} className="btn-primary w-full text-sm">
            + 新規アップロード
          </button>
        </div>

        {/* 履歴リスト */}
        <div className="flex-1 overflow-auto">
          {history.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">履歴がありません</p>
          ) : (
            <div className="divide-y divide-dark-border">
              {history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className="w-full p-3 text-left hover:bg-dark-hover transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs">
                      {item.is_video ? '🎬' : '🎤'}
                    </span>
                    <span className="text-sm font-medium truncate flex-1">
                      {item.file_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{formatDate(item.created_at)}</span>
                    <span>{formatDuration(item.duration_seconds)}</span>
                    {item.has_transcription && (
                      <span className="text-green-400">文字起こし済</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
