/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Outlet, useRouterState } from '@tanstack/react-router'
import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Variants,
} from 'motion/react'
import type { ReactNode } from 'react'

import {
  CARD_STAGGER,
  MOTION_TRANSITION,
  MOTION_VARIANTS,
  STAGGER,
  TABLE_STAGGER,
} from '@/lib/motion'

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

  return (
    <motion.div
      key={routeKey}
      initial={MOTION_VARIANTS.pageEnter.initial}
      animate={MOTION_VARIANTS.pageEnter.animate}
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

export function TableStaggerContainer(props: StaggerContainerProps) {
  return (
    <motion.tbody
      variants={TABLE_STAGGER.container}
      initial='initial'
      animate='animate'
      className={props.className}
    >
      {props.children}
    </motion.tbody>
  )
}

export function TableStaggerRow(props: StaggerItemProps) {
  return (
    <motion.tr variants={TABLE_STAGGER.item} className={props.className}>
      {props.children}
    </motion.tr>
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
