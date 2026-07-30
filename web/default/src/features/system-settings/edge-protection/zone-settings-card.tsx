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
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'

import {
  updateCloudflareBotFightMode,
  updateCloudflareZoneSetting,
  type CloudflareBotSettings,
} from './api'
import { useCloudflareMutation } from './use-cloudflare'

type SettingDefinition = {
  name: string
  labelKey: string
  descriptionKey: string
  options: { value: string; labelKey: string }[]
}

const ZONE_SETTINGS: SettingDefinition[] = [
  {
    name: 'security_level',
    labelKey: 'Security level',
    descriptionKey:
      'Raises the challenge threshold for addresses with a poor reputation. "Under attack" challenges every visitor and should only be used during an incident.',
    options: [
      { value: 'essentially_off', labelKey: 'Essentially off' },
      { value: 'low', labelKey: 'Low' },
      { value: 'medium', labelKey: 'Medium' },
      { value: 'high', labelKey: 'High' },
      { value: 'under_attack', labelKey: 'Under attack' },
    ],
  },
  {
    name: 'min_tls_version',
    labelKey: 'Minimum TLS version',
    descriptionKey:
      'Rejects handshakes below this version. Anything under 1.2 keeps deprecated ciphers available to scanners.',
    options: [
      { value: '1.0', labelKey: 'TLS 1.0' },
      { value: '1.1', labelKey: 'TLS 1.1' },
      { value: '1.2', labelKey: 'TLS 1.2' },
      { value: '1.3', labelKey: 'TLS 1.3' },
    ],
  },
  {
    name: 'always_use_https',
    labelKey: 'Always use HTTPS',
    descriptionKey:
      'Redirects plain HTTP at the edge so a session cookie is never sent in the clear.',
    options: [
      { value: 'on', labelKey: 'On' },
      { value: 'off', labelKey: 'Off' },
    ],
  },
  {
    name: 'ssl',
    labelKey: 'Origin connection',
    descriptionKey:
      '"Full (strict)" validates the origin certificate. "Flexible" leaves the Cloudflare-to-origin hop unencrypted.',
    options: [
      { value: 'off', labelKey: 'Off' },
      { value: 'flexible', labelKey: 'Flexible' },
      { value: 'full', labelKey: 'Full' },
      { value: 'strict', labelKey: 'Full (strict)' },
    ],
  },
  {
    name: 'browser_check',
    labelKey: 'Browser integrity check',
    descriptionKey:
      'Blocks requests carrying headers commonly used by spam bots.',
    options: [
      { value: 'on', labelKey: 'On' },
      { value: 'off', labelKey: 'Off' },
    ],
  },
]

type ZoneSettingsCardProps = {
  settings: Record<string, string | number>
  bot: CloudflareBotSettings | null | undefined
}

export function ZoneSettingsCard(props: ZoneSettingsCardProps) {
  const { t } = useTranslation()
  const updateSetting = useCloudflareMutation(
    updateCloudflareZoneSetting,
    t('Zone setting updated')
  )
  const updateBot = useCloudflareMutation(
    updateCloudflareBotFightMode,
    t('Bot Fight Mode updated')
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Zone security')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-5'>
        {ZONE_SETTINGS.map((setting) => (
          <div key={setting.name} className='flex flex-col gap-2'>
            <div className='flex items-center justify-between gap-4'>
              <Label htmlFor={`cf-${setting.name}`}>
                {t(setting.labelKey)}
              </Label>
              <NativeSelect
                id={`cf-${setting.name}`}
                value={String(props.settings[setting.name] ?? '')}
                disabled={updateSetting.isPending}
                onChange={(event) =>
                  updateSetting.mutate({
                    name: setting.name,
                    value: event.target.value,
                  })
                }
              >
                {setting.options.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <p className='text-muted-foreground text-sm'>
              {t(setting.descriptionKey)}
            </p>
          </div>
        ))}

        <div className='flex flex-col gap-2 border-t pt-5'>
          <div className='flex items-center justify-between gap-4'>
            <Label htmlFor='cf-bot-fight-mode'>{t('Bot Fight Mode')}</Label>
            <Switch
              id='cf-bot-fight-mode'
              checked={props.bot?.fight_mode ?? false}
              disabled={updateBot.isPending || !props.bot}
              onCheckedChange={(checked) =>
                updateBot.mutate({ fight_mode: checked })
              }
            />
          </div>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Challenges every request that does not look like a browser. This breaks API clients, SDKs and command line tools, so leave it off on a zone that serves the gateway API and rely on the credential endpoint rules instead.'
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
