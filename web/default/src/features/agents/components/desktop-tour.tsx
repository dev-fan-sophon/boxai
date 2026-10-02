import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  MarketingSection,
  SectionIntro,
} from '@/features/home/components/marketing'

// Recorded from the real app on macOS; silent with burned-in captions, so they read without sound.
const VIDEOS = [
  {
    id: 'overview',
    tab: 'Product tour',
    caption:
      'A project task from prompt to reviewed change: plan, edit, run, and diff, all on your machine.',
  },
  {
    id: 'getting-started',
    tab: 'Getting started',
    caption:
      'Install the app, approve the sign-in in your browser, pick a model, and run your first task.',
  },
] as const

type VideoId = (typeof VIDEOS)[number]['id']

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Plays muted while on screen and pauses when scrolled away. Visitors who ask for reduced
 * motion get the poster and the controls instead of autoplay.
 */
function TourVideo(props: { id: VideoId; caption: string; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!props.active) {
      video.pause()
      return
    }
    if (prefersReducedMotion()) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          video.play().catch(() => undefined)
        } else {
          video.pause()
        }
      },
      { threshold: 0.4 }
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [props.active])

  return (
    <figure className='space-y-3'>
      <div className='bg-muted ring-border/70 shadow-lifted overflow-hidden rounded-2xl ring-1'>
        <video
          ref={videoRef}
          className='block aspect-[16/10] w-full'
          poster={`/desktop-videos/${props.id}-poster.webp`}
          width={1536}
          height={960}
          muted
          loop
          playsInline
          controls
          preload='none'
          aria-label={props.caption}
        >
          <source src={`/desktop-videos/${props.id}.webm`} type='video/webm' />
          <source src={`/desktop-videos/${props.id}.mp4`} type='video/mp4' />
        </video>
      </div>
      <figcaption className='text-muted-foreground text-center text-sm text-pretty'>
        {props.caption}
      </figcaption>
    </figure>
  )
}

export function DesktopTour() {
  const { t } = useTranslation()
  const [active, setActive] = useState<VideoId>(VIDEOS[0].id)

  return (
    <MarketingSection labelledBy='desktop-tour'>
      <SectionIntro
        id='desktop-tour'
        eyebrow={t('See it work')}
        title={t('One minute from download to a reviewed change')}
      />

      <AnimateInView delay={80}>
        <Tabs
          value={active}
          onValueChange={(value) => setActive(value as VideoId)}
        >
          <TabsList>
            {VIDEOS.map((video) => (
              <TabsTrigger key={video.id} value={video.id}>
                {t(video.tab)}
              </TabsTrigger>
            ))}
          </TabsList>

          {VIDEOS.map((video) => (
            <TabsContent key={video.id} value={video.id} className='mt-5'>
              <TourVideo
                id={video.id}
                caption={t(video.caption)}
                active={active === video.id}
              />
            </TabsContent>
          ))}
        </Tabs>
      </AnimateInView>
    </MarketingSection>
  )
}
