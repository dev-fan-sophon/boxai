import { useEffect, useLayoutEffect, useRef } from 'react'

import { RoutePending } from '@/components/route-pending'
import { useCreateStore } from '@/stores/create-store'
import { usePlaygroundStore } from '@/stores/playground-store'

import { CreateWorkspace } from './components/workspace/create-workspace'
import type { CreateTool } from './constants'

export { CreateLayout } from './components/layout/create-layout'
export { CreateLibrary } from './components/library/create-library'

/**
 * Route entry of one tool. The session store keeps one active project per
 * modality; entering a tool selects its modality before the workspace
 * renders, so the workspace never shows another tool's project.
 */
export function CreateToolPage(props: { tool: CreateTool; model?: string }) {
  const activeModality = usePlaygroundStore((state) => state.activeModality)
  const setActiveModality = usePlaygroundStore(
    (state) => state.setActiveModality
  )
  const setLastTool = useCreateStore((state) => state.setLastTool)
  const models = usePlaygroundStore((state) => state.models)
  const selectModel = usePlaygroundStore((state) => state.selectModel)
  const appliedModel = useRef<string | undefined>(undefined)

  useLayoutEffect(() => {
    setLastTool(props.tool)
    if (usePlaygroundStore.getState().activeModality !== props.tool) {
      setActiveModality(props.tool)
    }
  }, [props.tool, setActiveModality, setLastTool])

  // `?model=` deep links (Model Hub "Try", old /playground links) pick the
  // engine once its option list has loaded.
  useEffect(() => {
    const model = props.model
    if (!model || appliedModel.current === model) return
    if (activeModality !== props.tool) return
    if (!models.some((option) => option.value === model)) return
    appliedModel.current = model
    selectModel(model, undefined, { switchModality: props.tool })
  }, [activeModality, models, props.model, props.tool, selectModel])

  if (activeModality !== props.tool) return <RoutePending />
  return <CreateWorkspace key={props.tool} tool={props.tool} />
}
