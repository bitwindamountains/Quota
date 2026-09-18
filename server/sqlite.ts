import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync } from 'node:fs';

/** Small adapter over Node 24's bundled SQLite; no native addon/toolchain. */
export class SQLite {
  private connection: DatabaseSync;
  private transactionId = 0;
  constructor(path: string, options: { readonly?: boolean; fileMustExist?: boolean } = {}) {
    if (options.fileMustExist && !existsSync(path)) throw new Error('Database file does not exist.');
    this.connection = new DatabaseSync(path, {
      readOnly: options.readonly ?? false, enableForeignKeyConstraints: true
    });
  }
  exec(sql: string) { this.connection.exec(sql); }
  prepare(sql: string) { return this.connection.prepare(sql); }
  pragma(sql: string, options?: { simple?: boolean }) {
    const rows = this.connection.prepare('PRAGMA ' + sql).all();
    return options?.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }
  transaction<T>(fn: () => T): () => T {
    return () => {
      const savepoint = 'tx_' + ++this.transactionId;
      this.connection.exec('SAVEPOINT ' + savepoint);
      try {
        const result = fn();
        this.connection.exec('RELEASE SAVEPOINT ' + savepoint);
        return result;
      } catch (error) {
        this.connection.exec('ROLLBACK TO SAVEPOINT ' + savepoint);
        this.connection.exec('RELEASE SAVEPOINT ' + savepoint);
        throw error;
      }
    };
  }
  async backup(path: string) { await backup(this.connection, path); }
  close() { this.connection.close(); }
}
