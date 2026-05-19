const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

type UploadEventCoverResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  path?: string;
  url?: string;
  assetId?: string | null;
  referenceId?: string | null;
  receiptId?: string | null;
};

type UploadEventCoverOptions = {
  clientRequestId?: string | null;
  expectedCurrentCoverAssetId?: string | null;
};

export async function uploadEventCoverToBunny(
  file: File,
  accessToken: string,
  eventId?: string,
  options: UploadEventCoverOptions = {},
): Promise<{ url: string; path: string | null; assetId: string | null }> {
  const formData = new FormData();
  formData.append("file", file);
  if (eventId) {
    formData.append("event_id", eventId);
    if (options.expectedCurrentCoverAssetId !== undefined) {
      formData.append("expected_current_cover_asset_id", options.expectedCurrentCoverAssetId?.trim() || "__none__");
    }
  }
  const stableClientRequestId = options.clientRequestId?.trim();
  if (stableClientRequestId) {
    formData.append("client_request_id", stableClientRequestId);
  }

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/upload-event-cover`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(stableClientRequestId ? { "x-client-request-id": stableClientRequestId } : {}),
      },
      body: formData,
    }
  );

  let data: UploadEventCoverResponse;
  try {
    data = await res.json() as UploadEventCoverResponse;
  } catch {
    throw new Error("Upload service unavailable. Please try again.");
  }

  if (!data.success) {
    throw new Error(data.error || "Event cover upload failed");
  }
  if (!data.url) {
    throw new Error("Event cover upload failed");
  }

  return {
    url: data.url,
    path: data.path ?? null,
    assetId: data.assetId ?? null,
  };
}
