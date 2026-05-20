import { capture } from "./posthog.ts";

type ReceiptTransitionParams = {
  ownerUserId: string;
  mediaFamily: string;
  clientRequestId: string;
  receiptId?: string | null;
  assetId?: string | null;
  provider?: string | null;
  providerPath?: string | null;
  statusFrom?: string | null;
  statusTo: string;
  contentSha256?: string | null;
  source: string;
};

export async function captureReceiptTransition(params: ReceiptTransitionParams): Promise<void> {
  await capture({
    event: "media_upload_receipt_transition",
    distinct_id: params.ownerUserId,
    properties: {
      feature: "media-sdk",
      source: params.source,
      media_family: params.mediaFamily,
      client_request_id: params.clientRequestId,
      receipt_id: params.receiptId ?? null,
      asset_id: params.assetId ?? null,
      provider: params.provider ?? null,
      provider_path: params.providerPath ?? null,
      status_from: params.statusFrom ?? null,
      status_to: params.statusTo,
      content_sha256: params.contentSha256 ?? null,
    },
  });
}
