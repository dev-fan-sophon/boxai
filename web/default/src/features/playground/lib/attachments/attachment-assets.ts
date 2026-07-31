import { fetchPlaygroundAssetBlob } from '../../api'
import type { ChatAttachment, Message } from '../../types'
import { needsAttachmentHydration } from './attachment-utils'

/**
 * Data URLs are stripped before the store is persisted, so a reloaded session
 * only carries asset ids. Cache the refetched bytes for the tab lifetime: every
 * later turn replays the same attachment.
 */
const dataUrlByAssetId = new Map<number, string>()

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)), {
      once: true,
    })
    reader.addEventListener('error', () => reject(reader.error), { once: true })
    reader.readAsDataURL(blob)
  })
}

export function rememberAttachmentAsset(
  assetId: number,
  dataUrl: string
): void {
  dataUrlByAssetId.set(assetId, dataUrl)
}

async function resolveAttachmentDataUrl(assetId: number): Promise<string> {
  const cached = dataUrlByAssetId.get(assetId)
  if (cached) return cached
  const dataUrl = await blobToDataUrl(await fetchPlaygroundAssetBlob(assetId))
  dataUrlByAssetId.set(assetId, dataUrl)
  return dataUrl
}

async function hydrateAttachment(
  attachment: ChatAttachment
): Promise<ChatAttachment> {
  if (attachment.kind !== 'image' || !needsAttachmentHydration(attachment)) {
    return attachment
  }
  try {
    return {
      ...attachment,
      dataUrl: await resolveAttachmentDataUrl(attachment.assetId as number),
    }
  } catch {
    // A missing or expired asset must not block the turn; the attachment is
    // dropped by the payload filter.
    return attachment
  }
}

/**
 * Refill inline image bytes for attachments restored from persistence, so a
 * request built after a page reload still carries the images the user
 * attached. Document text persists directly and needs no hydration.
 */
export async function hydrateMessageAttachments(
  messages: Message[]
): Promise<Message[]> {
  const needsHydration = (message: Message) =>
    message.attachments?.some(needsAttachmentHydration) ?? false

  if (!messages.some(needsHydration)) {
    return messages
  }
  return Promise.all(
    messages.map(async (message) => {
      if (!needsHydration(message)) return message
      return {
        ...message,
        attachments: await Promise.all(
          message.attachments?.map(hydrateAttachment) ?? []
        ),
      }
    })
  )
}
