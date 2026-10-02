import { en, type EnglishCatalog } from "../en/index.js";

export const ja: EnglishCatalog = {
  ...en,
  app: { shellName: "BoxAI Desktop", tagline: "デスクトップで使えるAIアシスタント", starting: "BoxAI Desktopを起動中…", loadingView: "読み込み中…", uiCrashed: "画面で問題が発生しました" },
  common: { close: "閉じる", cancel: "キャンセル", save: "保存", saving: "保存中…", loading: "読み込み中…" },
  window: { minimize: "最小化", maximize: "最大化", restore: "元に戻す", close: "閉じる" },
  tray: {
    running: "実行中", unread: "未読", pinned: "固定済み", viewMore: "もっと見る…", open: "BoxAI Desktopを開く", quit: "BoxAI Desktopを終了",
    askTitle: "BoxAI Desktopをバックグラウンドで実行しますか？", askBody: "ウィンドウを閉じても、システムトレイで実行を続けられます。この設定はいつでも変更できます。",
    closeToTray: "トレイに格納", confirmQuitTitle: "BoxAI Desktopを終了しますか？", confirmQuitBody: "実行中のセッションがすべて停止し、未保存の変更が失われる可能性があります。終了しますか？", confirmQuit: "終了",
  },
  menu: {
    ...en.menu, file: "ファイル", edit: "編集", view: "表示", window: "ウィンドウ", help: "ヘルプ", newTask: "新しいタスク", openProject: "プロジェクトを開く…", settings: "設定…",
    toggleWindow: "ウィンドウを表示／非表示", refreshMarket: "マーケットを更新", search: "検索…", toggleSidebar: "サイドバー", actualSize: "実際のサイズ", zoomIn: "拡大", zoomOut: "縮小",
    toggleFullScreen: "全画面表示を切り替え", toggleDevTools: "開発者ツール", appHelp: "BoxAI Desktopヘルプ", openLogs: "ログを開く", checkForUpdates: "更新を確認…",
  },
  nav: {
    ...en.nav, pinnedSessions: "固定済み", home: "ホーム", newTask: "新しいタスク", newProject: "新しいプロジェクト", projects: "プロジェクト", plugins: "拡張機能", settings: "設定", search: "検索",
    temporarySessions: "一時チャット", newTemporarySession: "新しい一時チャット", noProjectSessions: "このプロジェクトにはまだチャットがありません", noTemporarySessions: "一時チャットはまだありません",
    newChat: "新しいチャット", conversation: "会話", sessions: "セッション", collapseSidebar: "サイドバーを折りたたむ", expandSidebar: "サイドバーを展開", renameTask: "タスク名を変更",
    sessionRunning: "処理中", sessionSelected: "選択済み", sessionCompleted: "完了", sessionFailed: "確認が必要", pinTask: "固定", unpinTask: "固定を解除", archiveTask: "アーカイブ", restoreTask: "復元", deleteTask: "削除", deleteTaskConfirm: "削除しますか？",
  },
  chat: {
    ...en.chat, emptyTitle: "何を作りましょうか？", emptyTitleInProject: "{{project}}で何を作りましょうか？", emptyTitleTemporary: "何を試してみますか？", placeholder: "BoxAI Desktopに作業を依頼",
    placeholderHome: "何でも聞いてください", placeholderHint: "/ でコマンド · @ でファイル", placeholderHomeHint: "/ でコマンド · @ でファイル", placeholderShortcut: "Shift+Enterで改行 · 送信ボタンで送信",
    addFiles: "ファイルを追加", send: "送信", thinking: "思考中", thinkingShow: "思考を表示", thinkingHide: "思考を非表示", webSearching: "ウェブを検索中", webSearch: "ウェブ検索", untitledTask: "新しいタスク", modeAgent: "エージェント", modePlan: "計画", modeGoal: "目標",
  },
  settings: {
    ...en.settings, general: "一般", ai: "AI", providers: "AIプロバイダー", models: "モデル", appearance: "外観", about: "情報", theme: "テーマ", language: "言語", languageAuto: "システムに合わせる",
    languageAutoDesc: "現在: {{state}}", languageSearchPlaceholder: "言語を検索…", themeSearchPlaceholder: "テーマを検索…", application: "アプリケーション", logs: "ログ", openLogs: "ログを開く", feedback: "フィードバック",
    marketProviderOfficial: "BoxAI内蔵", marketProviderCustom: "カスタムソース",
    storage: {
      ...en.settings.storage, progressTitle: "ストレージを準備中", progressHint: "データの処理中はこのウィンドウを閉じないでください。", failedTitle: "ストレージ操作に失敗しました",
      failedHint: "既存のデータは安全です。現在の場所を使い続け、設定から再試行してください。", unavailableHint: "データフォルダーにアクセスできません。起動前にドライブを再接続してください。空のデータの作成や別の場所への切り替えは行いません。",
    },
  },
  liveVoice: {
    ...en.liveVoice, prepareCall: "音声通話を準備", details: "通話の詳細", workOptions: "作業セッションに接続", allowWork: "作業の依頼を許可", noWorkSession: "ローカルの作業セッションを選ぶか作成してください。",
    playbackBlocked: "音声が一時停止中です", playbackFailed: "音声を再開できませんでした。再試行してください。", mediaReleaseUnconfirmed: "マイクの解放を確認できません。次の通話の前にアプリを再起動してください。",
    callActionFailed: "通話を更新できませんでした。再試行するか終了してください。", workNotConnected: "この通話は作業セッションに接続されていません。", transcript: "文字起こし", transcriptEmpty: "文字起こしはまだありません",
    userSpeaking: "聞き取り中", assistantSpeaking: "発話中", muted: "マイクはミュート中", resumePlayback: "音声を再開", selectWorkSession: "次の通話で使う作業セッション", shareContext: "最近の会話の一部を共有",
    contextShared: "この通話に最近の会話の一部を共有しました。", contextNotShared: "この通話には最近の会話を共有していません。", createWorkSession: "新しい作業セッションを作成", viewWorkSession: "作業セッションを表示",
    enableDetail: "マイクの音声は選択したプロバイダーに送信されます。通話はミュート状態で始まり、現在の入力画面のセッションが作業先になります。音声でセッションを切り替えられます。既存の権限と承認画面は引き続き適用されます。",
    microphoneDenied: "ブラウザーとシステム設定でマイクを許可し、再試行してください。", microphoneUnavailable: "使用できるマイクがありません。選択した機器と接続を確認してください。", microphoneBusy: "別の録音がマイクを使用中です。録音を停止してから音声通話を開始してください。",
    phase: { ...en.liveVoice.phase, connecting: "接続中…", closing: "終了中…" },
  },
};
export default ja;
