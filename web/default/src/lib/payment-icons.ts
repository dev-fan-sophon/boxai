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
import type { IconType } from 'react-icons'
import {
  LuBanknote,
  LuBuilding2,
  LuCircleDollarSign,
  LuCoins,
  LuCreditCard,
  LuDollarSign,
  LuGift,
  LuLandmark,
  LuQrCode,
  LuReceipt,
  LuShieldCheck,
  LuSmartphone,
  LuWallet,
} from 'react-icons/lu'
import {
  SiAdyen,
  SiAlipay,
  SiAmericanexpress,
  SiApple,
  SiApplepay,
  SiBinance,
  SiBitcoin,
  SiCashapp,
  SiCoinbase,
  SiDiscover,
  SiDogecoin,
  SiEthereum,
  SiGithub,
  SiGoogle,
  SiGooglepay,
  SiJcb,
  SiKlarna,
  SiLitecoin,
  SiMastercard,
  SiMercadopago,
  SiMonero,
  SiPaddle,
  SiPayoneer,
  SiPaypal,
  SiPaytm,
  SiPhonepe,
  SiPix,
  SiRazorpay,
  SiRevolut,
  SiSepa,
  SiShopify,
  SiSolana,
  SiSquare,
  SiStripe,
  SiTether,
  SiVenmo,
  SiVisa,
  SiWechat,
  SiWesternunion,
  SiWise,
  SiXrp,
} from 'react-icons/si'

/**
 * Payment method icons are configured by name in the admin console, so they
 * cannot be statically analysed per call site. Resolving arbitrary names used
 * to require dynamically importing whole `react-icons` families (~40 MB of
 * chunks, including a 6.5 MB game-icons pack a wallet page could pull in).
 * This curated registry covers the payment, banking and crypto brands the
 * setting is meant for while staying tree-shakeable.
 */
export const PAYMENT_ICON_REGISTRY: Record<string, IconType> = {
  LuBanknote,
  LuBuilding2,
  LuCircleDollarSign,
  LuCoins,
  LuCreditCard,
  LuDollarSign,
  LuGift,
  LuLandmark,
  LuQrCode,
  LuReceipt,
  LuShieldCheck,
  LuSmartphone,
  LuWallet,
  SiAdyen,
  SiAlipay,
  SiAmericanexpress,
  SiApple,
  SiApplepay,
  SiBinance,
  SiBitcoin,
  SiCashapp,
  SiCoinbase,
  SiDiscover,
  SiDogecoin,
  SiEthereum,
  SiGithub,
  SiGoogle,
  SiGooglepay,
  SiJcb,
  SiKlarna,
  SiLitecoin,
  SiMastercard,
  SiMercadopago,
  SiMonero,
  SiPaddle,
  SiPayoneer,
  SiPaypal,
  SiPaytm,
  SiPhonepe,
  SiPix,
  SiRazorpay,
  SiRevolut,
  SiSepa,
  SiShopify,
  SiSolana,
  SiSquare,
  SiStripe,
  SiTether,
  SiVenmo,
  SiVisa,
  SiWechat,
  SiWesternunion,
  SiWise,
  SiXrp,
}

/** Sorted names an admin can enter, surfaced by the payment method editors. */
export const SUPPORTED_PAYMENT_ICON_NAMES = Object.keys(
  PAYMENT_ICON_REGISTRY
).sort()
