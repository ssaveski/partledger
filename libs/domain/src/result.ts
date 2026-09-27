/**
 * Expected failures are values, not exceptions (CLAUDE.md): services and handlers return a
 * `Result`, and a command whose handler returns a failure rolls back its transaction (KTD14).
 */
export interface Success<Value> {
  readonly ok: true;
  readonly value: Value;
}

export interface Failure<Error> {
  readonly ok: false;
  readonly error: Error;
}

export type Result<Value, Error> = Success<Value> | Failure<Error>;

export function success<Value>(value: Value): Success<Value> {
  return { ok: true, value };
}

export function failure<Error>(error: Error): Failure<Error> {
  return { ok: false, error };
}
