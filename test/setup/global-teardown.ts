import { dockerCompose } from "./docker";

export default async function globalTeardown() {
  await dockerCompose(["down", "--volumes", "--remove-orphans"]);
}
