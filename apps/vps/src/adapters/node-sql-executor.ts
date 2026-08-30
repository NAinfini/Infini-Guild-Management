import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import {
  assertSqlBatch,
  assertSqlStatement,
  decodeSqlRow,
  firstSqlToken,
  normalizeSqlParams,
  type SqlBatchStatement,
  type SqlExecutor,
  type SqlMethod,
  type SqlResult,
  type SqlStatement,
  type SqlValue,
} from "@guild/kernel";
import { preparePrivateSqliteDatabase } from "./private-filesystem.js";

/*
 * node:sqlite 是同步 API：在主线程上执行会把整个事件循环卡住，HTTP、WebSocket
 * 和定时任务全部陪跑。这里把 SQLite 全部移出主线程：一条写通道（worker 内天然
 * 串行，BEGIN IMMEDIATE 批次不可能交错）加 N 条只读通道（WAL 允许读写并行，
 * readOnly 打开保证词法路由判错也写不进去）。主线程只做校验、路由、解码——
 * 全部走 kernel 的单一实现。
 *
 * worker 源码是一段自包含 CJS 字符串（eval worker）：tsx 开发态和 esbuild
 * 单文件产物都不存在可引用的独立 worker 文件，字符串是唯一在两种形态下行为
 * 一致的载体。字符串里只允许 node 内置模块；列名断言必须发生在执行之前
 * （否则带 RETURNING 的独立变更语句会先落库再报错），因此那三条错误消息在
 * worker 里镜像 kernel 的 assertSqlResultColumns，由 conformance 套件钉住。
 *
 * worker 意外退出视为致命：拒绝该通道所有在途与后续请求，不自动重启——
 * 健康检查会暴露数据库故障，由运维重启进程。
 */
const SQL_WORKER_SOURCE = `
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');

function serializeError(error) {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error), props: {} };
  }
  const props = {};
  for (const key of Object.keys(error)) {
    const value = error[key];
    const type = typeof value;
    if (value === null || type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
      props[key] = value;
    }
  }
  const serialized = { name: error.name, message: error.message, stack: error.stack, props };
  if (Array.isArray(error.errors)) serialized.errors = error.errors.map(serializeError);
  return serialized;
}

let database;
try {
  database = new DatabaseSync(workerData.databasePath, { readOnly: workerData.readOnly });
  database.exec(workerData.pragmas);
  parentPort.postMessage({ kind: 'ready' });
} catch (error) {
  parentPort.postMessage({ kind: 'fatal', error: serializeError(error) });
  parentPort.close();
}

function assertDeclaredColumns(prepared, declared) {
  if (declared === undefined) return;
  const actual = prepared.columns().map(function (column) { return column.name; });
  if (actual.length === 0 || actual.some(function (name) { return !name; })) {
    throw new TypeError('SQL result columns must be non-empty names');
  }
  if (new Set(actual).size !== actual.length) {
    throw new TypeError('SQL result columns must be unique');
  }
  const mismatch = actual.length !== declared.length
    || actual.some(function (name, index) { return name !== declared[index]; });
  if (mismatch) {
    throw new TypeError('SQLite result columns do not match the declared column order');
  }
}

function runStatement(statement) {
  const prepared = database.prepare(statement.sql);
  prepared.setReturnArrays(true);
  if (statement.method === 'run') {
    return { lastInsertRowid: prepared.run(...statement.params).lastInsertRowid };
  }
  assertDeclaredColumns(prepared, statement.columns);
  if (statement.method === 'get') {
    return { row: prepared.get(...statement.params) };
  }
  return { rows: prepared.all(...statement.params) };
}

function runBatch(statements) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const outcomes = statements.map(runStatement);
    database.exec('COMMIT');
    return outcomes;
  } catch (error) {
    try {
      if (database.isTransaction) database.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'SQLite batch and rollback both failed');
    }
    throw error;
  }
}

parentPort.on('message', function (message) {
  if (message.kind === 'close') {
    try {
      database.close();
    } catch (error) {
      parentPort.postMessage({ kind: 'fatal', error: serializeError(error) });
    }
    parentPort.close();
    return;
  }
  try {
    const outcome = message.kind === 'batch'
      ? runBatch(message.statements)
      : runStatement(message.statement);
    parentPort.postMessage({ kind: 'result', id: message.id, outcome });
  } catch (error) {
    parentPort.postMessage({ kind: 'error', id: message.id, error: serializeError(error) });
  }
});
`;

/*
 * WAL 与读池是一体的架构决定：没有 WAL，只读通道会持续吃 SQLITE_BUSY，
 * 所以日志模式归执行器所有，不归运行时配置。连接级 PRAGMA 必须每条连接
 * 各设一次，这正是它们只能住在 worker 启动路径里的原因。
 */
const WRITER_PRAGMAS = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA busy_timeout = 5000",
  "PRAGMA wal_autocheckpoint = 1000",
].join("; ");

const READER_PRAGMAS = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA busy_timeout = 5000",
].join("; ");

const CLOSED_MESSAGE = "SQLite executor is closed";

