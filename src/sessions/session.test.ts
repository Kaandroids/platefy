import { Storage } from 'expo-sqlite/kv-store';

import { act, renderHook } from '@/test/render';
import { testExercise, testWorkout } from '@/workouts/test-data';

import {
  addSet,
  changeRest,
  clockSeconds,
  endSession,
  isLeftOpen,
  lastActivity,
  MAX_SETS,
  MAX_WORKOUT_MS,
  resetSessionStore,
  sessionTotals,
  setValues,
  startClock,
  startSession,
  stopClock,
  toggleDone,
  toLog,
  type Session,
  updateSession,
  useActiveSession,
} from './session';

// The test environment has no native crypto; each workout still gets an id of its own.
jest.mock('expo-crypto', () => {
  let count = 0;
  return {
    randomUUID: () => `00000000-0000-4000-8000-${String((count += 1)).padStart(12, '0')}`,
  };
});
jest.mock('expo-sqlite/kv-store', () => {
  const items = new Map<string, string>();
  return {
    Storage: {
      items,
      getItemSync: jest.fn((key: string) => items.get(key) ?? null),
      setItemSync: jest.fn((key: string, value: string) => {
        items.set(key, value);
      }),
      removeItemSync: jest.fn((key: string) => items.delete(key)),
    },
  };
});

const NOW = 1_800_000_000_000;

const PUSH = testWorkout(7, {
  type: 'push',
  exercises: [
    testExercise('bench', { sets: 2, restSeconds: 90 }),
    testExercise('plank', { sets: 1, target: { seconds: 45, meters: null }, restSeconds: 0 }),
    testExercise('rowing', { sets: 1, target: { seconds: null, meters: 2000 }, restSeconds: 0 }),
  ],
});

const start = (last = {}) => startSession('user-a', PUSH, last, {}, NOW);

beforeEach(() => {
  (Storage as unknown as { items: Map<string, string> }).items.clear();
  resetSessionStore();
});

describe('startSession', () => {
  it('starts the workout, filled in from last time', () => {
    const session = start({
      bench: [{ weightKg: 80, reps: 8, seconds: null, meters: null }],
    });
    expect(session.exercises.map((exercise) => exercise.exerciseId)).toEqual([
      'bench',
      'plank',
      'rowing',
    ]);
    // A second set without one last time repeats the last set.
    expect(session.exercises[0]?.sets).toEqual([
      { weightKg: 80, reps: 8, seconds: null, meters: null, done: false },
      { weightKg: 80, reps: 8, seconds: null, meters: null, done: false },
    ]);
  });

  it('fills in the target without a last time', () => {
    const session = start();
    expect(session.exercises[0]?.sets[0]).toMatchObject({ weightKg: null, reps: 12 });
    // The time is left to the clock, so that a target is not taken for one already done.
    expect(session.exercises[1]?.sets[0]).toMatchObject({ seconds: null, meters: null });
    expect(session.exercises[2]?.sets[0]).toMatchObject({ seconds: null, meters: 2000 });
  });

  it('keeps the session on the device for the user who started it', async () => {
    start();
    resetSessionStore();
    const { result } = await renderHook(() => useActiveSession('user-a'));
    expect(result.current?.workoutId).toBe(7);
    const other = await renderHook(() => useActiveSession('user-b'));
    expect(other.result.current).toBeNull();
    await act(() => endSession());
    expect(result.current).toBeNull();
  });
});

describe('logging sets', () => {
  it('marks a set done and starts the rest', () => {
    const session = toggleDone(start(), 0, 0, NOW);
    expect(session.exercises[0]?.sets[0]?.done).toBe(true);
    expect(session.rest).toEqual({ endsAt: NOW + 90_000, seconds: 90 });
    expect(toggleDone(session, 0, 0, NOW).exercises[0]?.sets[0]?.done).toBe(false);
  });

  it('ends the running rest when a set is ticked, starting its own if its exercise has one', () => {
    const benched = toggleDone(start(), 0, 0, NOW);
    // The plank has no rest, so the bench press's ends with nothing after it.
    expect(toggleDone(benched, 1, 0, NOW + 60_000).rest).toBeNull();
    expect(toggleDone(benched, 0, 1, NOW + 60_000).rest).toEqual({
      endsAt: NOW + 150_000,
      seconds: 90,
    });
  });

  it('ends the running rest when a set is unticked', () => {
    const first = toggleDone(start(), 0, 0, NOW);
    expect(toggleDone(first, 0, 0, NOW + 1000).rest).toBeNull();
    const second = toggleDone(first, 0, 1, NOW + 60_000);
    expect(toggleDone(second, 0, 0, NOW + 61_000).rest).toBeNull();
  });

  it('opens the next exercise after the last set', () => {
    let session = toggleDone(start(), 0, 0, NOW);
    expect(session.current).toBe(0);
    session = toggleDone(session, 0, 1, NOW);
    expect(session.current).toBe(1);
  });

  it('carries a weight to the later sets that have none', () => {
    let session = setValues(start(), 0, 1, { weightKg: 60 });
    session = addSet(session, 0);
    session = setValues(session, 0, 0, { weightKg: 44 });
    expect(session.exercises[0]?.sets.map((s) => s.weightKg)).toEqual([44, 60, 60]);
    session = setValues(session, 0, 1, { weightKg: null });
    session = toggleDone(session, 0, 2, NOW);
    session = setValues(session, 0, 0, { weightKg: 50 });
    // The emptied set takes it, the done one keeps its own.
    expect(session.exercises[0]?.sets.map((s) => s.weightKg)).toEqual([50, 50, 60]);
  });

  it('adds sets up to as many as a log can keep', () => {
    let session = start();
    for (let added = 0; added < MAX_SETS; added++) {
      session = addSet(session, 0);
    }
    expect(session.exercises[0]?.sets).toHaveLength(MAX_SETS);
  });

  it('changes values and adds a set like the last one', () => {
    let session = setValues(start(), 0, 1, { weightKg: 82.5, reps: 6 });
    session = addSet(session, 0);
    expect(session.exercises[0]?.sets[2]).toEqual({
      weightKg: 82.5,
      reps: 6,
      seconds: null,
      meters: null,
      done: false,
    });
  });

  it('lengthens, shortens and ends the rest', () => {
    const session = toggleDone(start(), 0, 0, NOW);
    expect(changeRest(session, 15, NOW).rest?.endsAt).toBe(NOW + 105_000);
    expect(changeRest(session, -15, NOW).rest?.endsAt).toBe(NOW + 75_000);
    expect(changeRest(session, -90, NOW).rest).toBeNull();
  });
});

