import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Smc2Project } from './smc2Parser';

const MODEL = 'gemini-2.5-flash';

// バグ分析用システムプロンプト
const BUG_ANALYSIS_SYSTEM_PROMPT = `あなたはオムロン Sysmac Studio（NJ/NXシリーズ）専門のPLCプログラム＋HMI画面解析エンジニアです。
15年以上の制御設計経験を持ち、自動車・半導体・食品業界の生産設備を手掛けてきました。
PLCプログラムだけでなく、NA-series HMI画面設計にも精通しています。

【チェック観点 — PLC】
1. 論理エラー（条件の矛盾、到達不能コード、デッドロック）
2. タイミング問題（タスク周期との不整合、競合、優先度逆転）
3. エラーハンドリング不足（通信エラー、軸エラー、異常復帰）
4. 安全上の問題（非常停止処理、インターロック欠落）
5. モーション制御の状態遷移不備
6. 二重コイル・変数競合
7. データ型の不一致・オーバーフロー
8. 保守性の問題（マジックナンバー、命名規則違反）

【チェック観点 — HMI】
9. PLC↔HMI変数バインドの整合性（存在チェック、型一致、レンジ一致）
10. 画面遷移の完全性（到達不能画面、戻れない画面、異常時遷移）
11. 操作安全性（危険操作の確認UI、非常停止の全画面アクセス、権限設定）
12. アラーム網羅性（PLCエラーフラグとHMIアラームの対応漏れ）
13. 表示/UXの問題（スクリーンショット提供時のみ）
14. データログ設定の妥当性

【出力ルール】
- 結果は指定のJSON形式で出力
- 各issueに domain フィールド（"plc" / "hmi" / "hmi-plc-cross"）を付与
- 画面遷移図を screenTransitionDiagram フィールドに Mermaid 形式で出力
- PLC↔HMI クロスリファレンスサマリーを hmiAnalysis フィールドに出力
- 推測や仮定がある場合は必ず明記
- 問題がない場合は「問題なし」と明記（無理に問題を作らない）`;

const TROUBLESHOOT_SYSTEM_PROMPT = `あなたはオムロン PLC + HMI のトラブルシューティング専門家です。
現場での対応経験が豊富で、プログラム・HMI・電気・機械の全方面から原因を切り分けできます。

【回答ルール】
1. まず現象の整理と確認すべき前提条件を述べる
2. 原因候補を可能性の高い順に最大5つ列挙（高/中/低）
3. 各候補に対して確認手順と対策案を提示
4. HMI固有の問題も考慮する
5. プログラム以外の原因（配線、センサ故障、機械的問題）も必ず言及
6. 情報不足の場合は何を確認すべきか質問を返す`;

