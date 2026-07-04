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

export async function createSubscription(
  url: string,
  eventType: string,
): Promise<unknown> {
  const webApi = this.adoWebApi as AdoWebApi;
  const response = await webApi.rest.create(
    `${webApi.serverUrl}/_apis/hooks/subscriptions?api-version=7.2-preview.1`,
    {
      description: `PR Guardian webhook for ${eventType}`,
      publisherId: "tfs",
      eventType,
      resourceVersion: "1.0",
      consumerId: "webHooks",
      consumerActionId: "httpRequest",
      consumerInputs: { url },
      publisherInputs: {},
    },
  );
  return response.result;
}

export async function deleteSubscription(subscriptionId: string): Promise<void> {
  const webApi = this.adoWebApi as AdoWebApi;
  await webApi.rest.del(
    `${webApi.serverUrl}/_apis/hooks/subscriptions/${subscriptionId}?api-version=7.2-preview.1`,
  );
}
