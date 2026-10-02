/**
 * Local audio/video inputs of the file-based audio tools (transcribe, voice
 * changer, isolate). The picked File stays in the tab — it is sent straight
 * to the provider as multipart — and jobs reference it by its object URL, so
 * a queued job or a retry still finds the original bytes and file name.
 * Inputs live until the tab is closed: a removed file may still back a
 * queued job or a failed one waiting for retry.
 */
const inputs = new Map<string, File>()

/** Max upload accepted by the studio (ElevenLabs allows far more). */
export const MAX_AUDIO_INPUT_BYTES = 100 * 1024 * 1024

export const AUDIO_INPUT_ACCEPT = 'audio/*,video/mp4,video/webm,video/quicktime'

export function registerAudioInput(file: File): string {
  const url = URL.createObjectURL(file)
  inputs.set(url, file)
  return url
}

/** The File behind an input URL; remote URLs are downloaded. */
export async function resolveAudioInput(url: string): Promise<File> {
  const local = inputs.get(url)
  if (local) return local
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error('The input audio is no longer available.')
  }
  const blob = await response.blob()
  const name = url.split(/[?#]/)[0].split('/').pop() || 'input-audio'
  return new File([blob], name, { type: blob.type })
}

export function isAcceptedAudioInput(file: File): boolean {
  return (
    file.type.startsWith('audio/') ||
    file.type.startsWith('video/') ||
    /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|mp4|mov)$/i.test(file.name)
  )
}
