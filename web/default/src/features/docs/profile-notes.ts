export const PROFILE_NOTES: Record<string, string[]> = {
  openai_chat: [
    'Send a messages array and enable stream when incremental output is needed.',
  ],
  openai_responses: [
    'Send input instead of messages; response events differ from Chat Completions.',
  ],
  openai_responses_compact: [
    'Use this operation to compact response context before a later request.',
  ],
  anthropic_messages: [
    'Claude Messages requires x-api-key and the anthropic-version header.',
  ],
  gemini_generate_content: [
    'Gemini content uses contents and parts while gateway authentication remains Bearer.',
  ],
  openai_embeddings: [
    'Embeddings accept text or arrays of text and return numeric vectors.',
  ],
  jina_rerank: [
    'Rerank sends a query and documents, then returns relevance ordering.',
  ],
  openai_images: [
    'Image generation accepts a prompt and returns generated image data or URLs.',
  ],
  openai_audio_speech: [
    'Speech returns audio bytes; handle the response as binary rather than JSON.',
  ],
  openai_audio_transcriptions: [
    'Transcription uses multipart form data with an audio file.',
  ],
  openai_video: [
    'Video creation uses multipart form data and may complete asynchronously.',
  ],
  openai_realtime: [
    'Realtime uses WebSocket events and requires a server-side client that can set handshake headers.',
  ],
}
