// Headless unit test for RoomState. Run: node --experimental-strip-types
// src/state/room_state.test.ts  (zero GPU, pure logic — see runner below).
import { RoomState, type StateValue } from './room_state.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}
function throws(fn: () => void, msg: string) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, msg);
}

// A fake device that records every apply() so we can assert scene pushes.
function fakeDevice(id: string, value: StateValue, states?: readonly StateValue[]) {
  const applied: StateValue[] = [];
  return {
    def: { id, value, states, apply: (v: StateValue) => applied.push(v) },
    applied,
  };
}

// 1. register applies the initial value exactly once
{
  const s = new RoomState();
  const lamp = fakeDevice('lamp', false, [false, true]);
  s.register(lamp.def);
  ok(lamp.applied.length === 1 && lamp.applied[0] === false, 'register applies initial value once');
  ok(s.get('lamp') === false, 'get reflects initial');
}

// 2. duplicate id + invalid initial throw (dev-error guards)
{
  const s = new RoomState();
  s.register(fakeDevice('x', 1).def);
  throws(() => s.register(fakeDevice('x', 2).def), 'duplicate id throws');
  throws(() => s.register(fakeDevice('y', 'no', ['a', 'b']).def), 'initial not in states throws');
}

// 3. absolute set applies + updates get; echo-guard skips unchanged
{
  const s = new RoomState();
  const d = fakeDevice('mood', 'standard', ['standard', 'cinema', 'party']);
  s.register(d.def);
  s.set('mood', 'cinema');
  ok(s.get('mood') === 'cinema', 'set updates value');
  ok(d.applied.length === 2 && d.applied[1] === 'cinema', 'set pushes apply');
  s.set('mood', 'cinema'); // unchanged
  ok(d.applied.length === 2, 'echo-guard: unchanged set does NOT re-apply');
}

// 4. invalid + unknown sets are ignored safely
{
  const s = new RoomState();
  s.register(fakeDevice('mood', 'standard', ['standard', 'cinema']).def);
  ok(s.set('mood', 'bogus') === 'standard', 'invalid value rejected, returns current');
  ok(s.get('mood') === 'standard', 'invalid value did not mutate');
  ok(s.set('ghost', true) === undefined, 'unknown id returns undefined');
}

// 5. advance wraps; advance on non-enumerated throws
{
  const s = new RoomState();
  s.register(fakeDevice('mood', 'a', ['a', 'b', 'c']).def);
  ok(s.advance('mood') === 'b', 'advance a→b');
  ok(s.advance('mood') === 'c', 'advance b→c');
  ok(s.advance('mood') === 'a', 'advance c→a (wraps)');
  s.register(fakeDevice('dimmer', 0.5).def); // no states
  throws(() => s.advance('dimmer'), 'advance on non-enumerated throws');
}

// 6. snapshot / restore round-trip
{
  const s = new RoomState();
  s.register(fakeDevice('lamp', false, [false, true]).def);
  s.register(fakeDevice('mood', 'standard', ['standard', 'cinema']).def);
  s.set('lamp', true); s.set('mood', 'cinema');
  const snap = s.snapshot();

  const s2 = new RoomState();
  s2.register(fakeDevice('lamp', false, [false, true]).def);
  s2.register(fakeDevice('mood', 'standard', ['standard', 'cinema']).def);
  s2.restore(snap);
  ok(s2.get('lamp') === true && s2.get('mood') === 'cinema', 'restore reproduces snapshot');
}

// 7. restore tolerates unknown ids + invalid values (version skew / hostile input)
{
  const s = new RoomState();
  s.register(fakeDevice('lamp', false, [false, true]).def);
  s.restore({ lamp: true, removedDevice: 99, mood: 'cinema' } as never);
  ok(s.get('lamp') === true, 'restore applies known id');
  ok(!s.has('removedDevice'), 'restore ignores unknown id (no crash)');
}

// 8. URL encode/decode round-trip; garbage → null; loadToken
{
  const s = new RoomState();
  s.register(fakeDevice('lamp', false, [false, true]).def);
  s.register(fakeDevice('mood', 'standard', ['standard', 'cinema']).def);
  s.set('lamp', true); s.set('mood', 'cinema');
  const token = s.encode();
  ok(typeof token === 'string' && !/[+/=]/.test(token), 'encode is URL-safe base64url');

  const s2 = new RoomState();
  s2.register(fakeDevice('lamp', false, [false, true]).def);
  s2.register(fakeDevice('mood', 'standard', ['standard', 'cinema']).def);
  ok(s2.loadToken(token) === true, 'loadToken succeeds on valid token');
  ok(s2.get('lamp') === true && s2.get('mood') === 'cinema', 'token round-trips the room');
  ok(RoomState.decode('!!!not base64!!!') === null, 'decode garbage → null (no throw)');
  ok(s2.loadToken('@@@') === false, 'loadToken garbage → false');
}

// 9. subscribe sees origin; echo-guard suppresses no-op notifications; unsubscribe
{
  const s = new RoomState();
  s.register(fakeDevice('lamp', false, [false, true]).def);
  const events: string[] = [];
  const off = s.subscribe((e) => events.push(`${e.id}=${e.value}/${e.origin}`));
  s.set('lamp', true, 'local');
  s.set('lamp', true, 'local');          // echo-guard: no event
  s.set('lamp', false, 'remote');        // origin tag flows through
  ok(events.length === 2, 'subscribe fires only on real changes (echo-guard)');
  ok(events[0] === 'lamp=true/local' && events[1] === 'lamp=false/remote', 'origin propagates to listeners');
  off();
  s.set('lamp', true);
  ok(events.length === 2, 'unsubscribe stops delivery');
}

console.log(`\nRoomState test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
