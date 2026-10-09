import { Buffer } from 'node:buffer';
import process from 'node:process';
import { clearImmediate, setImmediate } from 'node:timers';
import { installPostgresNodeGlobals } from './node_compat_bootstrap.ts';
import type { PostgresNodeGlobals } from './node_compat_bootstrap.ts';

function assert(value: unknown): asserts value {
  if (!value) throw new Error('assertion failed');
}

Deno.test('missing dependency globals provide real Buffer and timer operations', async () => {
  const target: PostgresNodeGlobals = {};
  installPostgresNodeGlobals(target);
  assert(target.Buffer === Buffer && target.process === process);
  assert(target.setImmediate === setImmediate && target.clearImmediate === clearImmediate);
  const bytes = target.Buffer.from('정시', 'utf8');
  assert(bytes.toString('utf8') === '정시');
  assert(target.Buffer.byteLength('정시', 'utf8') === bytes.length);
  assert(target.Buffer.concat([bytes, bytes]).toString('utf8') === '정시정시');
  let cancelledRan = false;
  const cancelled = target.setImmediate(() => { cancelledRan = true; });
  target.clearImmediate(cancelled);
  await new Promise<void>((resolve) => target.setImmediate!(resolve));
  assert(cancelledRan === false);
});

Deno.test('existing runtime globals are preserved and installation is repeatable', () => {
  const existing = {
    Buffer: class RuntimeBuffer {} as unknown as typeof Buffer,
    process: {} as typeof process,
    setImmediate: (() => undefined) as unknown as typeof setImmediate,
    clearImmediate: (() => undefined) as typeof clearImmediate,
  };
  const target: PostgresNodeGlobals = { ...existing };
  installPostgresNodeGlobals(target);
  installPostgresNodeGlobals(target);
  assert(target.Buffer === existing.Buffer && target.process === existing.process);
  assert(target.setImmediate === existing.setImmediate && target.clearImmediate === existing.clearImmediate);
});

Deno.test('partially supplied globals preserve the runtime values', () => {
  const existingBuffer = class RuntimeBuffer {} as unknown as typeof Buffer;
  const existingClear = (() => undefined) as typeof clearImmediate;
  const target: PostgresNodeGlobals = { Buffer: existingBuffer, clearImmediate: existingClear };
  installPostgresNodeGlobals(target);
  assert(target.Buffer === existingBuffer && target.clearImmediate === existingClear);
  assert(target.process === process && target.setImmediate === setImmediate);
});
