import { Crown, RefreshCw, Sparkles, Check } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  StatusBadge,
  dotColorMap,
  textColorMap,
} from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  updateOverageSettings,
  updateSubscriptionRenewal,
} from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import { formatDuration, formatResetPeriod } from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { SubscriptionCenterData } from '../hooks/use-subscription-center'
import type { PaymentMethod, TopupInfo } from '../types'
import { TopUpProofDialog } from './dialogs/top-up-proof-dialog'

interface SubscriptionPlansCardProps {
  topupInfo: TopupInfo | null
  data: SubscriptionCenterData
  loading: boolean
  refreshing: boolean
  onRefresh: () => Promise<void> | void
  onOverageChange: (enabled: boolean, limitUsd: number) => void
  onAvailabilityChange?: (available: boolean) => void
  userQuota?: number
  onPurchaseSuccess?: () => void | Promise<void>
}

function getEpayMethods(payMethods: PaymentMethod[] = []): PaymentMethod[] {
  return payMethods.filter(
    (m) => m?.type && m.type !== 'stripe' && m.type !== 'creem'
  )
}

export function SubscriptionPlansCard(props: SubscriptionPlansCardProps) {
  const { t } = useTranslation()

  const plans = props.data.plans
  const activeSubscriptions = props.data.activeSubscriptions
  const allSubscriptions = props.data.allSubscriptions
  const pendingBankQROrders = props.data.pendingBankQROrders
  const savedOverageLimit = props.data.overageLimitUsd
  const overageEnabled = props.data.overageEnabled
  const loading = props.loading
  const [overageLimitInput, setOverageLimitInput] = useState('')
  const [renewalBusyId, setRenewalBusyId] = useState<number | null>(null)

  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  const onAvailabilityChange = props.onAvailabilityChange
  const [proofTradeNo, setProofTradeNo] = useState<string | null>(null)

  const enableStripe = !!props.topupInfo?.enable_stripe_topup
  const enableCreem = !!props.topupInfo?.enable_creem_topup
  const enableWaffoPancake = !!props.topupInfo?.enable_waffo_pancake_topup
  const enableOnlineTopUp = !!props.topupInfo?.enable_online_topup
  const epayMethods = useMemo(
    () => getEpayMethods(props.topupInfo?.pay_methods),
    [props.topupInfo?.pay_methods]
  )

  // The dirty-check compares against the saved limit, so the input mirrors
  // whatever the shared subscription state currently holds.
  useEffect(() => {
    setOverageLimitInput(savedOverageLimit > 0 ? String(savedOverageLimit) : '')
  }, [savedOverageLimit])

  const saveOverageSettings = async (enabled: boolean, limitUsd: number) => {
    try {
      const res = await updateOverageSettings({
        enabled,
        limit_usd: limitUsd,
      })
      if (res.success) {
        toast.success(t('Updated successfully'))
        props.onOverageChange(
          !!res.data?.overage_enabled,
          Number(res.data?.overage_limit_usd || 0)
        )
        return true
      }
      toast.error(res.message || t('Update failed'))
    } catch {
      toast.error(t('Request failed'))
    }
    return false
  }

  const handleOverageToggle = async (enabled: boolean) => {
    props.onOverageChange(enabled, savedOverageLimit)
    const ok = await saveOverageSettings(enabled, savedOverageLimit)
    if (!ok) props.onOverageChange(!enabled, savedOverageLimit)
  }

  const parsedOverageLimit = overageLimitInput.trim()
    ? Number(overageLimitInput)
    : 0
  const overageLimitValid =
    Number.isFinite(parsedOverageLimit) &&
    parsedOverageLimit >= 0 &&
    parsedOverageLimit <= 10000
  const overageLimitDirty = overageLimitValid
    ? parsedOverageLimit !== savedOverageLimit
    : false

  const handleOverageLimitSave = async () => {
    if (!overageLimitValid) return
    await saveOverageSettings(overageEnabled, parsedOverageLimit)
  }

  const handleRenewalChange = async (
    subscriptionId: number,
    autoRenew: boolean
  ) => {
    setRenewalBusyId(subscriptionId)
    try {
      const res = await updateSubscriptionRenewal({
        user_subscription_id: subscriptionId,
        auto_renew: autoRenew,
      })
      if (res.success) {
        toast.success(t('Updated successfully'))
        await props.onRefresh()
      } else {
        toast.error(res.message || t('Update failed'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setRenewalBusyId(null)
    }
  }

  const hasActive = activeSubscriptions.length > 0
  const hasAny = allSubscriptions.length > 0
  const isAvailable =
    loading || plans.length > 0 || hasAny || pendingBankQROrders.length > 0

  // Mirrors the backend overage attribution rule: the active subscription that
  // ends first carries the per-period overage counter.
  const primaryActiveSub = useMemo(() => {
    if (activeSubscriptions.length === 0) return null
    return [...activeSubscriptions].sort((a, b) => {
      const endDiff =
        (a.subscription?.end_time || 0) - (b.subscription?.end_time || 0)
      if (endDiff !== 0) return endDiff
      return (a.subscription?.id || 0) - (b.subscription?.id || 0)
    })[0]
  }, [activeSubscriptions])
  const overageUsed = Number(
    primaryActiveSub?.subscription?.overage_used || 0
  )

  const planPurchaseCountMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const sub of allSubscriptions) {
      const planId = sub?.subscription?.plan_id
      if (!planId) continue
      map.set(planId, (map.get(planId) || 0) + 1)
    }
    return map
  }, [allSubscriptions])

  useEffect(() => {
    onAvailabilityChange?.(isAvailable)
  }, [isAvailable, onAvailabilityChange])

  const planTitleMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of plans) {
      if (p?.plan?.id) {
        map.set(p.plan.id, p.plan.title || '')
      }
    }
    return map
  }, [plans])

  const getRemainingDays = (sub: UserSubscriptionRecord) => {
    const endTime = sub?.subscription?.end_time || 0
    if (!endTime) return 0
    const now = Date.now() / 1000
    return Math.max(0, Math.ceil((endTime - now) / 86400))
  }

  const getUsagePercent = (sub: UserSubscriptionRecord) => {
    const total = Number(sub?.subscription?.amount_total || 0)
    const used = Number(sub?.subscription?.amount_used || 0)
    if (total <= 0) return 0
    return Math.round((used / total) * 100)
  }

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent className='space-y-4 p-3 sm:p-5'>
          <Skeleton className='h-20 w-full' />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {['first', 'second', 'third'].map((key) => (
              <Skeleton key={key} className='h-48 w-full' />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (plans.length === 0 && !hasAny && pendingBankQROrders.length === 0) {
    return null
  }

  return (
    <>
      <TitledCard
        title={t('Subscription Plans')}
        description={t('Subscribe to a plan for model access')}
        icon={<Crown className='h-4 w-4' />}
        iconTone='warning'
        disableHoverEffect
        contentClassName='space-y-4 sm:space-y-5'
      >
        {pendingBankQROrders.length > 0 && (
          <div className='border-warning/40 bg-warning/10 space-y-2 rounded-xl border p-3 sm:p-4'>
            <p className='text-sm font-medium'>
              {t('Pending Bank QR payments')}
            </p>
            {pendingBankQROrders.map((order) => (
              <div
                key={order.trade_no}
                className='bg-background/70 flex flex-col gap-2 rounded-md border p-2.5 sm:flex-row sm:items-center sm:justify-between'
              >
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium'>
                    {order.plan_title || `#${order.plan_id}`}
                  </p>
                  <code className='text-muted-foreground text-xs'>
                    {order.trade_no}
                  </code>
                </div>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setProofTradeNo(order.trade_no)}
                >
                  {t('Submit payment proof')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {/* My subscriptions & billing preference */}
        <div className='rounded-xl border p-3 sm:p-4'>
          <div className='flex flex-wrap items-center justify-between gap-2.5 sm:gap-3'>
            <div className='flex min-w-0 flex-wrap items-center gap-2'>
              <span className='text-sm font-medium'>
                {t('My Subscriptions')}
              </span>
              <span className='flex items-center gap-1.5 text-xs font-medium'>
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    hasActive ? dotColorMap.success : dotColorMap.neutral
                  )}
                  aria-hidden='true'
                />
                {hasActive ? (
                  <span className={cn(textColorMap.success)}>
                    {activeSubscriptions.length} {t('active')}
                  </span>
                ) : (
                  <span className='text-muted-foreground'>
                    {t('No Active')}
                  </span>
                )}
                {allSubscriptions.length > activeSubscriptions.length && (
                  <>
                    <span className='text-muted-foreground'>·</span>
                    <span className='text-muted-foreground'>
                      {allSubscriptions.length - activeSubscriptions.length}{' '}
                      {t('expired')}
                    </span>
                  </>
                )}
              </span>
            </div>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8'
              onClick={() => void props.onRefresh()}
              disabled={props.refreshing}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${props.refreshing ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>

          {hasActive && (
            <div className='bg-muted/40 mt-3 space-y-2.5 rounded-lg border p-3'>
              <div className='flex items-center justify-between gap-3'>
                <div className='min-w-0'>
                  <p className='text-sm font-medium'>{t('Extra usage')}</p>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'When subscription quota runs out, continue with wallet balance at pay-as-you-go rates'
                    )}
                  </p>
                </div>
                <Switch
                  checked={overageEnabled}
                  onCheckedChange={handleOverageToggle}
                />
              </div>
              {overageEnabled && (
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-muted-foreground text-xs'>
                    {t('Per-period limit (USD)')}
                  </span>
                  <Input
                    type='number'
                    min={0}
                    max={10000}
                    step='1'
                    value={overageLimitInput}
                    onChange={(e) => setOverageLimitInput(e.target.value)}
                    placeholder={t('No limit')}
                    className='h-8 w-28 text-xs'
                  />
                  {overageLimitDirty && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='h-8'
                      onClick={handleOverageLimitSave}
                      disabled={!overageLimitValid}
                    >
                      {t('Save')}
                    </Button>
                  )}
                  <span className='text-muted-foreground text-xs'>
                    {t('This period used')}: {formatQuota(overageUsed)}
                    {savedOverageLimit > 0
                      ? ` / ${formatCurrencyFromUSD(savedOverageLimit)}`
                      : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          {hasAny && (
            <>
              <Separator className='my-3' />
              <div className='max-h-64 space-y-3 overflow-y-auto pr-1'>
                {allSubscriptions.map((sub) => {
                  const subscription = sub.subscription
                  const totalAmount = Number(subscription?.amount_total || 0)
                  const usedAmount = Number(subscription?.amount_used || 0)
                  const remainAmount =
                    totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
                  const planTitle =
                    planTitleMap.get(subscription?.plan_id) || ''
                  const remainDays = getRemainingDays(sub)
                  const usagePercent = getUsagePercent(sub)
                  const now = Date.now() / 1000
                  const isExpired = (subscription?.end_time || 0) < now
                  const isCancelled = subscription?.status === 'cancelled'
                  const isActive =
                    subscription?.status === 'active' && !isExpired
                  const nextResetTime = subscription?.next_reset_time ?? 0
                  let statusBadge = (
                    <StatusBadge
                      label={t('Expired')}
                      variant='neutral'
                      copyable={false}
                    />
                  )
                  if (isActive) {
                    statusBadge = (
                      <StatusBadge
                        label={t('Active')}
                        variant='success'
                        copyable={false}
                      />
                    )
                  } else if (isCancelled) {
                    statusBadge = (
                      <StatusBadge
                        label={t('Cancelled')}
                        variant='neutral'
                        copyable={false}
                      />
                    )
                  }

                  let endTimeLabel = t('Expired at')
                  if (isActive) {
                    endTimeLabel = t('Until')
                  } else if (isCancelled) {
                    endTimeLabel = t('Cancelled at')
                  }

                  return (
                    <div
                      key={subscription?.id}
                      className='bg-background rounded-md border p-3 text-xs'
                    >
                      <div className='flex items-center justify-between'>
                        <div className='flex items-center gap-2'>
                          <span className='font-medium'>
                            {planTitle
                              ? `${planTitle} · ${t('Subscription')} #${subscription?.id}`
                              : `${t('Subscription')} #${subscription?.id}`}
                          </span>
                          {statusBadge}
                        </div>
                        {isActive && (
                          <span className='text-muted-foreground'>
                            {t('{{count}} days remaining', {
                              count: remainDays,
                            })}
                          </span>
                        )}
                      </div>
                      <div className='text-muted-foreground mt-1.5'>
                        {endTimeLabel}{' '}
                        {new Date(
                          (subscription?.end_time || 0) * 1000
                        ).toLocaleString()}
                      </div>
                      {isActive && nextResetTime > 0 && (
                        <div className='text-muted-foreground mt-1'>
                          {t('Next reset')}:{' '}
                          {new Date(nextResetTime * 1000).toLocaleString()}
                        </div>
                      )}
                      <div className='text-muted-foreground mt-1'>
                        {t('Total Quota')}:{' '}
                        {totalAmount > 0 ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={<span className='cursor-help' />}
                            >
                              {formatQuota(usedAmount)}/
                              {formatQuota(totalAmount)} · {t('Remaining')}{' '}
                              {formatQuota(remainAmount)}
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('Raw Quota')}: {usedAmount}/{totalAmount} ·{' '}
                              {t('Remaining')} {remainAmount}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          t('Unlimited')
                        )}
                        {totalAmount > 0 && (
                          <span className='ml-2'>
                            {t('Used')} {usagePercent}%
                          </span>
                        )}
                      </div>
                      {totalAmount > 0 && isActive && (
                        <Progress value={usagePercent} className='mt-2 h-1.5' />
                      )}
                      {isActive && subscription?.provider_subscription_id && (
                        <div className='mt-2 flex items-center justify-between gap-2'>
                          <span
                            className={cn(
                              subscription?.auto_renew
                                ? textColorMap.success
                                : 'text-muted-foreground'
                            )}
                          >
                            {subscription?.auto_renew
                              ? t('Auto-renews at period end')
                              : t('Auto-renew cancelled')}
                          </span>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-6 px-2 text-xs'
                            disabled={renewalBusyId === subscription?.id}
                            onClick={() =>
                              handleRenewalChange(
                                subscription.id,
                                !subscription.auto_renew
                              )
                            }
                          >
                            {subscription?.auto_renew
                              ? t('Cancel auto-renew')
                              : t('Resume auto-renew')}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {!hasAny && (
            <p className='text-muted-foreground mt-2 text-xs'>
              {t('Subscribe to a plan for model access')}
            </p>
          )}
        </div>

        {/* Available plans grid */}
        {plans.length > 0 ? (
          <div className='grid grid-cols-1 gap-3 2xl:grid-cols-2 2xl:gap-4'>
            {plans.map((p, index) => {
              const plan = p?.plan
              if (!plan) return null
              const totalAmount = Number(plan.total_amount || 0)
              const price = Number(plan.price_amount || 0)
              const isPopular = index === 0 && plans.length > 1
              const limit = Number(plan.max_purchase_per_user || 0)
              const count = planPurchaseCountMap.get(plan.id) || 0
              const reached = limit > 0 && count >= limit

              const benefits = [
                `${t('Validity Period')}: ${formatDuration(plan, t)}`,
                formatResetPeriod(plan, t) !== t('No Reset')
                  ? `${t('Quota Reset')}: ${formatResetPeriod(plan, t)}`
                  : null,
                totalAmount > 0
                  ? `${t('Total Quota')}: ${formatQuota(totalAmount)}`
                  : `${t('Total Quota')}: ${t('Unlimited')}`,
                limit > 0 ? `${t('Purchase Limit')}: ${limit}` : null,
                plan.upgrade_group
                  ? `${t('Upgrade Group')}: ${plan.upgrade_group}`
                  : null,
              ].filter(Boolean) as string[]

              return (
                <Card
                  key={plan.id}
                  data-card-hover='false'
                  className={cn(isPopular && 'border-primary/70 shadow-sm')}
                >
                  <CardContent className='flex h-full flex-col p-3.5 sm:p-4'>
                    <div className='mb-2 flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <h4 className='truncate font-semibold'>
                          {plan.title || t('Subscription Plans')}
                        </h4>
                        {plan.subtitle && (
                          <p className='text-muted-foreground truncate text-xs'>
                            {plan.subtitle}
                          </p>
                        )}
                      </div>
                      {isPopular && (
                        <StatusBadge
                          variant='info'
                          copyable={false}
                          className='shrink-0'
                        >
                          <Sparkles className='h-3 w-3' />
                          {t('Recommended')}
                        </StatusBadge>
                      )}
                    </div>

                    <div className='py-2'>
                      <span className='text-primary text-2xl font-bold'>
                        {formatCurrencyFromUSD(price)}
                      </span>
                    </div>

                    <div className='flex-1 space-y-1.5 pb-3'>
                      {benefits.map((label) => (
                        <div
                          key={label}
                          className='text-muted-foreground flex items-center gap-2 text-xs'
                        >
                          <Check className='text-primary h-3 w-3 shrink-0' />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>

                    <Separator className='mb-3' />

                    {reached ? (
                      <Tooltip>
                        <TooltipTrigger render={<div />}>
                          <Button variant='outline' className='w-full' disabled>
                            {t('Limit Reached')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('Purchase limit reached')} ({count}/{limit})
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant='outline'
                        className='w-full'
                        onClick={() => {
                          setSelectedPlan(p)
                          setPurchaseOpen(true)
                        }}
                      >
                        {t('Subscribe Now')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <p className='text-muted-foreground py-4 text-center text-sm'>
            {t('No plans available')}
          </p>
        )}
      </TitledCard>

      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            void props.onRefresh()
          }
        }}
        plan={selectedPlan}
        enableStripe={enableStripe}
        enableCreem={enableCreem}
        enableWaffoPancake={enableWaffoPancake}
        enableOnlineTopUp={enableOnlineTopUp}
        enableBankQR={!!props.topupInfo?.enable_bank_qr_topup}
        epayMethods={epayMethods}
        userQuota={props.userQuota}
        onPurchaseSuccess={props.onPurchaseSuccess}
        purchaseLimit={
          selectedPlan?.plan?.max_purchase_per_user
            ? Number(selectedPlan.plan.max_purchase_per_user)
            : undefined
        }
        purchaseCount={
          selectedPlan?.plan?.id
            ? planPurchaseCountMap.get(selectedPlan.plan.id)
            : undefined
        }
      />
      <TopUpProofDialog
        open={proofTradeNo !== null}
        onOpenChange={(open) => !open && setProofTradeNo(null)}
        tradeNo={proofTradeNo}
        onSubmitted={() => void props.onRefresh()}
      />
    </>
  )
}
