import { Link } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'

import { ProseAccordion } from '@/components/prose-accordion'
import {
  MarketingSection,
  SectionIntro,
} from '@/features/home/components/marketing'

const QUESTIONS = [
  {
    id: 'data',
    question: 'What leaves my computer?',
    answer:
      'Only what a model needs to answer: your prompt and the context the agent attaches, sent through the BoxAI gateway. Projects, sessions, plugins, and settings stay in local storage on your machine.',
  },
  {
    id: 'keys',
    question: 'Can I plug in my own provider keys?',
    answer:
      'No. BoxAI Desktop routes every model call through your BoxAI account so billing, limits, and revocation always apply. Direct provider keys, custom endpoints, and third-party sign-ins are not available.',
  },
  {
    id: 'safety',
    question: 'It can run shell commands. How is that safe?',
    answer:
      'Commands, file writes, and MCP tools ask for approval by default and show the exact action first. Plan mode lets you approve the approach before anything changes, and every edit stays reviewable as a diff.',
  },
  {
    id: 'usage',
    question: 'How do I know what a session costs?',
    answer:
      'Every call is metered against your BoxAI account and appears in your usage logs with the model and token counts. The app shows your balance, and you can switch to a cheaper model at any point in a session.',
  },
  {
    id: 'previous',
    question: 'I used the previous BoxAI Desktop. What changes?',
    answer:
      'The new BoxAI Desktop is a separate app built for project work. The previous version no longer receives updates: download the new one from this page and sign in again. Conversations from the previous app are not imported.',
  },
  {
    id: 'platforms',
    question: 'Which platforms are supported?',
    answer:
      'macOS 12 or later on Apple Silicon, and Windows 10 or later on 64-bit. Intel Macs and Linux are not packaged yet.',
  },
] as const

export function DesktopFaq() {
  const { t } = useTranslation()

  const entries = [
    {
      id: 'account',
      label: t('Do I need a BoxAI account?'),
      body: (
        <p>
          <Trans
            i18nKey='Yes. Model access comes from your BoxAI account, so usage is billed and rate-limited exactly like the API. You sign in once from the app and can revoke the device at any time from <1>your profile</1>.'
            components={[
              <span key='0' />,
              <Link
                key='1'
                to='/profile'
                className='text-primary underline underline-offset-4'
              />,
            ]}
          />
        </p>
      ),
    },
    ...QUESTIONS.map((entry) => ({
      id: entry.id,
      label: t(entry.question),
      body: <p>{t(entry.answer)}</p>,
    })),
  ]

  return (
    <MarketingSection labelledBy='desktop-faq'>
      <div className='grid gap-8 lg:grid-cols-12 lg:gap-12'>
        <div className='lg:col-span-5'>
          <SectionIntro
            className='mb-0 md:mb-0'
            id='desktop-faq'
            eyebrow={t('Questions')}
            title={t('What people ask before installing')}
          />
        </div>
        <div className='min-w-0 lg:col-span-7'>
          <ProseAccordion entries={entries} />
        </div>
      </div>
    </MarketingSection>
  )
}
