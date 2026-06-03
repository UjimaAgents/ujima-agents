// Embedded Ed25519 public key (SPKI, base64). The matching private key
// lives only in the operator's password manager and on the minting host.
// Rotate by generating a fresh pair and shipping a new CLI version that
// embeds the new public key — old keys keep verifying until that release.
export const SIGNING_PUBLIC_KEY_SPKI_BASE64 =
  'MCowBQYDK2VwAyEAC8ms/ooO6PgE2G5Nf294cu4at+GhEXO/prSimpy/Gws=';
