import { useTranslation } from 'react-i18next'

import {
  Camera,
  CircleDot,
  Download,
  FolderArchive,
  Frame,
  Image as ImageIcon,
  Maximize,
  Music,
  Redo2,
  Settings2,
  StickyNote,
  Table,
  Undo2,
  Upload,
  Video,
  ZoomIn,
  ZoomOut,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

import { useCanvasTheme } from '../engine/canvas-theme'
import {
  CanvasNodeType,
  type CanvasBackgroundMode,
  type CanvasExperienceMode,
} from '../types'

type CanvasToolbarProps = {
  scale: number
  canUndo: boolean
  canRedo: boolean
  onAddNode: (type: CanvasNodeType) => void
  onUndo: () => void
  onRedo: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  onExportDocument: () => void
  onExportArchive: () => void
  onImportDocument: () => void
  onExportImage: () => void
  backgroundMode: CanvasBackgroundMode
  experienceMode: CanvasExperienceMode
  onBackgroundModeChange: (mode: CanvasBackgroundMode) => void
}

const BACKGROUND_LABELS: Record<CanvasBackgroundMode, string> = {
  dots: 'Dots',
  lines: 'Lines',
  blank: 'Blank',
}

const NODE_BUTTONS = [
  { type: CanvasNodeType.Image, icon: ImageIcon, label: 'Image' },
  { type: CanvasNodeType.Video, icon: Video, label: 'Video' },
  { type: CanvasNodeType.Audio, icon: Music, label: 'Audio' },
  { type: CanvasNodeType.Text, icon: StickyNote, label: 'Note' },
  { type: CanvasNodeType.Script, icon: Table, label: 'Storyboard' },
  { type: CanvasNodeType.Config, icon: Settings2, label: 'Generation preset' },
  { type: CanvasNodeType.Frame, icon: Frame, label: 'Frame' },
] as const

export function CanvasToolbar(props: CanvasToolbarProps) {
  const { t } = useTranslation()
  const theme = useCanvasTheme()

  return (
    <div
      data-canvas-no-zoom
      data-guide='canvas-toolbar'
      className='landing-animate-scale-in shadow-lifted absolute bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-2xl border p-1 backdrop-blur-xl sm:bottom-4 [&::-webkit-scrollbar]:hidden'
      style={{
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.item,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {NODE_BUTTONS.filter(
        (button) =>
          props.experienceMode === 'professional' ||
          ![
            CanvasNodeType.Audio,
            CanvasNodeType.Script,
            CanvasNodeType.Config,
          ].includes(button.type)
      ).map((button) => (
        <Button
          key={button.type}
          size='icon'
          variant='ghost'
          className='size-8 shrink-0 rounded-lg'
          title={t(button.label)}
          aria-label={t(button.label)}
          onClick={() => props.onAddNode(button.type)}
        >
          <button.icon className='size-4' />
        </Button>
      ))}

      <Separator orientation='vertical' className='mx-1 h-5 shrink-0' />

      <Select
        value={props.backgroundMode}
        onValueChange={(value) =>
          props.onBackgroundModeChange(value as CanvasBackgroundMode)
        }
      >
        <SelectTrigger
          size='sm'
          className='shrink-0 gap-1.5 border-transparent bg-transparent pr-2 pl-2 shadow-none dark:bg-transparent'
          aria-label={t('Canvas background')}
          title={t('Canvas background')}
        >
          <CircleDot />
          <SelectValue>
            {(value: CanvasBackgroundMode) => t(BACKGROUND_LABELS[value])}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='dots'>{t(BACKGROUND_LABELS.dots)}</SelectItem>
          <SelectItem value='lines'>{t(BACKGROUND_LABELS.lines)}</SelectItem>
          <SelectItem value='blank'>{t(BACKGROUND_LABELS.blank)}</SelectItem>
        </SelectContent>
      </Select>

      <Separator orientation='vertical' className='mx-1 h-5 shrink-0' />

      <Button
        size='icon'
        variant='ghost'
        className='size-8 shrink-0 rounded-lg'
        title={t('Undo')}
        aria-label={t('Undo')}
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <Undo2 className='size-4' />
      </Button>
      <Button
        size='icon'
        variant='ghost'
        className='size-8 shrink-0 rounded-lg'
        title={t('Redo')}
        aria-label={t('Redo')}
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        <Redo2 className='size-4' />
      </Button>

      <Separator orientation='vertical' className='mx-1 h-5 shrink-0' />

      <Button
        size='icon'
        variant='ghost'
        className='size-8 shrink-0 rounded-lg'
        title={t('Zoom out')}
        aria-label={t('Zoom out')}
        onClick={props.onZoomOut}
      >
        <ZoomOut className='size-4' />
      </Button>
      <span className='text-2xs w-11 shrink-0 text-center font-medium tabular-nums'>
        {Math.round(props.scale * 100)}%
      </span>
      <Button
        size='icon'
        variant='ghost'
        className='size-8 shrink-0 rounded-lg'
        title={t('Zoom in')}
        aria-label={t('Zoom in')}
        onClick={props.onZoomIn}
      >
        <ZoomIn className='size-4' />
      </Button>
      <Button
        size='icon'
        variant='ghost'
        className='size-8 shrink-0 rounded-lg'
        title={t('Fit view')}
        aria-label={t('Fit view')}
        onClick={props.onFitView}
      >
        <Maximize className='size-4' />
      </Button>

      <Separator orientation='vertical' className='mx-1 h-5 shrink-0' />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size='icon'
              variant='ghost'
              className='size-8 shrink-0 rounded-lg'
              title={t('Import / export')}
              aria-label={t('Import / export')}
            >
              <Download className='size-4' />
            </Button>
          }
        />
        <DropdownMenuContent align='end' sideOffset={8}>
          <DropdownMenuItem onClick={props.onExportDocument}>
            <Download />
            {t('Export canvas file')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={props.onExportArchive}>
            <FolderArchive />
            {t('Export canvas archive')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={props.onImportDocument}>
            <Upload />
            {t('Import canvas file')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={props.onExportImage}>
            <Camera />
            {t('Export as image')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
