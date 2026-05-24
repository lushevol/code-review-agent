import type { AdoWebApi } from "./interfaces";

export async function getSubscriptions() {
  const webApi = this.adoWebApi as AdoWebApi;
  const notificationApi = await webApi.getNotificationApi();
  const subscriptions = await notificationApi.listSubscriptions();

  return subscriptions;
}

export async function getSubscriptionById(subscriptionId: string) {
  const webApi = this.adoWebApi as AdoWebApi;
  const notificationApi = await webApi.getNotificationApi();
  const subscription = await notificationApi.getSubscription(subscriptionId);

  return subscription;
}
