import Fastify from "fastify";

import { checkHealth } from "../db";

const fastify = Fastify({
  logger: false,
});
const healthCheck = {
  status: "OK",
  dependencies: [
    {
      name: "db",
      status: "CONNECTING",
    },
    {
      name: "ws",
      status: "CONNECTING",
    },
  ],
};
export const setStatus = (name: string, status: string) => {
  healthCheck.dependencies[
    healthCheck.dependencies.findIndex((x) => x.name == name)
  ].status = status;
  if (status == "FAILED") {
    healthCheck.status = "FAILED";
  }
  if (
    healthCheck.dependencies.filter((x) => x.status == "FAILED").length == 0
  ) {
    healthCheck.status = "OK";
  }
};
fastify.get("/health", async (_request, reply) => {
  const code = healthCheck.status == "OK" ? 200 : 503;
  const db = await checkHealth();
  setStatus("db", db);
  reply.code(code).send(healthCheck);
});
export const health = () => {
  fastify.listen({ port: 80, host: "0.0.0.0" }, (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
};
