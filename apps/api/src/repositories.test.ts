import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { OrganizationSchema } from "@ujima/shared";
import { initDatabase } from "./db.ts";
import { Repository } from "./repositories.ts";

test("provider credentials stay scoped to their organization", () => {
  const dbPath = `/tmp/ujima-api-${randomUUID()}.db`;
  const repo = new Repository(initDatabase(dbPath));

  const firstOrganization = OrganizationSchema.parse({
    id: randomUUID(),
    name: "First Org",
    workspace: {
      root: "/tmp/first-org",
      roleScopes: {},
    },
  });

  const secondOrganization = OrganizationSchema.parse({
    id: randomUUID(),
    name: "Second Org",
    workspace: {
      root: "/tmp/second-org",
      roleScopes: {},
    },
  });

  repo.saveOrganization(firstOrganization);
  repo.saveProviderCredential(firstOrganization.id, "openai", "sk-first");
  repo.saveOrganization(secondOrganization);

  expect(repo.getProviderCredential(firstOrganization.id, "openai")).toBe("sk-first");
  expect(repo.getProviderCredential(secondOrganization.id, "openai")).toBeNull();
  expect(repo.getOrganization(secondOrganization.id)?.id).toBe(secondOrganization.id);
});
