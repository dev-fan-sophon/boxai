/**
 * BoxAI icon system.
 *
 * Every UI glyph in the app comes from this module. It is backed by Phosphor
 * Icons (one consistent 256-grid geometry, six weights) and re-exports each
 * glyph under the semantic name the codebase uses, so the library behind the
 * names can be retuned in one place. Defaults (weight, size) are set once by
 * the IconContext provider in `src/main.tsx`; pass `weight` to override a
 * single glyph, e.g. `weight="fill"` for an active nav item.
 *
 * Brand/provider logos are not icons: use `LobeIcon` or `react-icons/si`.
 */
export type {
  Icon as IconComponent,
  IconProps,
  IconWeight,
} from '@phosphor-icons/react'
export { IconContext } from '@phosphor-icons/react'
export { AlignCenterHorizontalSimpleIcon as AlignHorizontalDistributeCenter } from '@phosphor-icons/react'
export { AlignCenterVerticalSimpleIcon as AlignVerticalDistributeCenter } from '@phosphor-icons/react'
export { AppleLogoIcon as Apple } from '@phosphor-icons/react'
export { ArchiveIcon as Archive } from '@phosphor-icons/react'
export {
  ArrowClockwiseIcon as RefreshCw,
  ArrowClockwiseIcon as RotateCw,
} from '@phosphor-icons/react'
export {
  ArrowCounterClockwiseIcon as RefreshCcw,
  ArrowCounterClockwiseIcon as RefreshCcwIcon,
  ArrowCounterClockwiseIcon as RotateCcw,
} from '@phosphor-icons/react'
export {
  ArrowDownIcon as ArrowDown,
  ArrowDownIcon,
} from '@phosphor-icons/react'
export { ArrowDownRightIcon as ArrowDownRight } from '@phosphor-icons/react'
export { ArrowLeftIcon as ArrowLeft } from '@phosphor-icons/react'
export {
  ArrowLineDownIcon as ArrowDownFromLine,
  ArrowLineDownIcon as ArrowDownToLine,
} from '@phosphor-icons/react'
export { ArrowLineUpIcon as ArrowUpFromLine } from '@phosphor-icons/react'
export { ArrowRightIcon as ArrowRight } from '@phosphor-icons/react'
export {
  ArrowSquareOutIcon as ExternalLink,
  ArrowSquareOutIcon as ExternalLinkIcon,
} from '@phosphor-icons/react'
export { ArrowUUpLeftIcon as Undo2 } from '@phosphor-icons/react'
export { ArrowUUpRightIcon as Redo2 } from '@phosphor-icons/react'
export { ArrowUpIcon as ArrowUp } from '@phosphor-icons/react'
export { ArrowUpRightIcon as ArrowUpRight } from '@phosphor-icons/react'
export { ArrowsDownUpIcon as ArrowUpDown } from '@phosphor-icons/react'
export { ArrowsLeftRightIcon as ArrowRightLeft } from '@phosphor-icons/react'
export {
  ArrowsOutIcon as Expand,
  ArrowsOutIcon as Maximize,
} from '@phosphor-icons/react'
export { ArrowsOutCardinalIcon as Move } from '@phosphor-icons/react'
export { ArrowsOutSimpleIcon as Maximize2 } from '@phosphor-icons/react'
export { BankIcon as Landmark } from '@phosphor-icons/react'
export { BellIcon as Bell } from '@phosphor-icons/react'
export { BookIcon } from '@phosphor-icons/react'
export { BookOpenIcon as BookOpen } from '@phosphor-icons/react'
export { BooksIcon as Library } from '@phosphor-icons/react'
export { BracketsCurlyIcon as Braces } from '@phosphor-icons/react'
export { BrainIcon as Brain, BrainIcon } from '@phosphor-icons/react'
export { BroadcastIcon as RadioTower } from '@phosphor-icons/react'
export { BuildingsIcon as Building2 } from '@phosphor-icons/react'
export { CalendarIcon as Calendar } from '@phosphor-icons/react'
export {
  CalendarDotsIcon as CalendarClock,
  CalendarDotsIcon as CalendarDays,
} from '@phosphor-icons/react'
export { CameraIcon as Camera } from '@phosphor-icons/react'
export { CardholderIcon as WalletCards } from '@phosphor-icons/react'
export { CaretDoubleLeftIcon as ChevronsLeft } from '@phosphor-icons/react'
export { CaretDoubleRightIcon as ChevronsRight } from '@phosphor-icons/react'
export {
  CaretDownIcon as ChevronDown,
  CaretDownIcon as ChevronDownIcon,
} from '@phosphor-icons/react'
export { CaretLeftIcon as ChevronLeft } from '@phosphor-icons/react'
export {
  CaretRightIcon as ChevronRight,
  CaretRightIcon as ChevronRightIcon,
} from '@phosphor-icons/react'
export { CaretUpIcon as ChevronUp } from '@phosphor-icons/react'
export { CaretUpDownIcon as ChevronsUpDown } from '@phosphor-icons/react'
export {
  ChartBarIcon as BarChart3,
  ChartBarIcon as BarChartIcon,
  ChartBarIcon as ChartColumn,
} from '@phosphor-icons/react'
export { ChartLineUpIcon as AreaChart } from '@phosphor-icons/react'
export { ChartPieIcon as PieChart } from '@phosphor-icons/react'
export { ChatIcon as MessageSquare } from '@phosphor-icons/react'
export { ChatCenteredTextIcon as MessageSquarePlusIcon } from '@phosphor-icons/react'
export { ChatCircleIcon as MessageCircle } from '@phosphor-icons/react'
export { ChatCircleDotsIcon as MessageCircleWarning } from '@phosphor-icons/react'
export { CheckIcon as Check, CheckIcon } from '@phosphor-icons/react'
export { CheckCircleIcon as CheckCircle2 } from '@phosphor-icons/react'
export {
  CheckSquareIcon as CheckSquare,
  CheckSquareIcon as SquareCheck,
} from '@phosphor-icons/react'
export { CircleIcon as Circle } from '@phosphor-icons/react'
export {
  CircleNotchIcon as Loader2,
  CircleNotchIcon as Loader2Icon,
} from '@phosphor-icons/react'
export { CircuitryIcon as BrainCircuit } from '@phosphor-icons/react'
export { ClipboardIcon as ClipboardPaste } from '@phosphor-icons/react'
export { ClipboardTextIcon as ClipboardCopy } from '@phosphor-icons/react'
export { ClockIcon as Clock } from '@phosphor-icons/react'
export { ClockCounterClockwiseIcon as History } from '@phosphor-icons/react'
export { ClosedCaptioningIcon as Captions } from '@phosphor-icons/react'
export { CloudIcon as Cloud } from '@phosphor-icons/react'
export { CloudSlashIcon as ServerCrash } from '@phosphor-icons/react'
export { CodeIcon as Code } from '@phosphor-icons/react'
export { CodeBlockIcon as CodeSquareIcon } from '@phosphor-icons/react'
export { CodeSimpleIcon as Code2 } from '@phosphor-icons/react'
export { CoinsIcon as Coins } from '@phosphor-icons/react'
export { ColumnsIcon as Columns3 } from '@phosphor-icons/react'
export { CopyIcon as Copy, CopyIcon } from '@phosphor-icons/react'
export { CopySimpleIcon as CopyPlus } from '@phosphor-icons/react'
export { CreditCardIcon as CreditCard } from '@phosphor-icons/react'
export { CropIcon as Crop } from '@phosphor-icons/react'
export { CrownIcon as Crown } from '@phosphor-icons/react'
export { CubeIcon as Box } from '@phosphor-icons/react'
export { CurrencyCircleDollarIcon as BadgeDollarSign } from '@phosphor-icons/react'
export { CurrencyDollarIcon as DollarSign } from '@phosphor-icons/react'
export { CursorClickIcon as MousePointerClick } from '@phosphor-icons/react'
export { DatabaseIcon as Database } from '@phosphor-icons/react'
export { DevicesIcon as MonitorSmartphone } from '@phosphor-icons/react'
export { DiceFiveIcon as Dices } from '@phosphor-icons/react'
export { DotsSixVerticalIcon as GripVertical } from '@phosphor-icons/react'
export { DotsThreeIcon as MoreHorizontal } from '@phosphor-icons/react'
export {
  DownloadSimpleIcon as Download,
  DownloadSimpleIcon as DownloadIcon,
} from '@phosphor-icons/react'
export { EnvelopeIcon as Mail } from '@phosphor-icons/react'
export { EraserIcon as Eraser } from '@phosphor-icons/react'
export { EyeIcon as Eye } from '@phosphor-icons/react'
export { EyeSlashIcon as EyeOff } from '@phosphor-icons/react'
export { FileArchiveIcon as FolderArchive } from '@phosphor-icons/react'
export { FileArrowDownIcon as FileDown } from '@phosphor-icons/react'
export { FileArrowUpIcon as FileOutput } from '@phosphor-icons/react'
export { FileAudioIcon as FileAudio } from '@phosphor-icons/react'
export { FileCodeIcon as FileCode2 } from '@phosphor-icons/react'
export { FileCsvIcon as FileSpreadsheet } from '@phosphor-icons/react'
export { FileImageIcon as FileImage } from '@phosphor-icons/react'
export { FileMagnifyingGlassIcon as FileQuestion } from '@phosphor-icons/react'
export { FileTextIcon as FileText } from '@phosphor-icons/react'
export { FileXIcon as FileWarning } from '@phosphor-icons/react'
export { FilesIcon as Files } from '@phosphor-icons/react'
export { FilmSlateIcon as Clapperboard } from '@phosphor-icons/react'
export { FilmStripIcon as Film } from '@phosphor-icons/react'
export { FireIcon as Flame } from '@phosphor-icons/react'
export { FlaskIcon as FlaskConical } from '@phosphor-icons/react'
export { FloppyDiskIcon as Save } from '@phosphor-icons/react'
export { FolderLockIcon as FolderLock } from '@phosphor-icons/react'
export { FolderOpenIcon as FolderOpen } from '@phosphor-icons/react'
export {
  FolderSimpleIcon as FolderClock,
  FolderSimpleIcon as FolderDown,
} from '@phosphor-icons/react'
export { FrameCornersIcon as Frame } from '@phosphor-icons/react'
export { FunnelIcon as Filter } from '@phosphor-icons/react'
export {
  GaugeIcon as CircleGauge,
  GaugeIcon as Gauge,
} from '@phosphor-icons/react'
export { GearIcon as Settings } from '@phosphor-icons/react'
export { GearFineIcon as ServerCog } from '@phosphor-icons/react'
export { GiftIcon as Gift } from '@phosphor-icons/react'
export { GitBranchIcon as GitBranch } from '@phosphor-icons/react'
export { GlobeIcon as Globe } from '@phosphor-icons/react'
export { GraduationCapIcon } from '@phosphor-icons/react'
export {
  GridFourIcon as Grid2X2,
  GridFourIcon as Grid2x2,
  GridFourIcon as LayoutGrid,
} from '@phosphor-icons/react'
export { GridNineIcon as Grid3x3 } from '@phosphor-icons/react'
export { HardDriveIcon as HardDrive } from '@phosphor-icons/react'
export { HardDrivesIcon as Server } from '@phosphor-icons/react'
export { HashIcon as Hash } from '@phosphor-icons/react'
export { HeadphonesIcon as Headphones } from '@phosphor-icons/react'
export { HeartIcon as Heart } from '@phosphor-icons/react'
export { HeartbeatIcon as HeartPulse } from '@phosphor-icons/react'
export { HouseIcon as Home } from '@phosphor-icons/react'
export { ImageIcon as Image, ImageIcon } from '@phosphor-icons/react'
export { ImageBrokenIcon as ImageOff } from '@phosphor-icons/react'
export { ImageSquareIcon as ImagePlus } from '@phosphor-icons/react'
export { InfoIcon as Info } from '@phosphor-icons/react'
export { IntersectIcon as Blend } from '@phosphor-icons/react'
export { KeyIcon as Key } from '@phosphor-icons/react'
export { LaptopIcon as Laptop } from '@phosphor-icons/react'
export {
  LayoutIcon as Layout,
  LayoutIcon as LayoutPanelTop,
} from '@phosphor-icons/react'
export { LightbulbIcon as Lightbulb } from '@phosphor-icons/react'
export { LightningIcon as Zap } from '@phosphor-icons/react'
export { LinkIcon as Link } from '@phosphor-icons/react'
export { LinkBreakIcon as Unlink } from '@phosphor-icons/react'
export { LinkSimpleIcon as Link2 } from '@phosphor-icons/react'
export { ListIcon as List, ListIcon as Menu } from '@phosphor-icons/react'
export { ListChecksIcon as ListChecks } from '@phosphor-icons/react'
export { ListNumbersIcon as ListOrdered } from '@phosphor-icons/react'
export { ListPlusIcon as ListPlus } from '@phosphor-icons/react'
export { LockIcon as Lock } from '@phosphor-icons/react'
export { LockKeyIcon as LockKeyhole } from '@phosphor-icons/react'
export { LockOpenIcon as Unlock } from '@phosphor-icons/react'
export {
  MagicWandIcon as Wand2,
  MagicWandIcon as WandSparkles,
} from '@phosphor-icons/react'
export {
  MagnifyingGlassIcon as Search,
  MagnifyingGlassIcon as SearchIcon,
} from '@phosphor-icons/react'
export {
  MagnifyingGlassMinusIcon as SearchX,
  MagnifyingGlassMinusIcon as ZoomOut,
} from '@phosphor-icons/react'
export { MagnifyingGlassPlusIcon as ZoomIn } from '@phosphor-icons/react'
export { MaskHappyIcon as Theater } from '@phosphor-icons/react'
export { MegaphoneIcon as Megaphone } from '@phosphor-icons/react'
export {
  MicrophoneIcon as Mic,
  MicrophoneIcon as MicIcon,
} from '@phosphor-icons/react'
export { MinusIcon as Minus } from '@phosphor-icons/react'
export { MonitorIcon as Monitor } from '@phosphor-icons/react'
export { MoonIcon as Moon } from '@phosphor-icons/react'
export { MusicNoteIcon as Music } from '@phosphor-icons/react'
export { MusicNotesIcon as Music2 } from '@phosphor-icons/react'
export { NoteIcon as StickyNote } from '@phosphor-icons/react'
export { NotePencilIcon as Edit } from '@phosphor-icons/react'
export { NotepadIcon as NotepadTextIcon } from '@phosphor-icons/react'
export {
  PackageIcon as Boxes,
  PackageIcon as Package,
} from '@phosphor-icons/react'
export {
  PaintBrushIcon as Brush,
  PaintBrushIcon as Paintbrush,
} from '@phosphor-icons/react'
export { PaletteIcon as Palette } from '@phosphor-icons/react'
export {
  PaperPlaneRightIcon as Send,
  PaperPlaneRightIcon as SendIcon,
} from '@phosphor-icons/react'
export {
  PaperclipIcon as Paperclip,
  PaperclipIcon,
} from '@phosphor-icons/react'
export { KeyIcon as KeyRound } from '@phosphor-icons/react'
export { PathIcon as Route } from '@phosphor-icons/react'
export { PauseIcon as Pause } from '@phosphor-icons/react'
export { PencilLineIcon as PenLine } from '@phosphor-icons/react'
export { PencilSimpleIcon as Pencil } from '@phosphor-icons/react'
export { PianoKeysIcon as Piano } from '@phosphor-icons/react'
export { PlayIcon as Play } from '@phosphor-icons/react'
export { PlugIcon as Plug } from '@phosphor-icons/react'
export { PlugChargingIcon as PlugZap } from '@phosphor-icons/react'
export { PlusIcon as Plus, PlusIcon } from '@phosphor-icons/react'
export { PlusCircleIcon as PlusCircle } from '@phosphor-icons/react'
export {
  PowerIcon as Power,
  PowerIcon as PowerOff,
} from '@phosphor-icons/react'
export { PresentationChartIcon as Presentation } from '@phosphor-icons/react'
export {
  ProhibitIcon as Ban,
  ProhibitIcon as CircleSlash2,
} from '@phosphor-icons/react'
export { PulseIcon as Activity } from '@phosphor-icons/react'
export { PushPinIcon as Pin } from '@phosphor-icons/react'
export { PushPinSlashIcon as PinOff } from '@phosphor-icons/react'
export { QrCodeIcon as QrCode } from '@phosphor-icons/react'
export { QuestionIcon as HelpCircle } from '@phosphor-icons/react'
export { RadioIcon as Radio } from '@phosphor-icons/react'
export { RadioButtonIcon as CircleDot } from '@phosphor-icons/react'
export { ReceiptIcon as Receipt } from '@phosphor-icons/react'
export {
  RepeatIcon as Repeat,
  RepeatIcon as Repeat2,
} from '@phosphor-icons/react'
export { ResizeIcon as Proportions } from '@phosphor-icons/react'
export { RobotIcon as Bot } from '@phosphor-icons/react'
export { RowsIcon as Rows3 } from '@phosphor-icons/react'
export { ScalesIcon as Scale } from '@phosphor-icons/react'
export { ScanIcon as Scan } from '@phosphor-icons/react'
export { ScissorsIcon as Scissors } from '@phosphor-icons/react'
export { SealPercentIcon as BadgePercent } from '@phosphor-icons/react'
export { SelectionIcon as SquareDashed } from '@phosphor-icons/react'
export { ShareNetworkIcon as Share2 } from '@phosphor-icons/react'
export { ShieldIcon as Shield } from '@phosphor-icons/react'
export { ShieldCheckIcon as ShieldCheck } from '@phosphor-icons/react'
export { ShieldSlashIcon as ShieldX } from '@phosphor-icons/react'
export { ShieldWarningIcon as ShieldAlert } from '@phosphor-icons/react'
export { ShuffleIcon as Shuffle } from '@phosphor-icons/react'
export { SignInIcon as LogIn } from '@phosphor-icons/react'
export { SignOutIcon as LogOut } from '@phosphor-icons/react'
export { SkipForwardIcon as StepForward } from '@phosphor-icons/react'
export {
  SlidersHorizontalIcon as Settings2,
  SlidersHorizontalIcon as SlidersHorizontal,
} from '@phosphor-icons/react'
export { SortAscendingIcon as SortAsc } from '@phosphor-icons/react'
export { SparkleIcon as Sparkles } from '@phosphor-icons/react'
export { SpeakerHighIcon as Volume2 } from '@phosphor-icons/react'
export { SpeakerXIcon as VolumeX } from '@phosphor-icons/react'
export { SquareIcon as Square, SquareIcon } from '@phosphor-icons/react'
export {
  SquaresFourIcon as Blocks,
  SquaresFourIcon as LayoutDashboard,
} from '@phosphor-icons/react'
export { StackIcon as Layers } from '@phosphor-icons/react'
export { StackSimpleIcon as Layers3 } from '@phosphor-icons/react'
export { SunIcon as Sun } from '@phosphor-icons/react'
export { TableIcon as Table, TableIcon as Table2 } from '@phosphor-icons/react'
export { TagIcon as Tag, TagIcon as Tags } from '@phosphor-icons/react'
export { TerminalIcon as Terminal } from '@phosphor-icons/react'
export { TerminalWindowIcon as SquareTerminal } from '@phosphor-icons/react'
export { TestTubeIcon as TestTube } from '@phosphor-icons/react'
export { TextAlignCenterIcon as AlignCenter } from '@phosphor-icons/react'
export { TextAlignLeftIcon as AlignLeft } from '@phosphor-icons/react'
export { TextAlignRightIcon as AlignRight } from '@phosphor-icons/react'
export { TextboxIcon as TextCursorInput } from '@phosphor-icons/react'
export { ThumbsDownIcon as ThumbsDown } from '@phosphor-icons/react'
export { ThumbsUpIcon as ThumbsUp } from '@phosphor-icons/react'
export { TimerIcon as Timer } from '@phosphor-icons/react'
export { TranslateIcon as Languages } from '@phosphor-icons/react'
export { TrashIcon as Trash2 } from '@phosphor-icons/react'
export { TreeStructureIcon as Network } from '@phosphor-icons/react'
export { TrendDownIcon as TrendingDown } from '@phosphor-icons/react'
export { TrendUpIcon as TrendingUp } from '@phosphor-icons/react'
export { TrophyIcon as Trophy } from '@phosphor-icons/react'
export { UploadSimpleIcon as Upload } from '@phosphor-icons/react'
export { UserIcon as User } from '@phosphor-icons/react'
export { UserCheckIcon as UserCheck } from '@phosphor-icons/react'
export { UserCircleIcon as UserRound } from '@phosphor-icons/react'
export { UserFocusIcon as UserSearch } from '@phosphor-icons/react'
export { UserGearIcon as UserCog } from '@phosphor-icons/react'
export { UserPlusIcon as UserPlus } from '@phosphor-icons/react'
export { UserSoundIcon as Speech } from '@phosphor-icons/react'
export { UsersIcon as Users } from '@phosphor-icons/react'
export { VideoCameraIcon as Video } from '@phosphor-icons/react'
export { WalletIcon as Wallet } from '@phosphor-icons/react'
export {
  WarningIcon as AlertTriangle,
  WarningIcon as TriangleAlert,
} from '@phosphor-icons/react'
export {
  WarningCircleIcon as AlertCircle,
  WarningCircleIcon as CircleAlert,
} from '@phosphor-icons/react'
export {
  WaveformIcon as AudioLines,
  WaveformIcon as AudioWaveform,
} from '@phosphor-icons/react'
export { WebhooksLogoIcon as Webhook } from '@phosphor-icons/react'
export { WifiSlashIcon as WifiOff } from '@phosphor-icons/react'
export { WrenchIcon as Wrench } from '@phosphor-icons/react'
export { XIcon as X, XIcon } from '@phosphor-icons/react'
export {
  XCircleIcon as CircleX,
  XCircleIcon as XCircle,
} from '@phosphor-icons/react'
export { SidebarSimpleIcon as PanelLeft } from '@phosphor-icons/react'
