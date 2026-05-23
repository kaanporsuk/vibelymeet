import { captureMediaTelemetry } from "./media-telemetry.ts";

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
  await captureMediaTelemetry({
    event: "media_upload_receipt_transition",
    distinct_id: params.ownerUserId,
    properties: {
      source: params.source,
      media_family: params.mediaFamily,
      client_request_id: params.clientRequestId,
      receipt_present: Boolean(params.receiptId),
      asset_present: Boolean(params.assetId),
      provider: params.provider ?? null,
      provider_path_present: Boolean(params.providerPath),
      status_from: params.statusFrom ?? null,
      status_to: params.statusTo,
      content_sha256_present: Boolean(params.contentSha256),
    },
  });
}
