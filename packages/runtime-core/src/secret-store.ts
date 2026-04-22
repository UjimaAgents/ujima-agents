import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export interface SecretStore {
  write(value: string): string;
  read(keyRef: string): string | null;
  delete(keyRef: string): void;
}

export interface FileSecretStoreOptions {
  homeDir: string;
  subDir?: string;
}

const SECRET_FILE_MODE = 0o600;
const SECRET_DIR_MODE = 0o700;
const WORLD_READABLE_MASK = 0o077;

export function createFileSecretStore(opts: FileSecretStoreOptions): SecretStore {
  const dir = resolve(opts.homeDir, opts.subDir ?? 'secrets');
  mkdirSync(dir, { recursive: true, mode: SECRET_DIR_MODE });

  try {
    const dirStats = statSync(dir);
    if ((dirStats.mode & WORLD_READABLE_MASK) !== 0) {
      throw new Error(
        `secret store: directory "${dir}" is world- or group-readable. Refusing to operate. ` +
          `Run: chmod 700 "${dir}"`,
      );
    }
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }

  function resolveKeyRef(keyRef: string): string {
    // keyRef is opaque; treat as filename only. Reject path separators to stop
    // caller from escaping the secrets dir.
    if (keyRef.includes('/') || keyRef.includes('\\') || keyRef.includes('..')) {
      throw new Error(`secret store: invalid keyRef "${keyRef}"`);
    }
    return join(dir, keyRef);
  }

  return {
    write(value: string): string {
      const keyRef = randomUUID();
      const filePath = resolveKeyRef(keyRef);
      writeFileSync(filePath, value, { encoding: 'utf8', mode: SECRET_FILE_MODE });
      // writeFileSync honors mode only on file creation; chmod is a belt-and-braces
      // fixup in case umask interferes.
      chmodSync(filePath, SECRET_FILE_MODE);
      return keyRef;
    },
    read(keyRef: string): string | null {
      const filePath = resolveKeyRef(keyRef);
      if (!existsSync(filePath)) return null;
      const stats = statSync(filePath);
      if ((stats.mode & WORLD_READABLE_MASK) !== 0) {
        throw new Error(
          `secret store: file "${filePath}" is world- or group-readable. Refusing to read. ` +
            `Run: chmod 600 "${filePath}"`,
        );
      }
      return readFileSync(filePath, 'utf8');
    },
    delete(keyRef: string): void {
      const filePath = resolveKeyRef(keyRef);
      if (existsSync(filePath)) unlinkSync(filePath);
    },
  };
}

export function createInMemorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    write(value) {
      const keyRef = randomUUID();
      map.set(keyRef, value);
      return keyRef;
    },
    read(keyRef) {
      return map.get(keyRef) ?? null;
    },
    delete(keyRef) {
      map.delete(keyRef);
    },
  };
}
