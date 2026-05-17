import type {
  ExperimentalCapturePayload,
  ExperimentalCaptureResponse,
} from "@skate-route-mapper/shared/mobileContracts";
import { mobileApiBaseUrl } from "./mobileAuth";

export async function uploadExperimentalCapture(params: {
  token: string;
  capture: ExperimentalCapturePayload;
}) {
  const response = await fetch(`${mobileApiBaseUrl}/v1/mobile/experimental-captures`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params.capture),
  });

  const body = await response.json();

  if (!response.ok) {
    const message =
      typeof body?.message === "string"
        ? body.message
        : "Unable to upload calibration capture.";

    throw new Error(message);
  }

  return body as ExperimentalCaptureResponse;
}
