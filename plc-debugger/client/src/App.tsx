import { useState } from 'react';
import type { ProjectData, TabId, ChatMessage } from './types';
import Sidebar from './components/Sidebar';
import FileUpload from './components/FileUpload';
import AnalysisResult from './components/AnalysisResult';
import TroubleshootChat from './components/TroubleshootChat';
import HelpGuide from './components/HelpGuide';

export default function App() {
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('plc');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleFilesUploaded = async (files: File[]) => {
    setIsAnalyzing(true);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      setProjectData(data);
    } catch (err) {
      console.error('アップロードエラー:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (!projectData) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projectData.projectId }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('分析APIエラー:', err);
        return;
      }
      const result = await res.json();
      setProjectData((prev) => (prev ? { ...prev, analysisResult: result } : null));
    } catch (err) {
      console.error('分析エラー:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendMessage = async (message: string, images?: string[]) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      images,
      timestamp: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/troubleshoot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          images,
          history: chatMessages,
          projectId: projectData?.projectId,
        }),
      });
      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error('チャットエラー:', err);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-dark-bg text-gray-100">
      {/* 左サイドバー */}
      <Sidebar
        projectData={projectData}
        onAnalyze={handleAnalyze}
        isAnalyzing={isAnalyzing}
        onShowHelp={() => setShowHelp(true)}
      />

      {/* メインエリア */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden border-x border-dark-border">
        {!projectData ? (
          <FileUpload onFilesUploaded={handleFilesUploaded} isUploading={isAnalyzing} />
        ) : (
          <AnalysisResult
            projectData={projectData}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isAnalyzing={isAnalyzing}
          />
        )}
      </main>

      {/* 右チャットパネル */}
      <TroubleshootChat
        messages={chatMessages}
        onSendMessage={handleSendMessage}
        hasProject={!!projectData}
      />

      {/* ヘルプモーダル */}
      {showHelp && <HelpGuide onClose={() => setShowHelp(false)} />}
    </div>
  );
}
