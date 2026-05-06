import { request } from "@playwright/test";
import { dockerCompose } from "./docker";

async function waitForHealth(apiBaseUrl: string) {
  const context = await request.newContext();
  const deadline = Date.now() + 60_000;

  try {
    while (Date.now() < deadline) {
      try {
        const response = await context.get(`${apiBaseUrl}/health`);

        if (response.ok()) {
          return;
        }
      } catch {
        // Keep polling while Docker finishes exposing the service.
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } finally {
    await context.dispose();
  }

  throw new Error(`API health check did not pass at ${apiBaseUrl}/health`);
}

export default async function globalSetup() {
  await dockerCompose(["down", "--volumes", "--remove-orphans"]);
  await dockerCompose(["up", "--build", "--detach", "--wait"]);
  await waitForHealth(process.env.E2E_API_BASE_URL ?? "http://localhost:3101");
}
