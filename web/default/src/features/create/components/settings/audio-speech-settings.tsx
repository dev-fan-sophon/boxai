import { useTranslation } from 'react-i18next'

import { Dices } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  ELEVEN_SPEED_RANGE,
  ELEVEN_V3_STABILITY,
  MAX_ELEVEN_SEED,
} from '@/features/playground/lib/studio/audio-settings'
import { usePlaygroundStore } from '@/stores/playground-store'

import { useStudioSettingUpdater } from '../../hooks/use-studio-setting-updater'
import {
  LanguageSelect,
  OutputFormatSelect,
  SliderRow,
  SwitchRow,
} from './audio-controls'
import { ElevenVoicePicker } from './eleven-voice-picker'
import { SettingRow } from './setting-row'

const percent = (value: number) => `${Math.round(value * 100)}%`

/** ElevenLabs text-to-speech parameters. */
export function AudioSpeechSettings(props: { model: string }) {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const update = useStudioSettingUpdater()
  const isV3 = props.model === 'eleven_v3'
  const v3Stability = ELEVEN_V3_STABILITY.reduce((best, option) =>
    Math.abs(option.value - settings.elevenStability) <
    Math.abs(best.value - settings.elevenStability)
      ? option
      : best
  )

  return (
    <div className='space-y-4'>
      <SettingRow label={t('Voice')} htmlFor='gen-eleven-voice'>
        <ElevenVoicePicker id='gen-eleven-voice' />
      </SettingRow>

      {isV3 ? (
        <div className='space-y-1.5'>
          <p className='text-xs font-medium'>{t('Stability')}</p>
          <SegmentedControl<string>
            fullWidth
            size='sm'
            aria-label={t('Stability')}
            value={String(v3Stability.value)}
            options={ELEVEN_V3_STABILITY.map((option) => ({
              value: String(option.value),
              label: t(option.labelKey),
            }))}
            onValueChange={(value) => update('elevenStability', Number(value))}
          />
          <p className='text-muted-foreground text-2xs'>
            {t(
              'Creative is more expressive, Robust follows the reference voice closely.'
            )}
          </p>
        </div>
      ) : (
        <SliderRow
          id='gen-eleven-stability'
          label={t('Stability')}
          value={settings.elevenStability}
          min={0}
          max={1}
          step={0.05}
          valueLabel={percent(settings.elevenStability)}
          onChange={(value) => update('elevenStability', value)}
        />
      )}
      <SliderRow
        id='gen-eleven-similarity'
        label={t('Similarity')}
        value={settings.elevenSimilarity}
        min={0}
        max={1}
        step={0.05}
        valueLabel={percent(settings.elevenSimilarity)}
        onChange={(value) => update('elevenSimilarity', value)}
      />
      <SliderRow
        id='gen-eleven-style'
        label={t('Style exaggeration')}
        value={settings.elevenStyle}
        min={0}
        max={1}
        step={0.05}
        valueLabel={percent(settings.elevenStyle)}
        onChange={(value) => update('elevenStyle', value)}
      />
      <SliderRow
        id='gen-eleven-speed'
        label={t('Speed')}
        value={settings.elevenSpeed}
        min={ELEVEN_SPEED_RANGE.min}
        max={ELEVEN_SPEED_RANGE.max}
        step={ELEVEN_SPEED_RANGE.step}
        valueLabel={`${settings.elevenSpeed.toFixed(2)}×`}
        onChange={(value) =>
          update('elevenSpeed', Math.round(value * 100) / 100)
        }
      />
      <SwitchRow
        label={t('Speaker boost')}
        hint={t('Closer to the original voice, slightly slower.')}
        checked={settings.elevenSpeakerBoost}
        onChange={(checked) => update('elevenSpeakerBoost', checked)}
      />
      <SettingRow label={t('Language')} htmlFor='gen-eleven-language'>
        <LanguageSelect
          id='gen-eleven-language'
          value={settings.elevenLanguage}
          autoLabel={t('Detect from text')}
          onChange={(value) => update('elevenLanguage', value)}
        />
      </SettingRow>
      <SeedInput />
      <SettingRow label={t('Output format')} htmlFor='gen-eleven-format'>
        <OutputFormatSelect
          id='gen-eleven-format'
          value={settings.elevenOutputFormat}
          onChange={(value) => update('elevenOutputFormat', value)}
        />
      </SettingRow>
    </div>
  )
}

/** Optional fixed seed for repeatable takes; empty = random. */
export function SeedInput() {
  const { t } = useTranslation()
  const seed = usePlaygroundStore((state) => state.studioSettings.elevenSeed)
  const update = useStudioSettingUpdater()

  return (
    <SettingRow label={t('Seed')} htmlFor='gen-eleven-seed'>
      <div className='flex items-center gap-1.5'>
        <Input
          id='gen-eleven-seed'
          inputMode='numeric'
          className='h-8 text-sm tabular-nums'
          placeholder={t('Random')}
          value={seed === null ? '' : String(seed)}
          onChange={(event) => {
            const raw = event.target.value.replaceAll(/\D/g, '')
            if (!raw) {
              update('elevenSeed', null)
              return
            }
            update('elevenSeed', Math.min(MAX_ELEVEN_SEED, Number(raw)))
          }}
        />
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          aria-label={t('Random seed')}
          title={t('Random seed')}
          onClick={() =>
            update('elevenSeed', Math.floor(Math.random() * 1_000_000_000))
          }
        >
          <Dices className='size-3.5' />
        </Button>
      </div>
    </SettingRow>
  )
}
