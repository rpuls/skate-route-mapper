import type {
  CurrentMobileUser,
  MobileAuthResponse,
  MobileLoginPayload,
  MobileSignupPayload,
} from "@skate-route-mapper/shared/mobileContracts";
import { mobileApiBaseUrl } from "./config";

export class InvalidMobileSessionError extends Error {}

function getFriendlyAuthErrorMessage(message: string) {
  switch (message) {
    case "Invalid request body":
      return "Check your email and password, then try again.";
    case "Invalid user credentials":
      return "That email and password do not match.";
    case "A record with that unique value already exists":
      return "An account with that email already exists. Try signing in instead.";
    case "Internal server error":
      return "Something went wrong. Please try again.";
    default:
      return message || "Unable to sign in.";
  }
}

async function postMobileAuth<TPayload>(
  path: string,
  payload: TPayload
): Promise<MobileAuthResponse> {
  const response = await fetch(`${mobileApiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();

  if (!response.ok) {
    const message =
      typeof body?.message === "string" ? body.message : "Unable to sign in.";

    throw new Error(getFriendlyAuthErrorMessage(message));
  }

  return body as MobileAuthResponse;
}

export function signupMobileUser(payload: MobileSignupPayload) {
  return postMobileAuth("/v1/mobile/auth/signup", payload);
}

export function loginMobileUser(payload: MobileLoginPayload) {
  return postMobileAuth("/v1/mobile/auth/login", payload);
}

export async function getCurrentMobileUser(token: string) {
  const response = await fetch(`${mobileApiBaseUrl}/v1/mobile/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json();

  if (response.status === 401 || response.status === 404) {
    throw new InvalidMobileSessionError("Stored session is no longer valid");
  }

  if (!response.ok) {
    throw new Error("Stored session is no longer valid");
  }

  return body.user as CurrentMobileUser;
}
