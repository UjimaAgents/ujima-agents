import path from "node:path";
import { RoleScopesSchema } from "./schemas.js";
export function normalizeWorkspaceRoot(root, baseDirectory = process.cwd()) {
    return path.resolve(baseDirectory, root);
}
export function isPathInsideRoot(root, candidatePath) {
    const normalizedRoot = path.resolve(root);
    const normalizedCandidate = path.resolve(candidatePath);
    const relative = path.relative(normalizedRoot, normalizedCandidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function resolveWorkspacePath(root, relativePath = ".") {
    const normalizedRoot = path.resolve(root);
    const resolvedPath = path.resolve(normalizedRoot, relativePath);
    if (!isPathInsideRoot(normalizedRoot, resolvedPath)) {
        throw new Error(`Path "${relativePath}" escapes workspace root "${normalizedRoot}"`);
    }
    return resolvedPath;
}
export function normalizeRoleScopes(roleScopes = {}, root) {
    const normalizedRoot = path.resolve(root);
    const parsedRoleScopes = RoleScopesSchema.parse(roleScopes);
    return Object.fromEntries(Object.entries(parsedRoleScopes).map(([roleName, scopes]) => [
        roleName,
        scopes.map((scope) => resolveWorkspacePath(normalizedRoot, scope)),
    ]));
}
export function assertWorkspaceBoundary(root, candidatePath) {
    if (!isPathInsideRoot(root, candidatePath)) {
        throw new Error(`Path "${candidatePath}" escapes workspace root "${path.resolve(root)}"`);
    }
    return path.resolve(candidatePath);
}
