/**
 * Get message content styles based on role
 * Encapsulates styling logic for user and assistant messages
 */
export function getMessageContentStyles() {
  return [
    // Assistant content reads like a document column; user bubble stays compact.
    'group-[.is-assistant]:w-full',
    'group-[.is-assistant]:max-w-[78ch]',
    'group-[.is-user]:w-fit',

    // User bubble: compact surface that stays calm in both light and dark themes.
    'group-[.is-user]:rounded-2xl',
    'group-[.is-user]:rounded-br-md',
    'group-[.is-user]:bg-secondary',
    'group-[.is-user]:px-3.5',
    'group-[.is-user]:py-2',
    'sm:group-[.is-user]:px-4',
    'sm:group-[.is-user]:py-2.5',
    'group-[.is-user]:text-foreground',

    // Assistant response: flat reading surface using the active UI font axis.
    'group-[.is-assistant]:bg-transparent',
    'group-[.is-assistant]:p-0',
    'group-[.is-assistant]:rounded-none',
    'group-[.is-assistant]:overflow-visible',
    'group-[.is-assistant]:[font-family:var(--font-body)]',
    'group-[.is-assistant]:text-foreground/95',
    'dark:group-[.is-assistant]:text-foreground/90',

    // Preferred readable widths and wrapping
    'text-md',
    'leading-6',
    'break-words',
    'whitespace-pre-wrap',
    'sm:leading-7',

    // Cap user bubble width so it does not look like a banner on phones
    'group-[.is-user]:max-w-[min(92%,28rem)]',
    'sm:group-[.is-user]:max-w-[62ch]',
    'md:group-[.is-user]:max-w-[68ch]',
    'lg:group-[.is-user]:max-w-[72ch]',
  ].join(' ')
}
