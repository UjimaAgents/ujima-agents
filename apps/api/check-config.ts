import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';

const homeDir = process.env.UJIMA_HOME || join(homedir(), '.ujima');
const dbPath = join(homeDir, 'data', 'ujima.db');
console.log('DB path:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });
  // Check all workspace settings
  const rows = db.query('SELECT key, value FROM workspace_settings').all() as { key: string; value: string }[];
  for (const row of rows) {
    console.log(`\nSetting key: ${row.key}`);
    try {
      const parsed = JSON.parse(row.value);
      if (row.key === 'team.config' && parsed.roles) {
        for (const role of parsed.roles) {
          console.log(`  Role: "${role.name}", tools: [${(role.tools || []).join(', ')}]`);
        }
      } else if (row.key === 'dashboard.teamOverrides' && parsed.roles) {
        for (const role of parsed.roles) {
          console.log(`  Override Role: "${role.name}", tools: [${(role.tools || []).join(', ')}]`);
        }
      }
    } catch {
      console.log(`  (unparseable, length=${row.value.length})`);
    }
  }
  db.close();
} catch(e) {
  console.log('Could not read DB:', (e as Error).message);
}
