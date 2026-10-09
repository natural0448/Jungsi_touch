/** Node globals used by the fixed Postgres dependency after flat bundling. */
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { clearImmediate, setImmediate } from 'node:timers';

export interface PostgresNodeGlobals {
  Buffer?: typeof Buffer;
  process?: typeof process;
  setImmediate?: typeof setImmediate;
  clearImmediate?: typeof clearImmediate;
}

/** Preserve globals supplied by the runtime; install only missing compatibility. */
export function installPostgresNodeGlobals(target: PostgresNodeGlobals = globalThis as PostgresNodeGlobals): void {
  if (target.Buffer === undefined) target.Buffer = Buffer;
  if (target.process === undefined) target.process = process;
  if (target.setImmediate === undefined) target.setImmediate = setImmediate;
  if (target.clearImmediate === undefined) target.clearImmediate = clearImmediate;
}

// This side-effect module must be evaluated before the static postgres import.
installPostgresNodeGlobals();
