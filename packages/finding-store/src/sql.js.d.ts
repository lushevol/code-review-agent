declare module "sql.js" {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  interface Database {
    run(sql: string): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface BindParams {
    [key: string]: unknown;
  }

  interface Statement {
    bind(params?: BindParams | unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    reset(): void;
    free(): void;
  }

  export type { Database, SqlJsStatic, Statement, BindParams };

  export default function initSqlJs(): Promise<SqlJsStatic>;
}
