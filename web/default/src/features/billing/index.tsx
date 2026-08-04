import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { getSelf } from '@/lib/api'

import { BalanceHero } from './components/balance-hero'
import { BillingNav } from './components/billing-nav'
import { AddCreditsDialog } from './components/dialogs/add-credits-dialog'
import { BankQRPaymentDialog } from './components/dialogs/bank-qr-payment-dialog'
import { CreemConfirmDialog } from './components/dialogs/creem-confirm-dialog'
import { PaymentConfirmDialog } from './components/dialogs/payment-confirm-dialog'
import { RedeemCodeDialog } from './components/dialogs/redeem-code-dialog'
import { SubscriptionPlansCard } from './components/subscription-plans-card'
import { TransactionsSection } from './components/transactions-section'
import { ZaloCommunityCard } from './components/zalo-community-card'
import { DEFAULT_DISCOUNT_RATE } from './constants'
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
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [topupAmount, setTopupAmount] = useState(0)
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>()
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null)
  const [addCreditsOpen, setAddCreditsOpen] = useState(false)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false)
  const [redemptionCode, setRedemptionCode] = useState('')
  const [creemDialogOpen, setCreemDialogOpen] = useState(false)
  const [selectedCreemProduct, setSelectedCreemProduct] =
    useState<CreemProduct | null>(null)
  const [showSubscriptionSection, setShowSubscriptionSection] = useState(true)
  const [bankQRDialogOpen, setBankQRDialogOpen] = useState(false)
  const [bankQRPayment, setBankQRPayment] = useState<BankQRPaymentData | null>(
    null
  )

  const { topupInfo, presetAmounts, loading: topupLoading } = useTopupInfo()
  const subscriptionCenter = useSubscriptionCenter()

  const {
    amount: paymentAmount,
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

  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

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
  useEffect(() => {
    if (topupInfo && topupAmount === 0) {
      const minTopup = getMinTopupAmount(topupInfo)
      setTopupAmount(minTopup)
      calculatePaymentAmount(minTopup, getDefaultPaymentType(topupInfo))
    }
  }, [topupInfo, topupAmount, calculatePaymentAmount])

  const getCurrentPaymentType = useCallback(() => {
    return selectedPaymentMethod?.type || getDefaultPaymentType(topupInfo)
  }, [selectedPaymentMethod, topupInfo])

  const handleSelectPreset = (preset: PresetAmount) => {
    setTopupAmount(preset.value)
    setSelectedPreset(preset.value)
    calculatePaymentAmount(preset.value, getCurrentPaymentType())
  }

  const handleTopupAmountChange = (amount: number) => {
    setTopupAmount(amount)
    setSelectedPreset(null)
    calculatePaymentAmount(amount, getCurrentPaymentType())
  }

  const handlePaymentMethodSelect = async (method: PaymentMethod) => {
    setSelectedPaymentMethod(method)
    await calculatePaymentAmount(topupAmount, method.type)
  }

  // Opens the layered confirm dialog with the real calculated amount.
  const handleContinueToPay = async () => {
    if (!selectedPaymentMethod) return
    setPaymentLoading(selectedPaymentMethod.type)
    try {
      const methodMin = selectedPaymentMethod.min_topup || 0
      if (topupAmount < Math.max(getMinTopupAmount(topupInfo), methodMin)) {
        return
      }
      const calculatedAmount = await calculatePaymentAmount(
        topupAmount,
        selectedPaymentMethod.type
      )
      if (calculatedAmount === null) return
      setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  const handlePaymentConfirm = async () => {
    if (!selectedPaymentMethod) return

    if (isBankQRPayment(selectedPaymentMethod.type)) {
      const bankPayment = await processBankQRPayment(topupAmount)
      if (bankPayment) {
        setConfirmDialogOpen(false)
        setAddCreditsOpen(false)
        setBankQRPayment(bankPayment)
        setBankQRDialogOpen(true)
      }
      return
    }

    const isPancake = isWaffoPancakePayment(selectedPaymentMethod.type)
    const success = isPancake
      ? await processWaffoPancakePayment(topupAmount)
      : await processPayment(topupAmount, selectedPaymentMethod.type)

    if (success) {
      setConfirmDialogOpen(false)
      setAddCreditsOpen(false)
      await fetchUser()
    }
  }

  const handleRedeem = async () => {
    if (!redemptionCode) return
    const success = await redeemCode(redemptionCode)
    if (success) {
      setRedemptionCode('')
      setRedeemDialogOpen(false)
      await fetchUser()
    }
  }

  const handleCreemProductSelect = (product: CreemProduct) => {
    setSelectedCreemProduct(product)
    setCreemDialogOpen(true)
  }

  const handleCreemConfirm = async () => {
    if (!selectedCreemProduct) return
    const success = await processCreemPayment(selectedCreemProduct.productId)
    if (success) {
      setCreemDialogOpen(false)
      setSelectedCreemProduct(null)
      await fetchUser()
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

            <section id={SECTION_IDS.overview} className='scroll-mt-16'>
              <BalanceHero
                user={user}
                loading={userLoading}
                subscription={subscriptionSummary}
                subscriptionLoading={subscriptionCenter.loading}
                redemptionEnabled={topupInfo?.enable_redemption !== false}
                onAddCredits={() => setAddCreditsOpen(true)}
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
                refreshing={subscriptionCenter.refreshing}
                onRefresh={subscriptionCenter.refresh}
                onOverageChange={subscriptionCenter.applyOverageSettings}
                onAvailabilityChange={handleSubscriptionAvailabilityChange}
                userQuota={user?.quota}
                onPurchaseSuccess={fetchUser}
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
        topupInfo={topupLoading ? null : topupInfo}
        presetAmounts={presetAmounts}
        selectedPreset={selectedPreset}
        onSelectPreset={handleSelectPreset}
        topupAmount={topupAmount}
        onTopupAmountChange={handleTopupAmountChange}
        paymentAmount={paymentAmount}
        calculating={calculating}
        selectedPaymentMethod={selectedPaymentMethod}
        onPaymentMethodSelect={handlePaymentMethodSelect}
        onContinueToPay={handleContinueToPay}
        paymentLoading={paymentLoading}
        creemProducts={topupInfo?.creem_products}
        onCreemProductSelect={handleCreemProductSelect}
        waffoPayMethods={topupInfo?.waffo_pay_methods}
        onWaffoMethodSelect={handleWaffoMethodSelect}
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

      <PaymentConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        onConfirm={handlePaymentConfirm}
        topupAmount={topupAmount}
        paymentAmount={paymentAmount}
        paymentMethod={selectedPaymentMethod}
        calculating={calculating}
        processing={processing || pancakeProcessing || bankQRProcessing}
        discountRate={
          topupInfo?.discount?.[topupAmount] || DEFAULT_DISCOUNT_RATE
        }
      />

      <CreemConfirmDialog
        open={creemDialogOpen}
        onOpenChange={setCreemDialogOpen}
        onConfirm={handleCreemConfirm}
        product={selectedCreemProduct}
        processing={creemProcessing}
      />

      <BankQRPaymentDialog
        open={bankQRDialogOpen}
        onOpenChange={setBankQRDialogOpen}
        payment={bankQRPayment}
      />
    </>
  )
}
