import { isoWeekday, toIsoDate, weekStart, addDays } from '@/i18n/dates';

import type { WeekSession } from './workouts';

/**
 * A workout moved from one of its days to another day of the same week, or skipped on it when
 * `toOn` is null. Days are YYYY-MM-DD on the device.
 */
export type WorkoutMove = { workoutId: number; fromOn: string; toOn: string | null };

/** A finished workout: which workout it was, and the day it started as YYYY-MM-DD. */
export type FinishedWorkout = { workoutId: number | null; startedOn: string };

export type PlannedStatus = 'done' | 'planned' | 'missed' | 'skipped';

/** A workout planned on a day, after this week's moves. */
export type PlannedWorkout = {
  session: WeekSession;
  status: PlannedStatus;
  /** The day it moved from, or null when it is on one of its own days. */
  movedFrom: string | null;
};

export type ScheduleDay = {
  date: string;
  /** 1 for Monday to 7 for Sunday. */
  weekday: number;
  workouts: PlannedWorkout[];
  /** Workouts planned on this day that moved to another day, with the day they moved to. */
  movedAway: { session: WeekSession; toOn: string }[];
  /** Finished workouts that were not planned on this day. */
  extras: number;
  /** How many of the day's workouts are done. */
  done: number;
  /** How many of the day's workouts count: all but those skipped and not done anyway. */
  total: number;
};

/**
 * The days of a week from Monday, and how many of its planned workouts are done. A skipped workout
 * does not count, so a week can be complete without it.
 */
export type WeekSchedule = { days: ScheduleDay[]; done: number; planned: number };

/** How a day shows on the week card. */
export type DayState =
  'done' | 'partial' | 'today' | 'planned' | 'missed' | 'skipped' | 'movedAway' | 'extra' | 'rest';

type Entry = { session: WeekSession; movedFrom: string | null; skipped: boolean };

/**
 * The week of `today` from the plan's sessions, this week's moves and the workouts finished this
 * week (ADR 0028). A planned workout is done when a workout of it started on its day; the other
 * finished workouts are extras. Moves that no longer fit the plan, such as from a day the
 * workout is no longer on, are ignored.
 */
export function weekSchedule(
  sessions: readonly WeekSession[],
  moves: readonly WorkoutMove[],
  finished: readonly FinishedWorkout[],
  today: Date,
): WeekSchedule {
  const monday = weekStart(today);
  const dates = Array.from({ length: 7 }, (_, index) => toIsoDate(addDays(monday, index)));
  const todayOn = toIsoDate(today);
  const moveOf = new Map(moves.map((move) => [`${move.workoutId}|${move.fromOn}`, move]));

  const entries: Entry[][] = dates.map(() => []);
  const movedAway: ScheduleDay['movedAway'][] = dates.map(() => []);
  const moving: { session: WeekSession; from: number; to: number }[] = [];
  dates.forEach((date, index) => {
    for (const session of sessions.filter((item) => item.weekday === index + 1)) {
      const move = moveOf.get(`${session.workoutId}|${date}`);
      const to = move?.toOn ? dates.indexOf(move.toOn) : -1;
      if (move && move.toOn === null) {
        entries[index]!.push({ session, movedFrom: null, skipped: true });
      } else if (move && to >= 0 && to !== index) {
        moving.push({ session, from: index, to });
      } else {
        entries[index]!.push({ session, movedFrom: null, skipped: false });
      }
    }
  });
  // A move to a day the workout is already on no longer fits, so the workout stays where it was.
  // A day on which it was skipped is free.
  for (const { session, from, to } of moving) {
    if (
      entries[to]!.some((entry) => entry.session.workoutId === session.workoutId && !entry.skipped)
    ) {
      entries[from]!.push({ session, movedFrom: null, skipped: false });
    } else {
      entries[to]!.push({ session, movedFrom: dates[from]!, skipped: false });
      movedAway[from]!.push({ session, toOn: dates[to]! });
    }
  }

  let done = 0;
  let planned = 0;
  const days = dates.map((date, index): ScheduleDay => {
    const logs = finished.filter((log) => log.startedOn === date).map((log) => log.workoutId);
    const finishedOne = ({ session }: Entry) => {
      const log = logs.indexOf(session.workoutId);
      if (log >= 0) {
        logs.splice(log, 1);
      }
      return log >= 0;
    };
    // A workout that is on the day takes its log before one of it that was skipped there.
    const dayEntries = entries[index]!;
    const finishedEntries = new Set([
      ...dayEntries.filter((entry) => !entry.skipped && finishedOne(entry)),
      ...dayEntries.filter((entry) => entry.skipped && finishedOne(entry)),
    ]);
    const workouts = dayEntries.map((entry): PlannedWorkout => {
      const status: PlannedStatus = finishedEntries.has(entry)
        ? 'done'
        : entry.skipped
          ? 'skipped'
          : date < todayOn
            ? 'missed'
            : 'planned';
      return { session: entry.session, status, movedFrom: entry.movedFrom };
    });
    const total = workouts.filter((workout) => workout.status !== 'skipped').length;
    done += finishedEntries.size;
    planned += total;
    return {
      date,
      weekday: index + 1,
      workouts,
      movedAway: movedAway[index]!,
      extras: logs.length,
      done: finishedEntries.size,
      total,
    };
  });
  return { days, done, planned };
}