describe('the clock of a timed set', () => {
  it('counts up past the target time and logs the time it ran', () => {
    let session = startClock(start(), 1, 0, NOW);
    expect(session.clock).toEqual({ exercise: 1, set: 0, startedAt: NOW });
    expect(clockSeconds(session.clock!, NOW + 13_000)).toBe(13);
    expect(clockSeconds(session.clock!, NOW - 400)).toBe(0);
    session = stopClock(session, NOW + 52_700);
    expect(session.clock).toBeNull();
    expect(session.exercises[1]?.sets[0]).toMatchObject({ seconds: 52, done: true });
  });

  it('logs at most a day, the most a set can hold', () => {
    const session = stopClock(startClock(start(), 1, 0, NOW), NOW + 30 * 3600_000);
    expect(session.exercises[1]?.sets[0]).toMatchObject({ seconds: 86_400 });
  });

  it('keeps the distance of a set it times', () => {
    let session = startClock(start(), 2, 0, NOW);
    session = stopClock(session, NOW + 490_000);
    expect(session.exercises[2]?.sets[0]).toMatchObject({ meters: 2000, seconds: 490, done: true });
  });
});

describe('a workout left open', () => {
  it('ends at its last done set, at most a workout length after the start', () => {
    let session = toggleDone(start(), 0, 0, NOW + 10 * 60_000);
    session = toggleDone(session, 0, 1, NOW + 20 * 60_000);
    expect(lastActivity(session)).toBe(NOW + 20 * 60_000);
    expect(lastActivity(start())).toBe(NOW);
    expect(lastActivity(toggleDone(start(), 0, 0, NOW + 13 * 3600_000))).toBe(NOW + MAX_WORKOUT_MS);
    // Undone sets do not count.
    expect(lastActivity(toggleDone(session, 0, 1, NOW + 30 * 60_000))).toBe(NOW + 10 * 60_000);
  });

  it('is left open once it has run longer than a workout can be', () => {
    expect(isLeftOpen(start(), NOW + MAX_WORKOUT_MS)).toBe(false);
    expect(isLeftOpen(start(), NOW + MAX_WORKOUT_MS + 1)).toBe(true);
  });
});

describe('finishing', () => {
  it('sends the id the workout got when it started, a new one for each workout', () => {
    const first = start();
    expect(toLog(first, NOW + 60_000).clientId).toBe(first.id);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(start().id).not.toBe(first.id);
  });

  it('sends the planned day the workout counts for, only when it moves', () => {
    const move = { from: '2026-10-19', to: '2026-10-21' };
    expect(toLog(startSession('user-a', PUSH, {}, {}, NOW, move), NOW + 60_000).move).toEqual(move);
    expect(toLog(start(), NOW + 60_000)).not.toHaveProperty('move');
  });

  it('counts what was planned at the start, not the sets added on the way', () => {
    const session = addSet(start(), 0);
    expect(toLog(session, NOW + 60_000)).toMatchObject({ plannedExercises: 3, plannedSets: 4 });
  });

  it('logs only the sets that were done, and adds them up', () => {
    let session: Session = toggleDone(start(), 0, 0, NOW);
    session = setValues(session, 0, 0, { weightKg: 80, reps: 8 });
    expect(toLog(session, NOW + 3_600_000)).toEqual({
      clientId: session.id,
      workoutId: 7,
      plannedExercises: 3,
      plannedSets: 4,
      startedAt: new Date(NOW).toISOString(),
      finishedAt: new Date(NOW + 3_600_000).toISOString(),
      exercises: [
        {
          exerciseId: 'bench',
          sets: [{ weightKg: 80, reps: 8, seconds: null, meters: null }],
        },
        { exerciseId: 'plank', sets: [] },
        { exerciseId: 'rowing', sets: [] },
      ],
    });
    expect(sessionTotals(session)).toEqual({ done: 1, planned: 4, kilograms: 640 });
  });

  it('changes the stored session', () => {
    start();
    updateSession((session) => toggleDone(session, 0, 0, NOW));
    resetSessionStore();
    const stored = JSON.parse(Storage.getItemSync('session.current') ?? '{}') as {
      session: Session;
    };
    expect(stored.session.exercises[0]?.sets[0]?.done).toBe(true);
  });
});
