import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./db/prisma.js";
import * as AdminUsers from "./features/adminUsers/index.js";

const app = await buildApp();

async function start() {
  try {
    await connectDatabase();
    const seededAdmin = await AdminUsers.seedInitialAdminUser();

    if (seededAdmin) {
      app.log.info({ adminUserId: seededAdmin.id, email: seededAdmin.email }, "Seeded initial admin user");
    }

    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

const shutdown = async () => {
  await app.close();
  await disconnectDatabase();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await start();