/**
 * How a day shows on the week card, as seen on `today` as YYYY-MM-DD. Skipped workouts do not
 * count, so a day with the others done is done.
 */
export function dayState(day: ScheduleDay, today: string): DayState {
  if (day.workouts.length === 0) {
    return day.extras > 0 ? 'extra' : day.movedAway.length > 0 ? 'movedAway' : 'rest';
  }
  if (day.total === 0) {
    return 'skipped';
  }
  if (day.done === day.total) {
    return 'done';
  }
  if (day.done > 0) {
    return 'partial';
  }
  if (day.date === today) {
    return 'today';
  }
  return day.workouts.some((workout) => workout.status === 'missed') ? 'missed' : 'planned';
}

/**
 * The next day after `today` with workouts still planned, in this week after its moves and after
 * it on the plan's weekdays, with its weekday and how many days away it is; null without any.
 */
export function nextWorkouts(
  schedule: WeekSchedule,
  sessions: readonly WeekSession[],
  today: Date,
): { inDays: number; weekday: number; sessions: WeekSession[] } | null {
  const weekday = isoWeekday(today);
  for (const day of schedule.days.slice(weekday)) {
    const ahead = day.workouts.filter((workout) => workout.status === 'planned');
    if (ahead.length > 0) {
      return {
        inDays: day.weekday - weekday,
        weekday: day.weekday,
        sessions: ahead.map((workout) => workout.session),
      };
    }
  }
  for (let next = 1; next <= 7; next++) {
    const ahead = sessions.filter((session) => session.weekday === next);
    if (ahead.length > 0) {
      return { inDays: 7 - weekday + next, weekday: next, sessions: ahead };
    }
  }
  return null;
}

/** The day a planned workout is on in the plan, which its move or skip is saved from. */
export function originOf(workout: PlannedWorkout, day: ScheduleDay): string {
  return workout.movedFrom ?? day.date;
}

/**
 * The days a workout can move to as seen on `today` as YYYY-MM-DD: from today to Sunday, but not
 * the day it is on in the plan nor a day it is already on (ADR 0028).
 */
export function moveTargets(
  schedule: WeekSchedule,
  workoutId: number,
  fromOn: string,
  today: string,
): ScheduleDay[] {
  return schedule.days.filter(
    (day) =>
      day.date >= today &&
      day.date !== fromOn &&
      !day.workouts.some(
        (workout) => workout.session.workoutId === workoutId && workout.status !== 'skipped',
      ),
  );
}

/** This week's missed workouts, with the day each was missed on, earliest first. */
export function missedWorkouts(
  schedule: WeekSchedule,
): { workout: PlannedWorkout; day: ScheduleDay }[] {
  return schedule.days.flatMap((day) =>
    day.workouts
      .filter((workout) => workout.status === 'missed')
      .map((workout) => ({ workout, day })),
  );
}

/** Whether a day has workouts on it, or workouts that moved away from it. */
export function hasWorkouts(day: ScheduleDay): boolean {
  return day.workouts.length > 0 || day.movedAway.length > 0;
}

/**
 * Whether the move or skip of a workout from its day `fromOn` can be undone: not once the workout
 * is done, nor while another move of it is on that day, which the undo would push out (ADR 0028).
 */
export function canUndo(schedule: WeekSchedule, workoutId: number, fromOn: string): boolean {
  const ofWorkout = (workout: PlannedWorkout) => workout.session.workoutId === workoutId;
  const origin = schedule.days.find((day) => day.date === fromOn);
  return (
    origin !== undefined &&
    !origin.workouts.some((workout) => ofWorkout(workout) && workout.status !== 'skipped') &&
    !schedule.days.some((day) =>
      day.workouts.some(
        (workout) =>
          ofWorkout(workout) && workout.movedFrom === fromOn && workout.status === 'done',
      ),
    )
  );
}

/**
 * The day a workout started on `today` as YYYY-MM-DD could move from, so that it counts for that
 * day (ADR 0028): its earliest missed day this week, else its next planned one. Null when it is
 * planned today, or no day of it can move to today.
 */
export function startMove(
  schedule: WeekSchedule,
  workoutId: number,
  today: string,
): { fromOn: string; missed: boolean } | null {
  const days = schedule.days.flatMap((day) =>
    day.workouts
      .filter(
        (workout) =>
          workout.session.workoutId === workoutId &&
          (workout.status === 'missed' || (workout.status === 'planned' && day.date > today)),
      )
      .map((workout) => ({ fromOn: originOf(workout, day), missed: workout.status === 'missed' })),
  );
  const fits = (fromOn: string) =>
    moveTargets(schedule, workoutId, fromOn, today).some((day) => day.date === today);
  return (
    days.find(({ missed, fromOn }) => missed && fits(fromOn)) ??
    days.find(({ fromOn }) => fits(fromOn)) ??
    null
  );
}