type WireSqlStatement = Readonly<{
  sql: string;
  params: readonly SqlValue[];
  method: SqlMethod;
  columns?: readonly string[];
}>;

type SqlWorkerJob =
  | Readonly<{ kind: "execute"; statement: WireSqlStatement }>
  | Readonly<{ kind: "batch"; statements: readonly WireSqlStatement[] }>;

type SerializedWorkerError = Readonly<{
  name: string;
  message: string;
  stack?: string;
  props: Readonly<Record<string, null | string | number | boolean | bigint>>;
  errors?: readonly SerializedWorkerError[];
}>;

type SqlWorkerMessage =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "fatal"; error: SerializedWorkerError }>
  | Readonly<{ kind: "result"; id: number; outcome: unknown }>
  | Readonly<{ kind: "error"; id: number; error: SerializedWorkerError }>;

function reviveWorkerError(serialized: SerializedWorkerError): Error {
  const revived = serialized.errors !== undefined
    ? new AggregateError(serialized.errors.map(reviveWorkerError), serialized.message)
    : serialized.name === "TypeError"
      ? new TypeError(serialized.message)
      : serialized.name === "RangeError"
        ? new RangeError(serialized.message)
        : new Error(serialized.message);
  revived.name = serialized.name;
  if (serialized.stack !== undefined) revived.stack = serialized.stack;
  return Object.assign(revived, serialized.props);
}

type PendingJob = Readonly<{
  resolve(outcome: unknown): void;
  reject(error: Error): void;
}>;

class SqlWorkerLane {
  readonly ready: Promise<void>;
  inFlight = 0;

  private worker: Worker | null = null;
  private readonly jobs = new Map<number, PendingJob>();
  private nextJobId = 0;
  private failure: Error | null = null;
  private closing = false;
  private exited: Promise<void> = Promise.resolve();

  /* gate: 只读连接必须等写连接建好文件并落定 WAL 之后再打开，否则首次启动
     会对不存在的文件做只读 open 直接失败。 */
  constructor(
    databasePath: string,
    readOnly: boolean,
    pragmas: string,
    gate: Promise<void>,
  ) {
    this.ready = gate.then(() => this.spawn(databasePath, readOnly, pragmas));
    this.ready.catch(() => undefined);
  }

  private spawn(databasePath: string, readOnly: boolean, pragmas: string): Promise<void> {
    if (this.closing) throw new Error(CLOSED_MESSAGE);
    const worker = new Worker(SQL_WORKER_SOURCE, {
      eval: true,
      /* 空 execArgv：worker 只跑内置模块，不继承 tsx/vitest 注入的加载器。 */
      execArgv: [],
      workerData: { databasePath, readOnly, pragmas },
    });
    this.worker = worker;
    this.exited = new Promise((resolve) => {
      worker.once("exit", (code) => {
        this.fail(this.closing
          ? new Error(CLOSED_MESSAGE)
          : new Error(`SQLite worker exited unexpectedly (code ${code})`));
        resolve();
      });
    });
    return new Promise((resolve, reject) => {
      worker.on("message", (message: SqlWorkerMessage) => {
        if (message.kind === "ready") {
          resolve();
          return;
        }
        if (message.kind === "fatal") {
          const revived = reviveWorkerError(message.error);
          this.fail(revived);
          reject(revived);
          return;
        }
        const job = this.jobs.get(message.id);
        if (!job) return;
        this.jobs.delete(message.id);
        if (message.kind === "result") job.resolve(message.outcome);
        else job.reject(reviveWorkerError(message.error));
      });
      worker.on("error", (error) => {
        const normalizedError = error instanceof Error
          ? error
          : new Error("SQLite worker failed", { cause: error });
        this.fail(normalizedError);
        reject(normalizedError);
      });
      worker.on("messageerror", (error) => {
        this.fail(error);
        reject(error);
      });
    });
  }

  private fail(error: Error): void {
    if (this.failure === null) this.failure = error;
    for (const job of this.jobs.values()) job.reject(this.failure);
    this.jobs.clear();
  }

  async run(payload: SqlWorkerJob): Promise<unknown> {
    await this.ready;
    if (this.closing) throw new Error(CLOSED_MESSAGE);
    if (this.failure) throw this.failure;
    const worker = this.worker;
    if (!worker) throw new Error(CLOSED_MESSAGE);
    this.inFlight += 1;
    try {
      return await new Promise((resolve, reject) => {
        const id = this.nextJobId;
        this.nextJobId += 1;
        this.jobs.set(id, { resolve, reject });
        worker.postMessage({ ...payload, id });
      });
    } finally {
      this.inFlight -= 1;
    }
  }

  /* close 消息排在所有已入队任务之后，worker 先跑完在途任务再关库退出，
     天然完成排空；卡死场景由调用方限时后改走 terminate()。 */
  async close(): Promise<void> {
    const firstClose = !this.closing;
    this.closing = true;
    try {
      await this.ready;
    } catch {
      await this.exited;
      return;
    }
    if (firstClose && this.failure === null) {
      try {
        this.worker?.postMessage({ kind: "close" });
      } catch {
        await this.exited;
        return;
      }
    }
    await this.exited;
  }

