import { useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { getSelf } from '@/lib/api'

import { BalanceHero } from './components/balance-hero'
import { BillingNav } from './components/billing-nav'
import {
  AddCreditsDialog,
  type TopUpStep,
} from './components/dialogs/add-credits-dialog'
import { RedeemCodeDialog } from './components/dialogs/redeem-code-dialog'
import { SubscriptionPlansCard } from './components/subscription-plans-card'
import { TransactionsSection } from './components/transactions-section'
import { ZaloCommunityCard } from './components/zalo-community-card'
import { BILLING_QUERY_KEYS, DEFAULT_DISCOUNT_RATE } from './constants'
import {
  useTopupInfo,
  usePayment,
  useRedemption,
  useCreemPayment,
  useWaffoPayment,
  useWaffoPancakePayment,
  useBankQRPayment,
  useSubscriptionCenter,
} from './hooks'
import {
  getDefaultPaymentType,
  getMinTopupAmount,
  isBankQRPayment,
  isWaffoPancakePayment,
  summarizeActiveSubscriptions,
} from './lib'
import { PromotionBanner } from './promotions/promotion-banner'
import type {
  BankQRPaymentData,
  UserWalletData,
  PaymentMethod,
  PresetAmount,
  CreemProduct,
} from './types'

interface BillingProps {
  initialShowHistory?: boolean
  paymentResult?: 'success' | 'fail' | 'pending'
}

const SECTION_IDS = {
  overview: 'billing-overview',
  subscription: 'billing-subscription',
  history: 'billing-history',
} as const

export function Billing(props: BillingProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [topupAmount, setTopupAmount] = useState(0)
  const [couponCode, setCouponCode] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>()
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null)
  const [addCreditsOpen, setAddCreditsOpen] = useState(false)
  const [topUpStep, setTopUpStep] = useState<TopUpStep>('configure')
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false)
  const [redemptionCode, setRedemptionCode] = useState('')
  const [selectedCreemProduct, setSelectedCreemProduct] =
    useState<CreemProduct | null>(null)
  const [showSubscriptionSection, setShowSubscriptionSection] = useState(true)
  const [bankQRPayment, setBankQRPayment] = useState<BankQRPaymentData | null>(
    null
  )

  const {
    topupInfo,
    presetAmounts,
    loading: topupLoading,
    isError: topupError,
    refetch: refetchTopupInfo,
  } = useTopupInfo()
  const subscriptionCenter = useSubscriptionCenter()

  const {
    amount: paymentAmount,
    quote,
    calculating,
    processing,
    calculatePaymentAmount,
    processPayment,
  } = usePayment()
  const { redeeming, redeemCode } = useRedemption()
  const { processing: creemProcessing, processCreemPayment } = useCreemPayment()
  const { processWaffoPayment } = useWaffoPayment()
  const { processing: pancakeProcessing, processWaffoPancakePayment } =
    useWaffoPancakePayment()
  const { processing: bankQRProcessing, processBankQRPayment } =
    useBankQRPayment()

  const walletQuery = useQuery({
    queryKey: BILLING_QUERY_KEYS.wallet,
    queryFn: async () => {
      const response = await getSelf()
      if (!response.success || !response.data) {
        throw new Error(
          response.message || i18next.t('Failed to load account balance')
        )
      }
      return response.data as UserWalletData
    },
    retry: false,
  })
  const user = walletQuery.data ?? null

  // Balance changes after payments and redemptions; history gains new orders.
  const refreshAfterPayment = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEYS.wallet }),
      queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEYS.history }),
    ])
  }, [queryClient])

  const invalidateHistory = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: BILLING_QUERY_KEYS.history,
    })
  }, [queryClient])

  const openAddCredits = () => {
    setTopUpStep('configure')
    setBankQRPayment(null)
    setSelectedCreemProduct(null)
    setAddCreditsOpen(true)
  }

  // Gateways return to /billing?pay=..., and legacy links land with
  // show_history=true; both are consumed once and cleared from the URL.
  useEffect(() => {
    if (!props.paymentResult) return
    if (props.paymentResult === 'success') {
      toast.success(t('Payment successful'))
    } else if (props.paymentResult === 'fail') {
      toast.error(t('Payment failed'))
    } else {
      toast.info(t('Payment is being processed'))
    }
    window.history.replaceState({}, '', window.location.pathname)
  }, [props.paymentResult, t])

  useEffect(() => {
    if (!props.initialShowHistory) return
    document
      .querySelector(`#${SECTION_IDS.history}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.replaceState({}, '', window.location.pathname)
  }, [props.initialShowHistory])

  // Initialize topup amount when topup info is loaded
  const amountInitialized = useRef(false)
  useEffect(() => {
    if (topupInfo && !amountInitialized.current) {
      amountInitialized.current = true
      const minTopup = getMinTopupAmount(topupInfo)
      setTopupAmount(minTopup)
      calculatePaymentAmount(minTopup, getDefaultPaymentType(topupInfo))
    }
  }, [topupInfo, topupAmount, calculatePaymentAmount])

  const getCurrentPaymentType = useCallback(() => {
    return selectedPaymentMethod?.type || getDefaultPaymentType(topupInfo)
  }, [selectedPaymentMethod, topupInfo])

  const requestAmountForPayment = useCallback((displayAmount: number) => {
    return Math.round(displayAmount)
  }, [])

  const handleSelectPreset = (preset: PresetAmount) => {
    setTopupAmount(preset.value)
    setSelectedPreset(preset.value)
    calculatePaymentAmount(
      requestAmountForPayment(preset.value),
      getCurrentPaymentType(),
      couponCode
    )
  }

  const handleTopupAmountChange = (amount: number) => {
    setTopupAmount(amount)
    setSelectedPreset(null)
    calculatePaymentAmount(
      requestAmountForPayment(amount),
      getCurrentPaymentType(),
      couponCode
    )
  }

  const handlePaymentMethodSelect = async (method: PaymentMethod) => {
    setSelectedPaymentMethod(method)
    await calculatePaymentAmount(
      requestAmountForPayment(topupAmount),
      method.type,
      couponCode
    )
  }

  // Moves the top-up dialog to its review step with the real calculated amount.
  const handleContinueToPay = async () => {
    if (!selectedPaymentMethod) return
    setPaymentLoading(selectedPaymentMethod.type)
    try {
      const methodMin = selectedPaymentMethod.min_topup || 0
      if (topupAmount < Math.max(getMinTopupAmount(topupInfo), methodMin)) {
        return
      }
      const calculatedAmount = await calculatePaymentAmount(
        requestAmountForPayment(topupAmount),
        selectedPaymentMethod.type,
        couponCode
      )
      if (calculatedAmount === null) return
      setTopUpStep('review')
    } finally {
      setPaymentLoading(null)
    }
  }

  const handlePaymentConfirm = async () => {
    if (!selectedPaymentMethod) return

    if (isBankQRPayment(selectedPaymentMethod.type)) {
      const bankPayment = await processBankQRPayment(
        requestAmountForPayment(topupAmount),
        couponCode
      )
      if (bankPayment) {
        setBankQRPayment(bankPayment)
        setTopUpStep('bank-qr')
        invalidateHistory()
      }
      return
    }

    const isPancake = isWaffoPancakePayment(selectedPaymentMethod.type)
    const requestAmount = requestAmountForPayment(topupAmount)
    const success = isPancake
      ? await processWaffoPancakePayment(requestAmount)
      : await processPayment(requestAmount, selectedPaymentMethod.type)

    if (success) {
      setAddCreditsOpen(false)
      await refreshAfterPayment()
    }
  }

  const handleRedeem = async () => {
    if (!redemptionCode) return
    const success = await redeemCode(redemptionCode)
    if (success) {
      setRedemptionCode('')
      setRedeemDialogOpen(false)
      await refreshAfterPayment()
    }
  }

  const handleCreemProductSelect = (product: CreemProduct) => {
    setSelectedCreemProduct(product)
    setTopUpStep('creem-review')
  }

  const handleCreemConfirm = async () => {
    if (!selectedCreemProduct) return
    const success = await processCreemPayment(selectedCreemProduct.productId)
    if (success) {
      setAddCreditsOpen(false)
      setSelectedCreemProduct(null)
      await refreshAfterPayment()
    }
  }

  const handleWaffoMethodSelect = async (_method: unknown, index: number) => {
    setPaymentLoading(`waffo-${index}`)
    try {
      await processWaffoPayment(topupAmount, index)
    } finally {
      setPaymentLoading(null)
    }
  }

  const handleSubscriptionAvailabilityChange = useCallback(
    (available: boolean) => setShowSubscriptionSection(available),
    []
  )

  const scrollToSection = (id: string) => {
    document
      .querySelector(`#${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const subscriptionSummary = useMemo(
    () =>
      summarizeActiveSubscriptions(
        subscriptionCenter.data.activeSubscriptions,
        subscriptionCenter.data.plans
      ),
    [subscriptionCenter.data.activeSubscriptions, subscriptionCenter.data.plans]
  )

  const navItems = [
    { id: SECTION_IDS.overview, label: t('Overview') },
    ...(showSubscriptionSection
      ? [{ id: SECTION_IDS.subscription, label: t('Subscription') }]
      : []),
    { id: SECTION_IDS.history, label: t('Billing History') },
  ]

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Billing')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-6xl flex-col gap-5'>
            <BillingNav items={navItems} />
            <PromotionBanner position='billing' />

            <section id={SECTION_IDS.overview} className='scroll-mt-16'>
              <BalanceHero
                user={user}
                loading={walletQuery.isPending}
                isError={walletQuery.isError}
                onRetry={() => void walletQuery.refetch()}
                subscription={subscriptionSummary}
                subscriptionLoading={subscriptionCenter.loading}
                subscriptionError={subscriptionCenter.isError}
                onRetrySubscription={() => void subscriptionCenter.refetch()}
                redemptionEnabled={topupInfo?.enable_redemption !== false}
                onAddCredits={openAddCredits}
                onRedeem={() => setRedeemDialogOpen(true)}
                onManageSubscription={() =>
                  scrollToSection(SECTION_IDS.subscription)
                }
              />
            </section>

            <ZaloCommunityCard />

            <section id={SECTION_IDS.subscription} className='scroll-mt-16'>
              <SubscriptionPlansCard
                topupInfo={topupInfo}
                data={subscriptionCenter.data}
                loading={subscriptionCenter.loading}
                isError={subscriptionCenter.isError}
                onRetry={() => void subscriptionCenter.refetch()}
                refreshing={subscriptionCenter.refreshing}
                onRefresh={subscriptionCenter.refresh}
                onOverageChange={subscriptionCenter.applyOverageSettings}
                onAvailabilityChange={handleSubscriptionAvailabilityChange}
                userQuota={user?.quota}
                onPurchaseSuccess={refreshAfterPayment}
              />
            </section>

            <section id={SECTION_IDS.history} className='scroll-mt-16'>
              <TransactionsSection />
            </section>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <AddCreditsDialog
        open={addCreditsOpen}
        onOpenChange={setAddCreditsOpen}
        step={topUpStep}
        onStepChange={setTopUpStep}
        topupInfo={topupLoading ? null : topupInfo}
        loading={topupLoading}
        isError={topupError}
        onRetry={() => void refetchTopupInfo()}
        presetAmounts={presetAmounts}
        selectedPreset={selectedPreset}
        onSelectPreset={handleSelectPreset}
        topupAmount={topupAmount}
        onTopupAmountChange={handleTopupAmountChange}
        paymentAmount={paymentAmount}
        quote={quote}
        couponCode={couponCode}
        onCouponCodeChange={(code) => {
          setCouponCode(code)
          void calculatePaymentAmount(
            requestAmountForPayment(topupAmount),
            getCurrentPaymentType(),
            code
          )
        }}
        calculating={calculating}
        selectedPaymentMethod={selectedPaymentMethod}
        onPaymentMethodSelect={handlePaymentMethodSelect}
        onContinueToPay={handleContinueToPay}
        paymentLoading={paymentLoading}
        creemProducts={topupInfo?.creem_products}
        onCreemProductSelect={handleCreemProductSelect}
        waffoPayMethods={topupInfo?.waffo_pay_methods}
        onWaffoMethodSelect={handleWaffoMethodSelect}
        onConfirmPayment={handlePaymentConfirm}
        processing={processing || pancakeProcessing || bankQRProcessing}
        discountRate={
          topupInfo?.discount?.[topupAmount] || DEFAULT_DISCOUNT_RATE
        }
        selectedCreemProduct={selectedCreemProduct}
        onConfirmCreem={handleCreemConfirm}
        creemProcessing={creemProcessing}
        bankQRPayment={bankQRPayment}
        onBankQROrderChanged={invalidateHistory}
      />

      <RedeemCodeDialog
        open={redeemDialogOpen}
        onOpenChange={setRedeemDialogOpen}
        enabled={topupInfo?.enable_redemption !== false}
        code={redemptionCode}
        onCodeChange={setRedemptionCode}
        onRedeem={handleRedeem}
        redeeming={redeeming}
        topupLink={topupInfo?.topup_link}
      />
    </>
  )
}
