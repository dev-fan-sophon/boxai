import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { defaultBillingSettings } from '@/features/system-settings/billing/settings-defaults'
import { PricingSection } from '@/features/system-settings/general/pricing-section'
import {
  getOptionValue,
  useSystemOptions,
} from '@/features/system-settings/hooks/use-system-options'
import { PaymentSettingsSection } from '@/features/system-settings/integrations/payment-settings-section'
import { RatioSettingsCard } from '@/features/system-settings/models/ratio-settings-card'
import { parseCurrencyDisplayType } from '@/lib/currency'

import type { PricingCenterTab } from './tabs'

export function PricingSettingsTab(props: {
  tab: Exclude<
    PricingCenterTab,
    'models' | 'subscriptions' | 'redemption' | 'topup-reviews'
  >
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useSystemOptions()

  const settings = useMemo(
    () => getOptionValue(data?.data, defaultBillingSettings),
    [data?.data]
  )

  if (isLoading) {
    return (
      <div className='text-muted-foreground flex min-h-40 items-center justify-center text-sm'>
        {t('Loading settings...')}
      </div>
    )
  }

  if (props.tab === 'groups') {
    return (
      <RatioSettingsCard
        titleKey='Groups & Tools'
        groupDefaults={{
          TopupGroupRatio: settings.TopupGroupRatio,
          GroupRatio: settings.GroupRatio,
          UserUsableGroups: settings.UserUsableGroups,
          GroupGroupRatio: settings.GroupGroupRatio,
          AutoGroups: settings.AutoGroups,
          DefaultUseAutoGroup: settings.DefaultUseAutoGroup,
          GroupSpecialUsableGroup:
            settings['group_ratio_setting.group_special_usable_group'],
        }}
        toolPricesDefault={settings['tool_price_setting.prices']}
        visibleTabs={['groups', 'tool-prices']}
      />
    )
  }

  if (props.tab === 'currency') {
    return (
      <PricingSection
        defaultValues={{
          QuotaPerUnit: settings.QuotaPerUnit,
          USDExchangeRate: settings.USDExchangeRate,
          DisplayInCurrencyEnabled: settings.DisplayInCurrencyEnabled,
          DisplayTokenStatEnabled: settings.DisplayTokenStatEnabled,
          ExposeRatioEnabled: settings.ExposeRatioEnabled,
          general_setting: {
            quota_display_type: parseCurrencyDisplayType(
              settings['general_setting.quota_display_type']
            ),
            custom_currency_symbol:
              settings['general_setting.custom_currency_symbol'] ?? '¤',
            custom_currency_exchange_rate:
              settings['general_setting.custom_currency_exchange_rate'] ?? 1,
            business_timezone:
              settings['general_setting.business_timezone'] ??
              'Asia/Ho_Chi_Minh',
          },
        }}
      />
    )
  }

  return (
    <PaymentSettingsSection
      defaultValues={{
        PayAddress: settings.PayAddress,
        EpayId: settings.EpayId,
        EpayKey: settings.EpayKey,
        Price: settings.Price,
        MinTopUp: settings.MinTopUp,
        CustomCallbackAddress: settings.CustomCallbackAddress,
        PayMethods: settings.PayMethods,
        AmountOptions: settings['payment_setting.amount_options'],
        AmountDiscount: settings['payment_setting.amount_discount'],
        StripeApiSecret: settings.StripeApiSecret,
        StripeWebhookSecret: settings.StripeWebhookSecret,
        StripePriceId: settings.StripePriceId,
        StripeUnitPrice: settings.StripeUnitPrice,
        StripeMinTopUp: settings.StripeMinTopUp,
        StripePromotionCodesEnabled: settings.StripePromotionCodesEnabled,
        CreemApiKey: settings.CreemApiKey,
        CreemWebhookSecret: settings.CreemWebhookSecret,
        CreemTestMode: settings.CreemTestMode,
        CreemProducts: settings.CreemProducts,
        bank_qr_setting: {
          enabled: settings['bank_qr_setting.enabled'] ?? false,
          bank_name: settings['bank_qr_setting.bank_name'] ?? '',
          bank_bin: settings['bank_qr_setting.bank_bin'] ?? '',
          account_number: settings['bank_qr_setting.account_number'] ?? '',
          account_name: settings['bank_qr_setting.account_name'] ?? '',
          min_topup: settings['bank_qr_setting.min_topup'] ?? 1,
          transfer_prefix:
            settings['bank_qr_setting.transfer_prefix'] ?? 'BOXAI',
        },
      }}
      waffoDefaultValues={{
        WaffoEnabled: settings.WaffoEnabled ?? false,
        WaffoApiKey: settings.WaffoApiKey ?? '',
        WaffoPrivateKey: settings.WaffoPrivateKey ?? '',
        WaffoPublicCert: settings.WaffoPublicCert ?? '',
        WaffoSandboxPublicCert: settings.WaffoSandboxPublicCert ?? '',
        WaffoSandboxApiKey: settings.WaffoSandboxApiKey ?? '',
        WaffoSandboxPrivateKey: settings.WaffoSandboxPrivateKey ?? '',
        WaffoSandbox: settings.WaffoSandbox ?? false,
        WaffoMerchantId: settings.WaffoMerchantId ?? '',
        WaffoCurrency: settings.WaffoCurrency ?? 'USD',
        WaffoUnitPrice: settings.WaffoUnitPrice ?? 1,
        WaffoMinTopUp: settings.WaffoMinTopUp ?? 1,
        WaffoNotifyUrl: settings.WaffoNotifyUrl ?? '',
        WaffoReturnUrl: settings.WaffoReturnUrl ?? '',
        WaffoPayMethods: settings.WaffoPayMethods ?? '[]',
      }}
      waffoPancakeDefaultValues={{
        WaffoPancakeMerchantID: settings.WaffoPancakeMerchantID ?? '',
        WaffoPancakePrivateKey: settings.WaffoPancakePrivateKey ?? '',
        WaffoPancakeReturnURL: settings.WaffoPancakeReturnURL ?? '',
      }}
      waffoPancakeProvisionedStoreID={settings.WaffoPancakeStoreID ?? ''}
      waffoPancakeProvisionedProductID={settings.WaffoPancakeProductID ?? ''}
    />
  )
}
