import type { ProjectData } from '../types';

interface Props {
  projectData: ProjectData | null;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  onShowHelp: () => void;
}

export default function Sidebar({ projectData, onAnalyze, isAnalyzing, onShowHelp }: Props) {
  const project = projectData?.smc2Project;

  return (
    <aside className="w-64 flex-shrink-0 bg-dark-surface flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="p-4 border-b border-dark-border">
        <h1 className="text-lg font-bold text-white">PLC Debugger</h1>
        <p className="text-xs text-gray-400 mt-1">Sysmac Studio 解析ツール</p>
      </div>

      {/* プロジェクト情報 */}
      {project && (
        <div className="p-4 border-b border-dark-border">
          <h2 className="text-sm font-semibold text-gray-300 mb-2">プロジェクト情報</h2>
          <div className="space-y-1 text-xs text-gray-400">
            <p>コントローラ: <span className="text-white">{project.projectInfo.controller}</span></p>
            <p>プログラム: <span className="text-white">{project.programs.length}個</span></p>
            <p>変数: <span className="text-white">{project.variables.length}個</span></p>
            <p>HMI画面: <span className="text-white">{project.hmi.screens.length}個</span></p>
          </div>
        </div>
      )}

      {/* ファイル一覧 */}
      {projectData && (
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-2">アップロード済みファイル</h2>
          <ul className="space-y-1">
            {projectData.files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-xs text-gray-400 py-1">
                <FileIcon type={f.type} />
                <span className="truncate" title={f.name}>{f.name}</span>
              </li>
            ))}
          </ul>

          {/* プログラム一覧 */}
          {project && project.programs.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-gray-300 mb-1">プログラム</h3>
              <ul className="space-y-1">
                {project.programs.map((p) => (
                  <li key={p.name} className="text-xs text-gray-400 flex items-center gap-1">
                    <span className="inline-block w-5 text-center text-[10px] rounded bg-plc/20 text-plc">{p.language}</span>
                    {p.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* HMI画面一覧 */}
          {project && project.hmi.screens.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-gray-300 mb-1">HMI画面</h3>
              <ul className="space-y-1">
                {project.hmi.screens.map((s) => (
                  <li key={s.id} className="text-xs text-gray-400 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-hmi" />
                    {s.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* アクションボタン */}
      <div className="p-4 border-t border-dark-border space-y-2">
        {projectData && (
          <button
            onClick={onAnalyze}
            disabled={isAnalyzing}
            className="w-full py-2 px-4 bg-plc hover:bg-plc/80 disabled:opacity-50 rounded text-sm font-medium text-white transition"
          >
            {isAnalyzing ? '分析中...' : 'バグ分析実行'}
          </button>
        )}
        <button
          onClick={onShowHelp}
          className="w-full py-2 px-4 bg-dark-hover hover:bg-dark-border rounded text-sm text-gray-300 transition"
        >
          使い方ガイド
        </button>
      </div>
    </aside>
  );
}

function FileIcon({ type }: { type: string }) {
  const colors: Record<string, string> = {
    smc2: 'text-green-400',
    csv: 'text-yellow-400',
    st: 'text-blue-400',
    txt: 'text-blue-400',
    pdf: 'text-red-400',
    image: 'text-purple-400',
  };
  const labels: Record<string, string> = {
    smc2: 'SMC',
    csv: 'CSV',
    st: 'ST',
    txt: 'TXT',
    pdf: 'PDF',
    image: 'IMG',
  };
  return (
    <span className={`text-[10px] font-mono ${colors[type] || 'text-gray-500'}`}>
      [{labels[type] || '???'}]
    </span>
  );
}
