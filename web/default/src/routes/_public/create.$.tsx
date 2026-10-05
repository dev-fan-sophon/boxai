import { createFileRoute } from '@tanstack/react-router'

// The parent redirects every legacy tool/library path, retaining query and hash.
export const Route = createFileRoute('/_public/create/$')({})
