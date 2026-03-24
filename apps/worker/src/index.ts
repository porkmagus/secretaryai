import "dotenv/config";
import { buildServer } from "./server.js";

async function main() {
  const { app, config, infrastructure, logger } = await buildServer();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: config.worker.port,
    });

    logger.info("worker.started", {
      port: config.worker.port,
      nodeEnv: config.nodeEnv,
    });
  } catch (error) {
    logger.error("worker.start_failed", {
      error,
    });

    await infrastructure.close();
    process.exit(1);
  }

  const shutdown = async () => {
    logger.info("worker.stopping");
    await Promise.allSettled([app.close(), infrastructure.close()]);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
