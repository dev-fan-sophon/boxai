/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { generateImages, generateSpeech, submitVideo } from '../api'
import { STORAGE_KEYS } from '../constants'
import type {
  GeneratedImage,
  StudioModality,
  StudioSettings,
  VideoSubmission,
} from '../types'

const defaults: StudioSettings = {
  imageCount: 1,
  imageSize: '1024x1024',
  imageQuality: 'standard',
  videoDuration: 5,
  videoSize: '1280x720',
  voice: 'alloy',
  speed: 1,
  audioFormat: 'mp3',
}

type StoredStudio = {
  modality?: StudioModality
  settings?: Partial<StudioSettings>
}

function loadStudio(): StoredStudio {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.STUDIO)
    return value ? (JSON.parse(value) as StoredStudio) : {}
  } catch {
    return {}
  }
}

export function useStudio() {
  const queryClient = useQueryClient()
  const initial = loadStudio()
  const [modality, setModality] = useState<StudioModality>(
    initial.modality ?? 'chat'
  )
  const [settings, setSettings] = useState<StudioSettings>({
    ...defaults,
    ...initial.settings,
  })
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [video, setVideo] = useState<VideoSubmission | null>(null)
  const [audioUrl, setAudioUrl] = useState('')

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.STUDIO,
      JSON.stringify({ modality, settings })
    )
  }, [modality, settings])

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    },
    [audioUrl]
  )

  const imageMutation = useMutation({
    mutationFn: generateImages,
    onSuccess: setImages,
  })
  const videoMutation = useMutation({
    mutationFn: submitVideo,
    onSuccess: (submission) => {
      setVideo(submission)
      void queryClient.invalidateQueries({
        queryKey: ['playground', 'task-history'],
      })
    },
  })
  const audioMutation = useMutation({
    mutationFn: generateSpeech,
    onSuccess: (blob) => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioUrl(URL.createObjectURL(blob))
    },
  })

  return {
    modality,
    setModality,
    settings,
    setSettings,
    images,
    video,
    audioUrl,
    imageMutation,
    videoMutation,
    audioMutation,
  }
}
