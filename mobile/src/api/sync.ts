import type {
  SyncOperation,
  SyncRequest,
  SyncResponse,
} from "@skate-route-mapper/shared/mobileContracts";
import { mobileApiBaseUrl } from "./mobileAuth";

export async function postSyncOperations(params: {
  token: string;
  operations: SyncOperation[];
}) {
  const body: SyncRequest = {
    operations: params.operations,
  };

  const response = await fetch(`${mobileApiBaseUrl}/v1/mobile/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.json();

  if (!response.ok) {
    const message =
      typeof responseBody?.message === "string"
        ? responseBody.message
        : "Unable to sync changes.";

    throw new Error(message);
  }

  return responseBody as SyncResponse;
}
