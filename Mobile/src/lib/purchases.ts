import { NativeModules, Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { requireSessionUser } from '@/lib/account-read-model';
import { apiRequest } from '@/lib/api-client';

export type { PurchasesPackage };
const key = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
export const purchasesConfigured = Boolean(key && ['ios', 'android'].includes(Platform.OS) && NativeModules.RNPurchases);
let configured = false;
let identityTask: Promise<void> = Promise.resolve();

async function purchasesForCurrentUser() {
  if (!purchasesConfigured) throw new Error('Gói đăng ký hiện chưa khả dụng trên bản ứng dụng này.');
  const user = await requireSessionUser();
  // Loading lazily keeps older development clients and the web preview bootable.
  const Purchases = (await import('react-native-purchases')).default;
  identityTask = identityTask.catch(() => undefined).then(async () => {
    if (!configured) { Purchases.configure({ apiKey: key!, appUserID: user.id }); configured = true; }
    else if (await Purchases.getAppUserID() !== user.id) await Purchases.logIn(user.id);
  });
  await identityTask;
  if ((await requireSessionUser()).id !== user.id) throw new Error('Tài khoản đã thay đổi. Vui lòng mở lại trang đăng ký.');
  return { Purchases, userId: user.id };
}

export async function loadStorePackages() {
  if (!purchasesConfigured) return [];
  const { Purchases } = await purchasesForCurrentUser();
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages.filter((item) => Boolean(item.product.subscriptionPeriod)) ?? [];
}

async function verifyCurrentUser(userId: string) {
  if ((await requireSessionUser()).id !== userId) throw new Error('Tài khoản đã thay đổi. Vui lòng đăng nhập lại tài khoản mua gói rồi khôi phục giao dịch.');
  return apiRequest<{ data: { tier: 'free' | 'plus' | 'pro'; expiresAt: string | null } | null }>('/api/subscriptions/sync', { method: 'POST', body: {}, timeoutMs: 20_000 });
}

export async function purchasePackage(item: PurchasesPackage) {
  const { Purchases, userId } = await purchasesForCurrentUser();
  await Purchases.purchasePackage(item);
  return verifyCurrentUser(userId);
}

export async function restorePurchases() {
  const { Purchases, userId } = await purchasesForCurrentUser();
  await Purchases.restorePurchases();
  return verifyCurrentUser(userId);
}