  async terminate(): Promise<void> {
    this.closing = true;
    const worker = this.worker;
    if (!worker) return;
    await worker.terminate();
    await this.exited;
  }
}

export type NodeSqlExecutorOptions = Readonly<{
  maxPending?: number;
  readers?: number;
  /* 校验类工具用：所有连接只读打开、不动日志模式，绝不向被检查的库写入。 */
  readOnly?: boolean;
}>;

function defaultReaderCount(): number {
  return Math.max(1, Math.min(4, availableParallelism() - 1));
}

export class NodeSqlExecutor implements SqlExecutor {
  private readonly writer: SqlWorkerLane;
  private readonly readers: readonly SqlWorkerLane[];
  private readonly maxPending: number;
  private pending = 0;
  private closePromise: Promise<void> | null = null;

  constructor(databasePath: string, options: NodeSqlExecutorOptions = {}) {
    const maxPending = options.maxPending ?? 1_024;
    if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
      throw new TypeError("maxPending must be a positive safe integer");
    }
    const readerCount = options.readers ?? defaultReaderCount();
    if (!Number.isSafeInteger(readerCount) || readerCount < 0) {
      throw new TypeError("readers must be a non-negative safe integer");
    }
    this.maxPending = maxPending;
    const readOnly = options.readOnly === true;
    const securedDatabasePath = readOnly ? databasePath : preparePrivateSqliteDatabase(databasePath);
    this.writer = new SqlWorkerLane(
      securedDatabasePath,
      readOnly,
      readOnly ? READER_PRAGMAS : WRITER_PRAGMAS,
      Promise.resolve(),
    );
    this.readers = Array.from(
      { length: readerCount },
      () => new SqlWorkerLane(securedDatabasePath, true, READER_PRAGMAS, this.writer.ready),
    );
  }

  async execute(statement: SqlStatement): Promise<SqlResult> {
    assertSqlStatement(statement);
    const lane = firstSqlToken(statement.sql) === "SELECT" ? this.leastBusyReader() : this.writer;
    const outcome = await this.dispatch(lane, { kind: "execute", statement: wireStatement(statement) });
    return decodeOutcome(statement.method, outcome);
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    assertSqlBatch(statements);
    if (statements.length === 0) return [];
    const outcomes = await this.dispatch(this.writer, {
      kind: "batch",
      statements: statements.map(wireStatement),
    }) as readonly unknown[];
    return outcomes.map((outcome, index) => decodeOutcome(statements[index]!.method, outcome));
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  async terminate(): Promise<void> {
    this.closePromise ??= Promise.resolve();
    await Promise.all([this.writer, ...this.readers].map((lane) => lane.terminate()));
  }

  private async closeOnce(): Promise<void> {
    const settlements = await Promise.allSettled(
      [this.writer, ...this.readers].map((lane) => lane.close()),
    );
    const failures = settlements
      .filter((settlement): settlement is PromiseRejectedResult => settlement.status === "rejected")
      .map((settlement) => settlement.reason instanceof Error
        ? settlement.reason
        : new Error(String(settlement.reason)));
    if (failures.length > 0) {
      throw new AggregateError(failures, "SQLite worker shutdown failed");
    }
  }

  private leastBusyReader(): SqlWorkerLane {
    let candidate: SqlWorkerLane | undefined;
    for (const reader of this.readers) {
      if (candidate === undefined || reader.inFlight < candidate.inFlight) candidate = reader;
    }
    return candidate ?? this.writer;
  }

  private async dispatch(lane: SqlWorkerLane, payload: SqlWorkerJob): Promise<unknown> {
    if (this.closePromise !== null) throw new Error(CLOSED_MESSAGE);
    if (this.pending >= this.maxPending) throw new Error("SQLite operation queue is full");
    this.pending += 1;
    try {
      return await lane.run(payload);
    } finally {
      this.pending -= 1;
    }
  }
}

function wireStatement(statement: SqlStatement): WireSqlStatement {
  return {
    sql: statement.sql,
    params: normalizeSqlParams(statement.params),
    method: statement.method,
    ...(statement.columns === undefined ? {} : { columns: statement.columns }),
  };
}

function decodeOutcome(method: SqlMethod, outcome: unknown): SqlResult {
  if (method === "run") {
    const { lastInsertRowid } = outcome as Readonly<{ lastInsertRowid: number | bigint }>;
    return {
      rows: [],
      ...(lastInsertRowid === 0 ? {} : { lastInsertRowId: lastInsertRowid }),
    };
  }
  if (method === "get") {
    const { row } = outcome as Readonly<{ row?: readonly unknown[] }>;
    return { rows: row === undefined ? undefined : decodeSqlRow(row) };
  }
  const { rows } = outcome as Readonly<{ rows: readonly (readonly unknown[])[] }>;
  return { rows: rows.map(decodeSqlRow) };
}
