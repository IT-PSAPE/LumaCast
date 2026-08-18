import { createRequire } from 'node:module';
import type { DatabaseSync as NodeSqliteDatabaseSync, StatementSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

interface DatabaseOptions {
  readonly?: boolean;
}

interface PragmaOptions {
  simple?: boolean;
}

function normalizeRow<T>(row: T): T {
  if (!row || Array.isArray(row) || typeof row !== 'object') {
    return row;
  }

  return { ...(row as Record<string, unknown>) } as T;
}

function executeStatement<TResult>(method: (...parameters: never[]) => TResult, parameters: unknown[]): TResult {
  if (parameters.length === 1) {
    const [firstParameter] = parameters;

    if (Array.isArray(firstParameter)) {
      return method(...(firstParameter as never[]));
    }

    if (firstParameter != null && typeof firstParameter === 'object') {
      return method(firstParameter as never);
    }
  }

  return method(...(parameters as never[]));
}

export class SqliteStatement {
  constructor(private statement: StatementSync) {}

  run(...parameters: unknown[]): ReturnType<StatementSync['run']> {
    return executeStatement(this.statement.run.bind(this.statement) as (...parameters: never[]) => ReturnType<StatementSync['run']>, parameters);
  }

  get<T>(...parameters: unknown[]): T {
    return normalizeRow(
      executeStatement(this.statement.get.bind(this.statement) as (...parameters: never[]) => T, parameters)
    );
  }

  all<T>(...parameters: unknown[]): T[] {
    const rows = executeStatement(this.statement.all.bind(this.statement) as (...parameters: never[]) => T[], parameters);
    return rows.map((row) => normalizeRow(row));
  }
}

export class SqliteDatabase {
  private database: NodeSqliteDatabaseSync;

  constructor(filename: string, options: DatabaseOptions = {}) {
    this.database = new DatabaseSync(filename, { readOnly: options.readonly ?? false });
  }

  close(): void {
    this.database.close();
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.database.prepare(sql));
  }

  pragma(command: string, options: PragmaOptions = {}): unknown {
    const normalizedCommand = command.trim().replace(/;$/, '');

    if (normalizedCommand.includes('=')) {
      this.database.exec(`PRAGMA ${normalizedCommand}`);
      return undefined;
    }

    const row = normalizeRow<Record<string, unknown> | undefined>(
      this.database.prepare(`PRAGMA ${normalizedCommand}`).get() as Record<string, unknown> | undefined
    );

    if (!row) {
      return undefined;
    }

    if (options.simple) {
      return Object.values(row)[0];
    }

    return row;
  }

  transaction<TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult): (...args: TArgs) => TResult {
    return (...args: TArgs) => {
      this.database.exec('BEGIN IMMEDIATE');

      try {
        const result = callback(...args);
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    };
  }
}
