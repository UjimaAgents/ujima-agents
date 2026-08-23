export { connectMCP, isConnectionClosedError } from './connection';
export type {
  MCPConnection,
  ConnectOptions,
  ToolInfo,
  ToolCallResult,
  ToolCallContext,
} from './connection';

export { createMCPPool } from './pool';
export type { MCPPool, PoolGetOptions } from './pool';

export { buildTransport } from './transport';

export {
  connectMCPWithCacheRecovery,
  looksLikeNpmCacheCorruption,
} from './cache-recovery';
export type { CacheRecovery, ConnectResult } from './cache-recovery';

export { parseMCPConfigJSON, parseMCPConfigObject } from './parse-config';
export type { ParseConfigResult } from './parse-config';

export {
  CURATED_REGISTRY,
  listRegistry,
  findRegistryEntry,
  searchRegistry,
  instantiateFromRegistry,
} from './registry';
export type { RegistryEntry, InstantiateOptions } from './registry';

export {
  applyPreset,
  buildPermissionPreset,
  describePreset,
  isDestructive,
} from './permission-presets';
export type { PermissionPreset, PresetOptions } from './permission-presets';

export {
  buildAuthorizationUrl,
  createPkcePair,
  discoverAuthorizationServer,
  exchangeAuthorizationCode,
  fetchAuthorizationServerMetadata,
  isTokenExpired,
  OAuthFlowError,
  refreshAccessToken,
  registerDynamicClient,
  runConnectorOAuthFlow,
  startLoopbackCallback,
} from './oauth';
export type {
  AuthorizationServerMetadata,
  ConnectorOAuthResult,
  LoopbackCallback,
  OAuthTokenSet,
  PkcePair,
  RegisteredClient,
} from './oauth';
