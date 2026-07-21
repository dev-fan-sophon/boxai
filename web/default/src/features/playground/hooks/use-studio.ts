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
import type { GeneratedImage, StudioSettings, VideoSubmission } from '../types'

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
  const [settings, setSettings] = useState<StudioSettings>(() => {
    const stored = loadStudio().settings
    return {
      ...defaults,
      ...stored,
      imageCount: clampNumber(stored?.imageCount, 1, 10, defaults.imageCount),
      videoDuration: clampNumber(
        stored?.videoDuration,
        1,
        60,
        defaults.videoDuration
      ),
      speed: clampNumber(stored?.speed, 0.25, 4, defaults.speed),
    }
  })
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [video, setVideo] = useState<VideoSubmission | null>(null)
  const [audioUrl, setAudioUrl] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.STUDIO, JSON.stringify({ settings }))
    } catch {
      // Storage may be unavailable in private browsing modes.
    }
  }, [settings])

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

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value as number))
}
