import cors from "@fastify/cors";
import fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { Server as SocketServer } from "socket.io";
import chalk from "chalk";
import { maybeLoadTeam, resolveDatabasePath, isAllowedLocalOrigin, logTeamSummary } from "./config.ts";
import { initDatabase } from "./db.ts";
import { Repository } from "./repositories.ts";
import { RealtimeService } from "./realtime.ts";
import onboardingRoutes from "./routes/onboarding.ts";
import settingsRoutes from "./routes/settings.ts";
import conversationRoutes from "./routes/conversations.ts";
import runRoutes from "./routes/runs.ts";
import { createApiServices, type ApiServices } from "./services/index.ts";

export async function createServer() {
  const team = await maybeLoadTeam();
  const dbPath = resolveDatabasePath();
  const db = initDatabase(dbPath);
  
  logTeamSummary(team);
  console.log(chalk.gray(`   Database:  ${chalk.white(dbPath)}\n`));

  const repo = new Repository(db);
  const server = fastify({
    logger: false,
    trustProxy: false,
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  await server.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Ujima API",
        description: "The core orchestration API for the Ujima Agent framework.",
        version: "1.0.0",
      },
      servers: [{ url: "http://localhost:3000" }],
    },
    transform: jsonSchemaTransform,
  });

  await server.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  await server.register(cors, {
    origin: (origin, callback) => {
      callback(null, isAllowedLocalOrigin(origin));
    },
    credentials: true,
  });

  const io = new SocketServer(server.server, {
    cors: {
      origin: (origin, callback) => {
        callback(null, isAllowedLocalOrigin(origin));
      },
      credentials: true,
    },
  });

  const realtime = new RealtimeService(io, repo);
  const services = createApiServices({
    team,
    repo,
    realtime,
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid request", issues: error.issues });
    }

    console.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  server.decorate("services", services);

  server.get("/health", async () => ({ status: "ok" }));

  await server.register(onboardingRoutes);
  await server.register(settingsRoutes);
  await server.register(conversationRoutes);
  await server.register(runRoutes);

  server.addHook("onClose", async () => {
    io.close();
  });

  return server;
}

declare module "fastify" {
  interface FastifyInstance {
    services: ApiServices;
  }
}
