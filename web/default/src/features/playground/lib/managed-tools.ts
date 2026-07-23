/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { ManagedToolCard, Message, MessageSource } from '../types'

export function updateManagedAssistant(
  messages: Message[],
  assistantKey: string,
  managedTool: ManagedToolCard,
  sources?: MessageSource[]
): Message[] {
  return messages.map((message) =>
    message.key === assistantKey
      ? {
          ...message,
          managedTool,
          sources: sources ?? message.sources,
          status: managedTool.status === 'failed' ? 'error' : 'complete',
        }
      : message
  )
}
