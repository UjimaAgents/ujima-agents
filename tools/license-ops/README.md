# ujima-license-ops

Cloudflare Worker that owns the license registry for `@ujima/agents`. The signing key never lives here — it stays on your machine and signs offline via `scripts/license/mint.ts`. The Worker only:

- Persists `{ licenseId → record }` in KV
- Serves the public revocation feed at `/revoked.json`
- Accepts authenticated `POST /licenses` (register) / `DELETE /licenses/:id` (revoke) / `GET /licenses` (list)

This directory is **excluded from the published `@ujima/agents` npm package** (it's not under `packages/distribution/` and isn't referenced in the package `files` field).

## One-time setup

```bash
cd tools/license-ops
bun install
bunx wrangler kv:namespace create LICENSES
bunx wrangler kv:namespace create LICENSES --preview
# Paste both ids into wrangler.toml [[kv_namespaces]].

# Pick a long random string and save it in 1Password.
bunx wrangler secret put ADMIN_TOKEN

bunx wrangler deploy
```

## Granting a license

The mint script signs offline using the private key at `~/.ujima/license-signing.key` and then registers the `licenseId` with the Worker so revocation can find it later.

```bash
bun scripts/license/mint.ts \
  --email alice@example.com \
  --tier beta \
  --notes "waitlist-2026-06" \
  --worker https://ujima-license-ops.<your-subdomain>.workers.dev
```

The script prints the signed token to stdout — email that to the user. They run `ujima init --license <token>` or set `UJIMA_LICENSE`.

## Revoking a license

```bash
curl -X DELETE \
  -H "Authorization: Bearer $UJIMA_ADMIN_TOKEN" \
  https://ujima-license-ops.<your-subdomain>.workers.dev/licenses/LIC-0042
```

CLIs pick up the new revocation list within 24h (the cache TTL). To force a faster propagation, the user can run `ujima license refresh`.

## Listing licenses

```bash
curl -H "Authorization: Bearer $UJIMA_ADMIN_TOKEN" \
  https://ujima-license-ops.<your-subdomain>.workers.dev/licenses
```

## Rotating the signing key

1. Generate a new keypair on your machine. Save the private key in 1Password and at `~/.ujima/license-signing.key`.
2. Update `packages/license/src/keypair.ts` with the new public key.
3. Cut a new CLI release. Old tokens stop verifying as soon as users update.
4. Re-mint and re-distribute keys to the active waitlist.

There's no built-in dual-key window — rotations are a hard cut. Plan accordingly.
