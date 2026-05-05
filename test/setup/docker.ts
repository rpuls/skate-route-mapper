import { spawn } from "node:child_process";

export const composeProjectName = process.env.E2E_COMPOSE_PROJECT_NAME ?? "skate-route-mapper-e2e";

const composeFiles = ["-f", "docker-compose.yml", "-f", "test/docker-compose.e2e.yml"];

export function dockerCompose(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "docker",
      ["compose", "-p", composeProjectName, ...composeFiles, ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`docker compose ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}
