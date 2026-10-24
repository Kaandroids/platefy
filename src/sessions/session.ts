// The workout in progress (ADR 0020). It lives on the device until it is finished, so that a lost
// connection or a closed app loses nothing; only one workout runs at a time.
import { randomUUID } from 'expo-crypto';
import { Storage } from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import type { Workout, WorkoutTarget } from '@/workouts/workouts';

import { SET_LIMITS } from './fields';
import type { Bests } from './records';

/** What a set records; a value the exercise does not record stays null. */
export type SetValues = {
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  meters: number | null;
};

export type SessionSet = SetValues & {
  done: boolean;
  /** When it was done, as the end of a workout left open; missing in older workouts. */
  doneAt?: number;
};

/** The longest a workout can be, as log_workout() accepts it. */
export const MAX_WORKOUT_MS = 12 * 3600 * 1000;

export type SessionExercise = {
  exerciseId: string;
  target: WorkoutTarget;
  restSeconds: number;
  sets: SessionSet[];
  /** The sets of the exercise's latest log, shown as "last time". */
  last: SetValues[];
  /**
   * The exercise's records before the workout, which sets are compared with; missing in a workout
   * started before they were kept, or without a connection.
   */
  bests?: Bests;
};

/** A clock that counts up for a timed set, until it is stopped. */
export type SetClock = {
  exercise: number;
  set: number;
  startedAt: number;
};

export type Session = {
  /**
   * Sent with the log, so that the workout is saved once however often it is sent (a lost
   * response, a retry). Missing in workouts started before it was kept.
   */
  id?: string;
  userId: string;
  workoutId: number;
  /** The workout's name and type when it started, for showing it while it runs. */
  name: string | null;
  type: Workout['type'];
  startedAt: number;
  exercises: SessionExercise[];
  /** The exercise that is open. */
  current: number;
  /** The rest after a set, until the time it ends. */
  rest: { endsAt: number; seconds: number } | null;
  clock: SetClock | null;
  /** What the workout had when it started; sets added on the way do not count. */
  planned: { exercises: number; sets: number };
  /**
   * The planned day the workout counts for instead of today, saved with the log (ADR 0028), as
   * YYYY-MM-DD: from that day to the day it started.
   */
  move?: { from: string; to: string };
};

/** Sets of an exercise's latest log, in order. */
export type LastSets = Record<string, SetValues[]>;

/** Each exercise's records before the workout. */
export type ExerciseBests = Record<string, Bests>;

const KEY = 'session.current';
/** Raised when the session changes shape, so that an older one is dropped instead of misread. */
const VERSION = 2;

let loaded = false;
let session: Session | null = null;
const listeners = new Set<() => void>();

function load(): Session | null {
  try {
    const stored = Storage.getItemSync(KEY);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored) as { version?: number; session?: Session };
    return parsed.version === VERSION && parsed.session ? parsed.session : null;
  } catch (error) {
    console.warn('Could not read the workout in progress', error);
    return null;
  }
}

function store(value: Session | null) {
  try {
    if (value) {
      Storage.setItemSync(KEY, JSON.stringify({ version: VERSION, session: value }));
    } else {
      Storage.removeItemSync(KEY);
    }
  } catch (error) {
    console.warn('Could not save the workout in progress', error);
  }
}

