import { createFileRoute } from '@tanstack/react-router'

import { ForbiddenError } from '@/features/errors/forbidden'
import { GeneralError } from '@/features/errors/general-error'
import { MaintenanceError } from '@/features/errors/maintenance-error'
import { NotFoundError } from '@/features/errors/not-found-error'
import { UnauthorisedError } from '@/features/errors/unauthorized-error'

export const Route = createFileRoute('/_authenticated/errors/$error')({
  component: RouteComponent,
})

const ERROR_COMPONENTS: Record<
  string,
  React.ComponentType<{ embedded?: boolean }>
> = {
  unauthorized: UnauthorisedError,
  forbidden: ForbiddenError,
  'not-found': NotFoundError,
  'internal-server-error': GeneralError,
  'maintenance-error': MaintenanceError,
}

function RouteComponent() {
  const { error } = Route.useParams()
  const ErrorComponent = ERROR_COMPONENTS[error] || NotFoundError

  // The authenticated shell already provides the header and brand chrome.
  return (
    <div className='flex flex-1 flex-col'>
      <ErrorComponent embedded />
    </div>
  )
}
