import { limitStringLength } from "@metriport/shared";
import { nanoid } from "nanoid";
import { maxWebhookStatusLength } from "../../domain/settings";
import { processAsyncError } from "../../errors";
import WebhookError from "../../errors/webhook";
import { Settings, WEBHOOK_STATUS_BAD_RESPONSE, WEBHOOK_STATUS_OK } from "../../models/settings";
import { capture } from "../../shared/notifications";
import { Util } from "../../shared/util";
import { errorToWhStatusDetails, sendTestPayload } from "../webhook/webhook";
import { getSettingsOrFail } from "./getSettings";

const log = Util.log(`updateSettings`);

export type UpdateSettingsCommand = {
  cxId: string;
  webhookUrl?: string;
};

export const updateSettings = async ({
  cxId,
  webhookUrl,
}: UpdateSettingsCommand): Promise<Settings> => {
  const originalSettings = await getSettingsOrFail({ id: cxId });
  const updateWebhook = getWebhookDataForUpdate(originalSettings, webhookUrl);
  await Settings.update(
    {
      ...updateWebhook,
    },
    { where: { id: cxId } }
  );

  // if there's a URL, fire a test towards it - intentionally asynchronous
  updateWebhook.webhookUrl &&
    testWebhook({ cxId, ...updateWebhook }).catch(processAsyncError(`testWebhook`));

  const updatedSettings = await getSettingsOrFail({ id: cxId });
  return updatedSettings;
};

export type UpdateWebhookStatusCommand = {
  cxId: string;
  webhookEnabled: boolean;
  webhookStatusDetail?: string;
};
export const updateWebhookStatus = async ({
  cxId,
  webhookEnabled,
  webhookStatusDetail,
}: UpdateWebhookStatusCommand): Promise<void> => {
  const statusDetail = limitStringLength(webhookStatusDetail, maxWebhookStatusLength);
  await Settings.update(
    {
      webhookEnabled,
      ...(statusDetail ? { webhookStatusDetail: statusDetail } : undefined),
    },
    { where: { id: cxId } }
  );
};

const getWebhookDataForUpdate = (
  settings: Settings,
  newUrl?: string
): Pick<Settings, "webhookUrl" | "webhookKey"> => {
  const webhookData = {
    ...(newUrl
      ? {
          webhookUrl: newUrl,
          webhookKey: settings.webhookKey ?? nanoid(),
        }
      : {
          webhookUrl: null,
          webhookKey: null,
        }),
    webhookStatus: null,
  };
  return webhookData;
};

type TestWebhookCommand = Pick<Settings, "webhookUrl" | "webhookKey"> & { cxId: string };

const testWebhook = async ({ cxId, webhookUrl, webhookKey }: TestWebhookCommand): Promise<void> => {
  if (!webhookUrl || !webhookKey) return;
  try {
    const testOK = await sendTestPayload(webhookUrl, webhookKey, cxId);
    await updateWebhookStatus({
      cxId,
      webhookEnabled: testOK,
      webhookStatusDetail: testOK ? WEBHOOK_STATUS_OK : WEBHOOK_STATUS_BAD_RESPONSE,
    });
  } catch (error) {
    if (error instanceof WebhookError) {
      const webhookStatusDetail = errorToWhStatusDetails(error);
      await updateWebhookStatus({
        cxId,
        webhookEnabled: false,
        webhookStatusDetail,
      });
    } else {
      log(`Unexpected error testing webhook: ${error}`);
      capture.error(error, {
        extra: {
          context: "testWebhook",
          cxId,
          webhookUrl,
          webhookKey,
          error,
        },
      });
    }
  }
};
