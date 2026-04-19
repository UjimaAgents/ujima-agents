import type { FastifyInstance } from "fastify";
import { OnboardingRequestSchema } from "../schemas.ts";

export default async function onboardingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/bootstrap", async () => {
    return fastify.services.bootstrap.getBootstrap();
  });

  fastify.post("/api/onboarding", async (request, reply) => {
    const body = OnboardingRequestSchema.parse(request.body);
    try {
      return await fastify.services.onboarding.onboard(body);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
}
