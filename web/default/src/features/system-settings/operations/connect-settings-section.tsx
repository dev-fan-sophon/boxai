import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { getEnabledModels } from '@/features/channels/api'

import { useUpdateOption } from '../hooks/use-update-option'
import type { OperationsSettings } from '../types'

const AGENTS = [
  'claude',
  'codex',
  'gemini',
  'grokbuild',
  'opencode',
  'workbuddy',
  'openclaw',
  'hermes',
] as const
type AgentName = (typeof AGENTS)[number]
type AgentPolicy = {
  enabled: boolean
  recommended_model: string
  locked_model?: string
}
type AgentPolicies = Record<AgentName, AgentPolicy>

function parsePolicies(value: string): AgentPolicies {
  let parsed: Partial<Record<AgentName, AgentPolicy>> = {}
  try {
    parsed = JSON.parse(value) as Partial<Record<AgentName, AgentPolicy>>
  } catch {
    /* use defaults */
  }
  return Object.fromEntries(
    AGENTS.map((name) => [
      name,
      {
        enabled: parsed[name]?.enabled ?? true,
        recommended_model: parsed[name]?.recommended_model ?? '',
        locked_model: parsed[name]?.locked_model ?? '',
      },
    ])
  ) as AgentPolicies
}

export function ConnectSettingsSection(props: {
  defaultValues: OperationsSettings
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [enabled, setEnabled] = useState(props.defaultValues['connect.enabled'])
  const [releaseManifestUrl, setReleaseManifestUrl] = useState(
    props.defaultValues['connect.release_manifest_url']
  )
  const [downloadUrl, setDownloadUrl] = useState(
    props.defaultValues['connect.download_url']
  )
  const [minVersion, setMinVersion] = useState(
    props.defaultValues['connect.min_version']
  )
  const [tokenName, setTokenName] = useState(
    props.defaultValues['connect.token_name']
  )
  const [policies, setPolicies] = useState(() =>
    parsePolicies(props.defaultValues['connect.agent_policies'])
  )
  const modelsQuery = useQuery({
    queryKey: ['enabled-models', 'connect'],
    queryFn: getEnabledModels,
  })
  const models = [...(modelsQuery.data?.data ?? [])].sort()

  const updatePolicy = (name: AgentName, patch: Partial<AgentPolicy>) => {
    setPolicies((current) => ({
      ...current,
      [name]: { ...current[name], ...patch },
    }))
  }
  const save = () => {
    const serviceToggle = { key: 'connect.enabled', value: enabled }
    const policy = {
      key: 'connect.agent_policies',
      value: JSON.stringify(policies),
    }
    const otherValues = [
      { key: 'connect.release_manifest_url', value: releaseManifestUrl },
      { key: 'connect.download_url', value: downloadUrl },
      { key: 'connect.min_version', value: minVersion },
      { key: 'connect.token_name', value: tokenName },
    ]
    // Enabling publishes restrictive per-agent policy first; disabling closes
    // the global gate first. A later request failure cannot expose stale policy.
    return updateOption.mutateAsync(
      enabled
        ? [policy, ...otherValues, serviceToggle]
        : [serviceToggle, policy, ...otherValues]
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Connect service')}</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-4 md:grid-cols-2'>
          <div className='flex items-center justify-between md:col-span-2'>
            <Label>{t('Enable Connect')}</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          {(
            [
              [
                'connect-release',
                t('Release manifest URL'),
                releaseManifestUrl,
                setReleaseManifestUrl,
              ],
              [
                'connect-download',
                t('Download URL override'),
                downloadUrl,
                setDownloadUrl,
              ],
              [
                'connect-version',
                t('Minimum client version'),
                minVersion,
                setMinVersion,
              ],
              [
                'connect-token',
                t('Provisioned token name'),
                tokenName,
                setTokenName,
              ],
            ] as const
          ).map(([id, label, value, setter]) => (
            <div key={id} className='grid gap-2'>
              <Label htmlFor={id}>{label}</Label>
              <Input
                id={id}
                value={value}
                onChange={(event) => setter(event.target.value)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      <div>
        <h3 className='font-semibold'>{t('Agent policies')}</h3>
        <p className='text-muted-foreground text-sm'>
          {t(
            'All compatible chat models are synchronized automatically. Recommendations and locks do not restrict the model catalog.'
          )}
        </p>
      </div>
      <div className='grid gap-4 lg:grid-cols-2'>
        {AGENTS.map((name) => (
          <Card key={name}>
            <CardHeader className='flex-row items-center justify-between'>
              <CardTitle className='capitalize'>{name}</CardTitle>
              <Switch
                aria-label={t('Enable agent')}
                checked={policies[name].enabled}
                onCheckedChange={(value) =>
                  updatePolicy(name, { enabled: value })
                }
              />
            </CardHeader>
            <CardContent className='grid gap-4'>
              {(
                [
                  ['recommended_model', t('Recommended initial model')],
                  ['locked_model', t('Forced model (optional)')],
                ] as const
              ).map(([field, label]) => (
                <div key={field} className='grid gap-2'>
                  <Label>{label}</Label>
                  <Select
                    value={policies[name][field] || '__none__'}
                    onValueChange={(value) =>
                      updatePolicy(name, {
                        [field]: value === '__none__' ? '' : value,
                      })
                    }
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>{t('No model')}</SelectItem>
                      {models.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className='flex justify-end'>
        <Button disabled={updateOption.isPending} onClick={() => void save()}>
          {t('Save')}
        </Button>
      </div>
    </div>
  )
}
