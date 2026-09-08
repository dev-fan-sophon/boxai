import { CouponSettings } from '@/features/billing/promotions/coupon-settings'
import { PromotionSettings } from '@/features/billing/promotions/promotion-settings'

export default function TopUpPromotionsTab() {
  return (
    <div className='space-y-6'>
      <PromotionSettings />
      <CouponSettings />
    </div>
  )
}
