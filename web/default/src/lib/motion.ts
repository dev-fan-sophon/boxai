import type { Transition, Variants } from 'motion/react'

const EASE_OUT_CUBIC = [0.33, 1, 0.68, 1] as const

/**
 * Seconds, mirroring the `--motion-duration-*` tiers in
 * `src/styles/motion.css`. `motion.test.ts` asserts the two stay equal, so a
 * tier can only be retimed in one place.
 */
export const MOTION_DURATION = {
  instant: 0,
  control: 0.18,
  overlay: 0.25,
  page: 0.32,
  expressive: 0.6,
  ambient: 1.2,
} as const

export const MOTION_TRANSITION = {
  fast: { duration: MOTION_DURATION.control, ease: EASE_OUT_CUBIC },
  default: { duration: MOTION_DURATION.overlay, ease: EASE_OUT_CUBIC },
  slow: { duration: MOTION_DURATION.page, ease: EASE_OUT_CUBIC },
} satisfies Record<string, Transition>

/**
 * Springs for motion the pointer drives — hover lifts, press feedback, drags.
 *
 * A fixed duration is the wrong model there: the gesture can reverse mid-flight,
 * and a timed curve either finishes an animation the user already abandoned or
 * restarts from zero. A spring carries its velocity across the interruption, so
 * a card caught on the way up settles instead of snapping. Entrances and exits
 * stay on the duration tiers, where predictable timing is the point.
 */
export const MOTION_SPRING = {
  /** Chips, buttons, icon affordances. Settles fast, no visible overshoot. */
  snappy: { type: 'spring', stiffness: 420, damping: 32 },
  /** Cards and panels. Enough weight to read as a physical object. */
  smooth: { type: 'spring', stiffness: 260, damping: 26 },
  /** Drag release only, where a little overshoot confirms the drop landed. */
  bouncy: { type: 'spring', stiffness: 300, damping: 18 },
} satisfies Record<string, Transition>

export const MOTION_VARIANTS = {
  /* Deliberately transform + opacity only. A lingering `filter: blur(0px)`
   * turns the page shell into a containing block for `position: fixed`
   * descendants, which quietly breaks full-viewport surfaces (playground,
   * canvas) that anchor overlays to the viewport. Motion resets an identity
   * transform to `none`, so the slide leaves nothing behind. */
  pageEnter: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  },
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  scaleIn: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
  },
  slideUp: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 16 },
  },
  cardItem: {
    initial: { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
  },
  sidebarSlide: {
    initial: { opacity: 0, x: -8 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -8 },
  },
} as const

type Keyframe = Record<string, number>

interface StaggerOptions {
  /** Delay between consecutive children, in seconds. */
  step: number
  from: Keyframe
  to: Keyframe
  transition: Transition
}

interface Stagger {
  container: Variants
  item: Variants
}

/**
 * A stagger is always the same shape: a container that carries only timing and
 * a child that carries the movement. The three presets below differ solely in
 * how far apart and how far their children travel — denser lists need a
 * shorter step so the last row does not lag visibly behind the first.
 */
function createStagger(options: StaggerOptions): Stagger {
  return {
    container: {
      initial: {},
      animate: { transition: { staggerChildren: options.step } },
    },
    item: {
      initial: options.from,
      animate: { ...options.to, transition: options.transition },
    },
  }
}

/** General page content — filter bars, section blocks, form groups. */
export const STAGGER = createStagger({
  step: 0.04,
  from: { opacity: 0, y: 8 },
  to: { opacity: 1, y: 0 },
  transition: MOTION_TRANSITION.default,
})

/** Table bodies. Shortest step and travel: rows are dense and numerous. */
export const TABLE_STAGGER = createStagger({
  step: 0.03,
  from: { opacity: 0, y: 4 },
  to: { opacity: 1, y: 0 },
  transition: MOTION_TRANSITION.fast,
})

/** Card grids. Longest travel plus a scale, because cards are large targets. */
export const CARD_STAGGER = createStagger({
  step: 0.05,
  from: { opacity: 0, y: 12, scale: 0.98 },
  to: { opacity: 1, y: 0, scale: 1 },
  transition: MOTION_TRANSITION.default,
})