export class ClaudeService {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  // バグ分析
  async analyzeBugs(project: Smc2Project): Promise<any> {
    const context = this.buildProjectContext(project);

    const model = this.genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: BUG_ANALYSIS_SYSTEM_PROMPT,
    });

    const prompt = `以下のPLC + HMIプロジェクトを分析し、バグ・潜在的問題を検出してください。

${context}

以下のJSON形式で結果を出力してください:
{
  "projectSummary": {
    "controller": "コントローラ型番",
    "programCount": 数値,
    "variableCount": 数値,
    "axisCount": 数値,
    "taskCount": 数値,
    "hmiScreenCount": 数値,
    "hmiAlarmCount": 数値,
    "sourceTypes": ["smc2"],
    "analysisConfidence": "high"
  },
  "issues": [
    {
      "id": "ISS-001",
      "severity": "critical|warning|info",
      "category": "カテゴリ名",
      "domain": "plc|hmi|hmi-plc-cross",
      "location": "場所",
      "variable": "変数名",
      "description": "問題の説明",
      "suggestion": "改善提案",
      "relatedVariables": ["変数1"],
      "relatedScreens": ["画面名"],
      "reference": "参照規格"
    }
  ],
  "hmiAnalysis": {
    "screenTransitionDiagram": "graph TD\\n  A[画面A] --> B[画面B]",
    "crossReference": {
      "plcVariablesUsedInHmi": 数値,
      "plcVariablesNotInHmi": 数値,
      "hmiVariablesNotInPlc": 数値,
      "unmatchedTypes": 数値
    },
    "alarmCoverage": {
      "plcErrorFlags": 数値,
      "hmiAlarmsDefined": 数値,
      "uncoveredErrors": ["変数名"]
    }
  },
  "statistics": {
    "critical": 数値,
    "warning": 数値,
    "info": 数値,
    "byDomain": {
      "plc": {"critical": 0, "warning": 0, "info": 0},
      "hmi": {"critical": 0, "warning": 0, "info": 0},
      "hmi-plc-cross": {"critical": 0, "warning": 0, "info": 0}
    }
  }
}

JSONのみ出力してください。`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('Gemini API レスポンスのJSONパース失敗:', err);
    }

    return {
      projectSummary: {
        controller: project.projectInfo.controller,
        programCount: project.programs.length,
        variableCount: project.variables.length,
        axisCount: project.axes.length,
        taskCount: project.tasks.length,
        hmiScreenCount: project.hmi.screens.length,
        hmiAlarmCount: project.hmi.alarms.length,
        sourceTypes: ['smc2'],
        analysisConfidence: 'low',
      },
      issues: [],
      statistics: { critical: 0, warning: 0, info: 0, byDomain: {} },
    };
  }

  // トラブルシュート
  async troubleshoot(
    message: string,
    project: Smc2Project | null,
    history: { role: 'user' | 'assistant'; content: string }[],
    images?: string[],
  ): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: TROUBLESHOOT_SYSTEM_PROMPT,
    });

    // 会話履歴を構築
    const chatHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

    // プロジェクトコンテキスト
    if (project && history.length === 0) {
      const context = this.buildProjectContext(project);
      chatHistory.push({
        role: 'user',
        parts: [{ text: `以下のPLCプロジェクトデータを参考にトラブルシューティングしてください:\n\n${context}` }],
      });
      chatHistory.push({
        role: 'model',
        parts: [{ text: 'プロジェクトデータを確認しました。不具合の現象を教えてください。' }],
      });
    }

    // 過去の会話
    for (const msg of history) {
      chatHistory.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    const chat = model.startChat({ history: chatHistory });

    // 画像付きメッセージ対応
    const parts: any[] = [];
    if (images) {
      for (const img of images) {
        const base64Match = img.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
        if (base64Match) {
          parts.push({
            inlineData: {
              mimeType: base64Match[1] === 'jpg' ? 'image/jpeg' : `image/${base64Match[1]}`,
              data: base64Match[2],
            },
          });
        }
      }
    }
    parts.push({ text: message });

    const result = await chat.sendMessage(parts);
    return result.response.text() || '応答を生成できませんでした。';
  }

  // プロジェクトデータをテキスト化
  private buildProjectContext(project: Smc2Project): string {
    const sections: string[] = [];

    sections.push(`## プロジェクト情報
- コントローラ: ${project.projectInfo.controller}
- バージョン: ${project.projectInfo.version}
- HMI含有: ${project.projectInfo.hasHmi ? 'はい' : 'いいえ'}`);

    // プログラム一覧
    if (project.programs.length > 0) {
      sections.push(`## プログラム一覧 (${project.programs.length}個)`);
      for (const p of project.programs) {
        const source = p.source.length > 3000 ? p.source.substring(0, 3000) + '\n... (省略)' : p.source;
        sections.push(`### ${p.name} (${p.language})\n\`\`\`\n${source}\n\`\`\``);
      }
    }

    // グローバル変数（先頭100件）
    const globalVars = project.variables.filter((v) => v.scope === 'global');
    if (globalVars.length > 0) {
      sections.push(`## グローバル変数 (${globalVars.length}個、先頭100件表示)`);
      const displayVars = globalVars.slice(0, 100);
      sections.push('| 名前 | データ型 | アドレス | コメント | HMI使用 |');
      sections.push('|------|---------|---------|---------|---------|');
      for (const v of displayVars) {
        sections.push(`| ${v.name} | ${v.dataType} | ${v.address || ''} | ${v.comment || ''} | ${v.usedInHmi ? 'O' : ''} |`);
      }
    }

    // HMI画面
    if (project.hmi.screens.length > 0) {
      sections.push(`## HMI画面 (${project.hmi.screens.length}画面)`);
      for (const s of project.hmi.screens) {
        const elements = s.elements.map((e) => `  - ${e.type}: ${e.name || e.id}${e.variable ? ` [${e.variable}]` : ''}${e.action ? ` → ${e.action.type}` : ''}`);
        sections.push(`### ${s.name} (No.${s.screenNumber})\n要素数: ${s.elements.length}\n${elements.join('\n')}`);
      }
    }

    // 画面遷移
    if (project.hmi.screenTransitions.length > 0) {
      sections.push(`## 画面遷移`);
      for (const t of project.hmi.screenTransitions) {
        sections.push(`- ${t.fromScreen} → ${t.toScreen} (${t.trigger})`);
      }
    }

    return sections.join('\n\n');
  }
}
