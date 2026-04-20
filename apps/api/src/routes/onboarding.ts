import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { MemberSchema, ChannelSchema } from "@ujima/shared";
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
      description: [
        "Bootstrap a new organization, owner account, and agent workspace.",
        "",
        "**Two modes:**",
        "- **Inline config** – provide a `team` object in the request body with `agents`, `roles`, `channels`, etc. No config file is needed on the server.",
        "- **File config** – omit `team` and the server will load `ujima.config.ts` from the workspace root (or the path specified by `configFilePath`).",
      ].join("\n"),
      tags: ["Onboarding"],
      body: OnboardingRequestSchema,
      response: {
        200: z.object({
          organization: z.object({
            id: z.string(),
            name: z.string(),
          }),
          members: z.array(MemberSchema),
          channels: z.array(ChannelSchema),
          team: z.object({
            name: z.string(),
            workspaceRoot: z.string(),
            roles: z.array(z.string()),
            agents: z.array(z.string()),
            channels: z.array(z.string()),
          }),
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

