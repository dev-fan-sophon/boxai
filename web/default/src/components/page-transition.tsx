import { Outlet, useRouterState } from '@tanstack/react-router'
import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Variants,
} from 'motion/react'
import type { ReactNode, Ref } from 'react'

import {
  CARD_STAGGER,
  MOTION_SPRING,
  MOTION_TRANSITION,
  MOTION_VARIANTS,
  STAGGER,
} from '@/lib/motion'
import { cn } from '@/lib/utils'

/*
 * Motion-backed transitions for the console. Everything here needs the runtime
 * for a real reason — an exit animation, or variant orchestration across a
 * list. Enter-only surfaces live in `page-enter.tsx` and stay on CSS, so the
 * public pages render without calling into `motion/react`.
 *
 * Reduced motion is handled once, by `MotionPreferences` below. Branching per
 * component the way this file used to swapped `motion.div` for a plain `div`,
 * which changes the element type and makes React remount the whole subtree —
 * losing the state inside it.
 */

/**
 * The application's reduced-motion policy, in one place.
 *
 * `user` follows the OS setting and drops transforms and layout animations
 * while keeping opacity: a hard cut is not more accessible, only less legible.
 *
 * Mounted at the root, so an animated subtree cannot be added without it. That
 * costs no bundle today because `routeTree.gen.ts` imports all 79 routes
 * statically and every page already carries the runtime. Should routes become
 * lazy, move this to the roots that actually animate — the console shell and
 * the playground — so public pages stop paying for it.
 */
export function MotionPreferences(props: { children: ReactNode }) {
  return <MotionConfig reducedMotion='user'>{props.children}</MotionConfig>
}

export function AnimatedOutlet() {
  // Key the page transition by the matched route id, not the resolved pathname.
  // Navigating between params of the same route (e.g. dashboard tabs served by
  // /dashboard/$section) then re-renders in place instead of remounting the
  // route component and discarding its state (such as the selected time range).
  const routeKey = useRouterState({
    select: (s) => s.matches.at(-1)?.routeId ?? s.location.pathname,
  })

  // Opacity only, and enter only. A transform — even for the 180ms of the
  // entrance — makes this wrapper the containing block for `position: fixed`
  // descendants, so full-viewport pages (playground, canvas, studio) would
  // briefly anchor their overlays to the content pane and jump. There is no
  // exit animation either: the next route renders immediately and fades up,
  // so navigation is never held back by the page that is leaving.
  return (
    <motion.div
      key={routeKey}
      initial={MOTION_VARIANTS.fadeIn.initial}
      animate={MOTION_VARIANTS.fadeIn.animate}
      transition={MOTION_TRANSITION.fast}
      className='flex min-h-0 flex-1 flex-col'
    >
      <Outlet />
    </motion.div>
  )
}

interface StaggerContainerProps {
  children: ReactNode
  className?: string
  variants?: Variants
}

export function StaggerContainer(props: StaggerContainerProps) {
  return (
    <motion.div
      variants={props.variants ?? STAGGER.container}
      initial='initial'
      animate='animate'
      className={props.className}
    >
      {props.children}
    </motion.div>
  )
}

interface StaggerItemProps {
  children: ReactNode
  className?: string
  variants?: Variants
}

export function StaggerItem(props: StaggerItemProps) {
  return (
    <motion.div
      variants={props.variants ?? STAGGER.item}
      className={props.className}
    >
      {props.children}
    </motion.div>
  )
}

export function CardStaggerContainer(props: StaggerContainerProps) {
  return (
    <motion.div
      variants={CARD_STAGGER.container}
      initial='initial'
      animate='animate'
      className={props.className}
    >
      {props.children}
    </motion.div>
  )
}

export function CardStaggerItem(props: StaggerItemProps) {
  return (
    <motion.div variants={CARD_STAGGER.item} className={props.className}>
      {props.children}
    </motion.div>
  )
}

interface RevealProps {
  /** Render the children when true, play the exit animation when false. */
  show: boolean
  children: ReactNode
  className?: string
}

/**
 * Entry/exit for small conditional UI — inline error banners, "saved" badges,
 * validation hints. Without an `AnimatePresence` around them these pop in and,
 * worse, vanish instantly; this gives both directions the same short fade and
 * scale. For whole panels or route content use `PageTransition` instead.
 */
export function Reveal(props: RevealProps) {
  return (
    <AnimatePresence initial={false}>
      {props.show && (
        <motion.div
          initial={MOTION_VARIANTS.scaleIn.initial}
          animate={MOTION_VARIANTS.scaleIn.animate}
          exit={MOTION_VARIANTS.scaleIn.exit}
          transition={MOTION_TRANSITION.fast}
          className={props.className}
        >
          {props.children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface AnimatedListProps {
  /** `AnimatedListItem`s, each with a stable `key`. */
  children: ReactNode
  className?: string
  /**
   * Animate the items present on first mount too. Off by default so a list
   * that is already on screen when its page opens does not replay; turn it on
   * for lists that mount together with their data (a popover body, a panel).
   */
  animateInitial?: boolean
  role?: string
  'aria-label'?: string
}

/**
 * Presence-aware list for collections that gain and lose items while on screen
 * — notifications, queued jobs, uploaded files, generated results.
 *
 * `popLayout` takes a leaving item out of flow at once, so its siblings glide
 * into the gap on a spring while it fades out on top, instead of the whole
 * list waiting for the exit to finish before reflowing. The container is
 * `relative` because that popped item is positioned against it.
 */
export function AnimatedList(props: AnimatedListProps) {
  return (
    <div
      className={cn('relative', props.className)}
      role={props.role}
      aria-label={props['aria-label']}
    >
      <AnimatePresence initial={props.animateInitial ?? false} mode='popLayout'>
        {props.children}
      </AnimatePresence>
    </div>
  )
}

/** Cap on the entrance stagger, so item 40 does not arrive a second late. */
const LIST_STAGGER_MAX_INDEX = 8
const LIST_STAGGER_STEP = 0.03

interface AnimatedListItemProps {
  children: ReactNode
  className?: string
  /**
   * Position in the list, used only to stagger a batch that enters together.
   * Omit it for items added one at a time.
   */
  index?: number
  role?: string
  /** Forwarded by `AnimatePresence` in `popLayout` mode; do not pass it. */
  ref?: Ref<HTMLDivElement>
}

export function AnimatedListItem(props: AnimatedListItemProps) {
  const delay =
    Math.min(props.index ?? 0, LIST_STAGGER_MAX_INDEX) * LIST_STAGGER_STEP

  return (
    <motion.div
      ref={props.ref}
      layout
      role={props.role}
      initial={MOTION_VARIANTS.cardItem.initial}
      animate={MOTION_VARIANTS.cardItem.animate}
      exit={MOTION_VARIANTS.scaleIn.exit}
      transition={{
        ...MOTION_SPRING.smooth,
        delay,
        opacity: { ...MOTION_TRANSITION.fast, delay },
      }}
      className={props.className}
    >
      {props.children}
    </motion.div>
  )
}
