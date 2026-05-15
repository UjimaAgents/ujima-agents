import { AuthSessionSchema, AuthUserSchema, IdSchema, MemberSchema } from '@ujima/shared';
import { z } from 'zod';

export const SessionAuthStateSchema = z.object({
  authenticated: z.boolean(),
  user: AuthUserSchema.nullable(),
  member: MemberSchema.nullable(),
  session: AuthSessionSchema.nullable(),
});
export type SessionAuthState = z.infer<typeof SessionAuthStateSchema>;

export const AuthLoginRequestSchema = z.object({
  organizationId: IdSchema.optional(),
  email: z.string().email(),
  password: z.string().min(8),
});
export type AuthLoginRequest = z.infer<typeof AuthLoginRequestSchema>;

export const AuthSessionResponseSchema = z.object({
  auth: SessionAuthStateSchema.extend({
    authenticated: z.literal(true),
    user: AuthUserSchema,
    member: MemberSchema,
    session: AuthSessionSchema,
  }),
  sessionToken: z.string().min(1),
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;

export const AuthLogoutResponseSchema = z.object({
  loggedOut: z.boolean(),
});
export type AuthLogoutResponse = z.infer<typeof AuthLogoutResponseSchema>;

export const AccessibleOrganizationsResponseSchema = z.object({
  organizations: z.array(z.object({
    id: IdSchema,
    name: z.string(),
  })),
});
export type AccessibleOrganizationsResponse = z.infer<typeof AccessibleOrganizationsResponseSchema>;
