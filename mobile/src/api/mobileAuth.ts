import type {
  MobileAuthResponse,
  MobileLoginPayload,
  MobileSignupPayload,
} from "@skate-route-mapper/shared/mobileContracts";

const configuredApiBaseUrl = (globalThis as {
  process?: {
    env?: Record<string, string | undefined>;
  };
}).process?.env?.EXPO_PUBLIC_API_BASE_URL;

export const mobileApiBaseUrl = configuredApiBaseUrl ?? "http://localhost:3001";

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