function current(): Session | null {
  if (!loaded) {
    session = load();
    loaded = true;
  }
  return session;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(value: Session | null) {
  session = value;
  loaded = true;
  store(value);
  for (const listener of listeners) {
    listener();
  }
}

/** The signed-in user's workout in progress, if there is one. */
export function useActiveSession(userId: string | undefined): Session | null {
  const value = useSyncExternalStore(subscribe, current);
  return value && value.userId === userId ? value : null;
}

/** Changes the workout in progress, if there is one. */
export function updateSession(change: (current: Session) => Session) {
  const value = current();
  if (value) {
    set(change(value));
  }
}

/** Ends the workout in progress without saving it, or after it was saved. */
export function endSession() {
  set(null);
}

/** For tests: forgets the session in memory, so that the next read loads it again. */
export function resetSessionStore() {
  loaded = false;
  session = null;
}

/**
 * The values a set starts with: last time's, the set before it if there were fewer, or else the
 * target. They count only once the set is done. The time is left out: the clock measures it.
 */
function startingValues(target: WorkoutTarget, last: SetValues[], index: number): SetValues {
  const previous = last[index] ?? last[last.length - 1];
  if (previous) {
    return { ...previous, seconds: null };
  }
  if ('reps' in target) {
    return { weightKg: null, reps: target.reps.max, seconds: null, meters: null };
  }
  return { weightKg: null, reps: null, seconds: null, meters: target.meters };
}

/** Starts a workout, its sets filled in from last time, counting for a planned day when it moves. */
export function startSession(
  userId: string,
  workout: Workout,
  last: LastSets,
  bests: ExerciseBests = {},
  now = Date.now(),
  move?: Session['move'],
): Session {
  const { exercises } = workout;
  const value: Session = {
    id: randomUUID(),
    userId,
    workoutId: workout.id,
    name: workout.name,
    type: workout.type,
    startedAt: now,
    exercises: exercises.map(({ exerciseId, target, restSeconds, sets }) => ({
      exerciseId,
      target,
      restSeconds,
      last: last[exerciseId] ?? [],
      bests: bests[exerciseId],
      sets: Array.from({ length: sets }, (_set, index) => ({
        ...startingValues(target, last[exerciseId] ?? [], index),
        done: false,
      })),
    })),
    current: 0,
    rest: null,
    clock: null,
    planned: {
      exercises: exercises.length,
      sets: exercises.reduce((total, exercise) => total + exercise.sets, 0),
    },
    ...(move ? { move } : {}),
  };
  set(value);
  return value;
}

function changeSet(
  value: Session,
  exercise: number,
  index: number,
  change: (set: SessionSet) => SessionSet,
): Session {
  return {
    ...value,
    exercises: value.exercises.map((item, i) =>
      i === exercise
        ? { ...item, sets: item.sets.map((s, j) => (j === index ? change(s) : s)) }
        : item,
    ),
  };
}

/**
 * Sets values of a set, for example what the user typed. A weight also fills the later sets of the
 * exercise that are not done and have none yet, since most sets use the same weight.
 */
export function setValues(
  value: Session,
  exercise: number,
  index: number,
  values: Partial<SetValues>,
): Session {
  const weightKg = values.weightKg;
  return {
    ...value,
    exercises: value.exercises.map((item, i) =>
      i === exercise
        ? {
            ...item,
            sets: item.sets.map((s, j) =>
              j === index
                ? { ...s, ...values }
                : j > index && weightKg != null && !s.done && s.weightKg === null
                  ? { ...s, weightKg }
                  : s,
            ),
          }
        : item,
    ),
  };
}

/** Whether every set of the exercise is done. */
export function isExerciseDone(exercise: SessionExercise): boolean {
  return exercise.sets.length > 0 && exercise.sets.every((s) => s.done);
}

/**
 * Marks a set done, or not done again. Done starts the exercise's rest, and when it was the last
 * set, opens the next exercise that is not done.
 */
export function toggleDone(
  value: Session,
  exercise: number,
  index: number,
  now = Date.now(),
): Session {
  const wasDone = value.exercises[exercise]?.sets[index]?.done ?? false;
  let next = changeSet(value, exercise, index, (s) => ({
    ...s,
    done: !wasDone,
    doneAt: wasDone ? undefined : now,
  }));
  // A set ticked or unticked ends the rest that was running: after a set there is only its own
  // rest, if its exercise has one, and a set unticked was most likely ticked by mistake.
  if (wasDone) {
    return { ...next, rest: null };
  }
  const item = next.exercises[exercise];
  next = {
    ...next,
    rest:
      item && item.restSeconds > 0
        ? { endsAt: now + item.restSeconds * 1000, seconds: item.restSeconds }
        : null,
  };
  if (item && isExerciseDone(item)) {
    const following = next.exercises.findIndex((e, i) => i > exercise && !isExerciseDone(e));
    if (following >= 0) {
      next = { ...next, current: following };
    }
  }
  return next;
}

/** The most sets an exercise can have in a log (logged_sets.set_position). */
export const MAX_SETS = 20;

/** Adds a set to an exercise, with the values of its last set but its time. */
export function addSet(value: Session, exercise: number): Session {
  return {
    ...value,
    exercises: value.exercises.map((item, i) => {
      if (i !== exercise || item.sets.length >= MAX_SETS) {
        return item;
      }
      const last = item.sets[item.sets.length - 1];
      const values = last
        ? { weightKg: last.weightKg, reps: last.reps, seconds: null, meters: last.meters }
        : startingValues(item.target, [], 0);
      return { ...item, sets: [...item.sets, { ...values, done: false }] };
    }),
  };
}

/** Starts the clock of a timed set; it counts up, so a set can run past its target time. */
export function startClock(
  value: Session,
  exercise: number,
  index: number,
  now = Date.now(),
): Session {
  return { ...value, clock: { exercise, set: index, startedAt: now }, rest: null };
}

/** The seconds a clock has run; never below zero, as `now` may lag just behind its start. */
export function clockSeconds(clock: SetClock, now = Date.now()): number {
  return Math.max(0, Math.floor((now - clock.startedAt) / 1000));
}

/** Stops the clock and marks its set done with the time it ran. */
export function stopClock(value: Session, now = Date.now()): Session {
  const { clock } = value;
  if (!clock) {
    return value;
  }
  // Rounded down, as the clock shows it, and at most what a set can hold.
  const seconds = Math.min(
    SET_LIMITS.seconds,
    Math.max(1, Math.floor((now - clock.startedAt) / 1000)),
  );
  const next = setValues({ ...value, clock: null }, clock.exercise, clock.set, { seconds });
  return toggleDone(next, clock.exercise, clock.set, now);
}

/**
 * When the workout was last worked on: the latest done set, at most as long after the start as a
 * workout can be. A workout without done sets has its start.
 */
export function lastActivity(value: Session): number {
  const latest = Math.max(
    value.startedAt,
    ...value.exercises.flatMap((exercise) =>
      exercise.sets.flatMap((set) => (set.done && set.doneAt !== undefined ? [set.doneAt] : [])),
    ),
  );
  return Math.min(latest, value.startedAt + MAX_WORKOUT_MS);
}

/** Whether a workout has been open longer than a workout can be, so it was left open. */
export function isLeftOpen(value: Session, now = Date.now()): boolean {
  return now - value.startedAt > MAX_WORKOUT_MS;
}

/** Lengthens or shortens the rest; a rest that is over ends. */
export function changeRest(value: Session, seconds: number, now = Date.now()): Session {
  if (!value.rest) {
    return value;
  }
  const endsAt = value.rest.endsAt + seconds * 1000;
  return { ...value, rest: endsAt > now ? { ...value.rest, endsAt } : null };
}

/** The sets that were done, the way log_workout() takes them. Exercises without any are left out. */
export function toLog(value: Session, finishedAt = Date.now()) {
  return {
    clientId: value.id,
    workoutId: value.workoutId,
    // What the workout had, so the history can say how much of it was done.
    plannedExercises: value.planned.exercises,
    plannedSets: value.planned.sets,
    startedAt: new Date(value.startedAt).toISOString(),
    finishedAt: new Date(Math.max(finishedAt, value.startedAt + 1000)).toISOString(),
    exercises: value.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      sets: exercise.sets
        .filter((s) => s.done)
        .map(({ weightKg, reps, seconds, meters }) => ({ weightKg, reps, seconds, meters })),
    })),
    ...(value.move ? { move: value.move } : {}),
  };
}

/** Sets done and planned, and the weight lifted, for the progress bar and the summary. */
export function sessionTotals(value: Session) {
  const sets = value.exercises.flatMap((exercise) => exercise.sets);
  const done = sets.filter((s) => s.done);
  return {
    done: done.length,
    planned: sets.length,
    kilograms: done.reduce((total, s) => total + (s.weightKg ?? 0) * (s.reps ?? 0), 0),
  };
}
