export type Position = {
  x: number
  y: number
}

export type ViewportTransform = {
  x: number
  y: number
  k: number
}

export enum CanvasNodeType {
  Image = 'image',
  Text = 'text',
  Script = 'script',
  Config = 'config',
  Video = 'video',
  Audio = 'audio',
  Frame = 'frame',
}

export type CanvasNodeStatus = 'idle' | 'success' | 'loading' | 'error'
export type CanvasGenerationMode = 'text' | 'image' | 'video' | 'audio'
export type StoryboardBatchItemStatus =
  | 'waiting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type StoryboardBatch = {
  id: string
  kind: 'image' | 'video'
  stopped: boolean
  items: Array<{
    rowId: string
    status: StoryboardBatchItemStatus
    errorDetails?: string
  }>
}

export type StoryboardRow = {
  id: string
  shotNumber: number
  durationSeconds: number
  plotDescription: string
  dialogue: string
  shotSize: string
  camera: string
  imageGenerationPrompt: string
  videoMotionPrompt: string
  negativePrompt: string
  referenceNodeIds: string[]
  imageNodeId?: string
  videoNodeId?: string
  status?: CanvasNodeStatus
  errorDetails?: string
}

export type StoryboardData = {
  rows: StoryboardRow[]
  referenceNodeIds: string[]
  batch?: StoryboardBatch
}

export type CanvasNodeMetadata = {
  content?: string
  prompt?: string
  composerContent?: string
  status?: CanvasNodeStatus
  locked?: boolean
  errorDetails?: string
  fontSize?: number
  generationMode?: CanvasGenerationMode
  model?: string
  size?: string
  quality?: string
  count?: number
  audioInstructions?: string
  seconds?: string
  audioVoice?: string
  audioFormat?: string
  audioSpeed?: string
  disableLastFrame?: boolean
  videoModel?: string
  naturalWidth?: number
  naturalHeight?: number
  freeResize?: boolean
  isBatchRoot?: boolean
  batchRootId?: string
  batchChildIds?: string[]
  primaryImageId?: string
  imageBatchExpanded?: boolean
  assetId?: number
  mimeType?: string
  workflowKind?: 'free' | 'script' | 'shot'
  workflowTitle?: string
  shotIndex?: number
  taskId?: string
  taskStatus?: string
  taskProgress?: number
  versionRootId?: string
  versionLabel?: 'A' | 'B' | 'C'
  versionPrimary?: boolean
  storyboard?: StoryboardData
  storyboardComposerHeight?: number
  frame?: {
    collapsed: boolean
    expandedWidth: number
    expandedHeight: number
  }
}

export type CanvasNodeData = {
  id: string
  type: CanvasNodeType
  title: string
  position: Position
  width: number
  height: number
  parentId?: string
  metadata?: CanvasNodeMetadata
}

export type CanvasConnection = {
  id: string
  fromNodeId: string
  toNodeId: string
  fromHandleId?: string
  toHandleId?: string
}

export type ConnectionHandle = {
  nodeId: string
  handleType: 'source' | 'target'
  handleId?: string
}

export type SelectionBox = {
  startWorldX: number
  startWorldY: number
  currentWorldX: number
  currentWorldY: number
  additive: boolean
  subtractive: boolean
  initialSelectedNodeIds: string[]
}

export type ContextMenuState =
  | { type: 'canvas'; x: number; y: number; position: Position }
  | { type: 'node'; x: number; y: number; nodeId: string }
  | { type: 'connection'; x: number; y: number; connectionId: string }

export type PendingConnectionCreate = {
  connection: ConnectionHandle
  position: Position
}

export type CanvasBackgroundMode = 'dots' | 'lines' | 'blank'
export type CanvasExperienceMode = 'simple' | 'professional'

export type CanvasDocument = {
  nodes: CanvasNodeData[]
  connections: CanvasConnection[]
  viewport: ViewportTransform
  backgroundMode: CanvasBackgroundMode
  experienceMode: CanvasExperienceMode
}

export type CanvasProjectMeta = {
  id: number
  title: string
  cover?: string
  created_at: number
  updated_at: number
}

export type CanvasProjectRecord = CanvasProjectMeta & {
  doc: string
}

export type CanvasVersionMeta = {
  id: number
  project_id: number
  title: string
  created_at: number
}

export type CanvasVersionRecord = CanvasVersionMeta & {
  doc: string
}
