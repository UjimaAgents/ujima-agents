import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { OnboardingRequestSchema, BootstrapResponseSchema } from "../schemas.ts";
import { z } from "zod";

export default async function onboardingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/api/bootstrap", {
    schema: {
      summary: "Get startup state",
      description: "Returns the current onboarding status, organization details, and available model providers.",
      tags: ["Onboarding"],
      response: {
        200: BootstrapResponseSchema,
      },
    },
  }, async () => {
    return fastify.services.bootstrap.getBootstrap();
  });

  app.post("/api/onboarding", {
    schema: {
      summary: "Initialize organization",
      description: "Creates a new organization, owner, and sets up the initial workspace configuration.",
      tags: ["Onboarding"],
      body: OnboardingRequestSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          organizationId: z.string(),
        }),
        400: z.object({
          error: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    try {
      return fastify.services.onboarding.onboard(request.body);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
}
