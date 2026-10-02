import { en, type EnglishCatalog } from "../en/index.js";

export const ru: EnglishCatalog = {
  ...en,
  app: { shellName: "BoxAI Desktop", tagline: "ИИ-помощник на вашем компьютере", starting: "Запуск BoxAI Desktop…", loadingView: "Загрузка…", uiCrashed: "Ошибка интерфейса" },
  common: { close: "Закрыть", cancel: "Отмена", save: "Сохранить", saving: "Сохранение…", loading: "Загрузка…" },
  window: { minimize: "Свернуть", maximize: "Развернуть", restore: "Восстановить", close: "Закрыть" },
  tray: {
    running: "Выполняется", unread: "Не прочитано", pinned: "Закреплено", viewMore: "Показать ещё…", open: "Открыть BoxAI Desktop", quit: "Выйти из BoxAI Desktop",
    askTitle: "Оставить BoxAI Desktop работать в фоне?", askBody: "После закрытия окна приложение может продолжить работу в системном трее. Это можно изменить в настройках.",
    closeToTray: "Свернуть в трей", confirmQuitTitle: "Выйти из BoxAI Desktop?", confirmQuitBody: "Все активные сеансы будут остановлены. Несохранённые изменения могут быть потеряны. Выйти?", confirmQuit: "Выйти",
  },
  menu: {
    ...en.menu, file: "Файл", edit: "Правка", view: "Вид", window: "Окно", help: "Справка", newTask: "Новая задача", openProject: "Открыть проект…", settings: "Настройки…",
    toggleWindow: "Показать/скрыть окно", refreshMarket: "Обновить каталог", search: "Поиск…", toggleSidebar: "Боковая панель", actualSize: "Исходный размер", zoomIn: "Увеличить", zoomOut: "Уменьшить",
    toggleFullScreen: "Полноэкранный режим", toggleDevTools: "Инструменты разработчика", appHelp: "Справка BoxAI Desktop", openLogs: "Открыть журнал", checkForUpdates: "Проверить обновления…",
  },
  nav: {
    ...en.nav, pinnedSessions: "Закреплённые", home: "Главная", newTask: "Новая задача", newProject: "Новый проект", projects: "Проекты", plugins: "Расширения", settings: "Настройки", search: "Поиск",
    temporarySessions: "Временные чаты", newTemporarySession: "Новый временный чат", noProjectSessions: "В этом проекте пока нет чатов", noTemporarySessions: "Временных чатов пока нет", newChat: "Новый чат", conversation: "Беседа", sessions: "Сеансы",
    collapseSidebar: "Свернуть панель", expandSidebar: "Развернуть панель", renameTask: "Переименовать задачу", sessionRunning: "В работе", sessionSelected: "Выбрано", sessionCompleted: "Готово", sessionFailed: "Требует внимания",
    pinTask: "Закрепить", unpinTask: "Открепить", archiveTask: "В архив", restoreTask: "Восстановить", deleteTask: "Удалить", deleteTaskConfirm: "Удалить?",
  },
  chat: {
    ...en.chat, emptyTitle: "Что вы хотите создать?", emptyTitleInProject: "Что создадим в {{project}}?", emptyTitleTemporary: "Что вы хотите попробовать?", placeholder: "Поручите задачу BoxAI Desktop", placeholderHome: "Задайте любой вопрос",
    placeholderHint: "/ — команды · @ — файлы", placeholderHomeHint: "/ — команды · @ — файлы", placeholderShortcut: "Shift+Enter — новая строка · Кнопка «Отправить» — отправка",
    addFiles: "Добавить файлы", send: "Отправить", thinking: "Обдумываю", thinkingShow: "Показать рассуждения", thinkingHide: "Скрыть рассуждения", webSearching: "Поиск в интернете", webSearch: "Веб-поиск", untitledTask: "Новая задача", modeAgent: "Агент", modePlan: "План", modeGoal: "Цель",
  },
  settings: {
    ...en.settings, general: "Общие", ai: "ИИ", providers: "Провайдеры ИИ", models: "Модели", appearance: "Оформление", about: "Информация", theme: "Тема", language: "Язык", languageAuto: "Как в системе", languageAutoDesc: "Сейчас: {{state}}",
    languageSearchPlaceholder: "Поиск языка…", themeSearchPlaceholder: "Поиск темы…", application: "Приложение", logs: "Журнал", openLogs: "Открыть журнал", feedback: "Обратная связь", marketProviderOfficial: "Встроенный каталог BoxAI", marketProviderCustom: "Свой источник",
    storage: {
      ...en.settings.storage, progressTitle: "Подготовка хранилища", progressHint: "Не закрывайте окно, пока идёт обработка данных.", failedTitle: "Ошибка операции с хранилищем",
      failedHint: "Ваши данные сохранены. Продолжайте использовать текущее расположение и повторите попытку в настройках.", unavailableHint: "Папка данных недоступна. Подключите диск перед запуском. Приложение не создаст пустые данные и не переключится на другую папку.",
    },
  },
  liveVoice: {
    ...en.liveVoice, prepareCall: "Подготовить голосовой разговор", details: "Сведения о звонке", workOptions: "Подключить рабочий сеанс", allowWork: "Разрешить рабочие запросы", noWorkSession: "Выберите или создайте локальный рабочий сеанс.",
    playbackBlocked: "Звук приостановлен", playbackFailed: "Не удалось включить звук. Повторите попытку.", mediaReleaseUnconfirmed: "Не удалось подтвердить освобождение микрофона. Перезапустите приложение перед следующим звонком.",
    callActionFailed: "Не удалось обновить звонок. Повторите попытку или завершите его.", workNotConnected: "Звонок не подключён к рабочему сеансу.", transcript: "Расшифровка", transcriptEmpty: "Расшифровки пока нет", userSpeaking: "Слушаю", assistantSpeaking: "Говорю", muted: "Микрофон выключен", resumePlayback: "Включить звук",
    selectWorkSession: "Рабочий сеанс для следующего звонка", shareContext: "Поделиться частью недавней беседы", contextShared: "Часть недавней беседы передана в этот звонок.", contextNotShared: "Недавняя беседа не передана в этот звонок.", createWorkSession: "Создать рабочий сеанс", viewWorkSession: "Открыть рабочий сеанс",
    enableDetail: "Звук микрофона передаётся выбранному провайдеру. Звонки начинаются с выключенным микрофоном; текущий сеанс ввода используется как рабочий. Сеансы можно переключать голосом. Действующие разрешения и подтверждения сохраняются.",
    microphoneDenied: "Разрешите доступ к микрофону в браузере и настройках системы, затем повторите попытку.", microphoneUnavailable: "Доступный микрофон не найден. Проверьте выбранное устройство и подключение.", microphoneBusy: "Микрофон занят другой записью. Остановите её перед началом голосового разговора.",
    phase: { ...en.liveVoice.phase, connecting: "Подключение…", closing: "Завершение…" },
  },
};
export default ru;
