import type { WeekSession } from './workouts';
import {
  canUndo,
  dayState,
  missedWorkouts,
  moveTargets,
  nextWorkouts,
  originOf,
  startMove,
  weekSchedule,
  type WorkoutMove,
} from './week-schedule';

const session = (workoutId: number, weekday: number): WeekSession => ({
  workoutId,
  weekday,
  name: `Workout ${workoutId}`,
  type: null,
  exercises: [],
  estimatedMinutes: 45,
});

// Push (1) on Monday and Thursday, Pull (2) on Tuesday, Cardio (3) on Thursday and Saturday.
const SESSIONS = [session(1, 1), session(2, 2), session(1, 4), session(3, 4), session(3, 6)];

// Wednesday, October 21; the week runs from Monday 19 to Sunday 25.
const WEDNESDAY = new Date(2026, 9, 21, 9, 0);

const summary = (schedule: ReturnType<typeof weekSchedule>) =>
  schedule.days.map((day) => ({
    date: day.date,
    workouts: day.workouts.map(
      (workout) =>
        `${workout.session.workoutId}:${workout.status}` +
        (workout.movedFrom ? `<${workout.movedFrom}` : ''),
    ),
    movedAway: day.movedAway.map((away) => `${away.session.workoutId}>${away.toOn}`),
    extras: day.extras,
  }));

describe('weekSchedule', () => {
  it('lays out the plan from Monday, with the workouts done, missed and still planned', () => {
    const schedule = weekSchedule(
      SESSIONS,
      [],
      [{ workoutId: 2, startedOn: '2026-10-20' }],
      WEDNESDAY,
    );
    expect(summary(schedule)).toEqual([
      { date: '2026-10-19', workouts: ['1:missed'], movedAway: [], extras: 0 },
      { date: '2026-10-20', workouts: ['2:done'], movedAway: [], extras: 0 },
      { date: '2026-10-21', workouts: [], movedAway: [], extras: 0 },
      { date: '2026-10-22', workouts: ['1:planned', '3:planned'], movedAway: [], extras: 0 },
      { date: '2026-10-23', workouts: [], movedAway: [], extras: 0 },
      { date: '2026-10-24', workouts: ['3:planned'], movedAway: [], extras: 0 },
      { date: '2026-10-25', workouts: [], movedAway: [], extras: 0 },
    ]);
    // Workouts are counted, not days, so the plan cannot be passed.
    expect(schedule).toMatchObject({ done: 1, planned: 5 });
  });

  it('moves a workout to another day of the week, and skips one', () => {
    const moves: WorkoutMove[] = [
      { workoutId: 1, fromOn: '2026-10-19', toOn: '2026-10-21' },
      { workoutId: 3, fromOn: '2026-10-24', toOn: null },
    ];
    const schedule = weekSchedule(
      SESSIONS,
      moves,
      [{ workoutId: 1, startedOn: '2026-10-21' }],
      WEDNESDAY,
    );
    const days = summary(schedule);
    expect(days[0]).toMatchObject({ workouts: [], movedAway: ['1>2026-10-21'] });
    expect(days[2]).toMatchObject({ workouts: ['1:done<2026-10-19'] });
    expect(days[5]).toMatchObject({ workouts: ['3:skipped'] });
    // The skipped workout no longer counts towards the week.
    expect(schedule).toMatchObject({ done: 1, planned: 4 });
  });

  it('counts a workout not planned on its day as an extra', () => {
    const schedule = weekSchedule(
      SESSIONS,
      [],
      [
        { workoutId: 2, startedOn: '2026-10-21' },
        { workoutId: null, startedOn: '2026-10-20' },
        { workoutId: 2, startedOn: '2026-10-20' },
      ],
      WEDNESDAY,
    );
    const days = summary(schedule);
    expect(days[1]).toMatchObject({ workouts: ['2:done'], extras: 1 });
    expect(days[2]).toMatchObject({ workouts: [], extras: 1 });
    expect(schedule).toMatchObject({ done: 1, planned: 5 });
  });

  it('moves a workout to a day on which it was skipped', () => {
    const moves: WorkoutMove[] = [
      { workoutId: 1, fromOn: '2026-10-22', toOn: null },
      { workoutId: 1, fromOn: '2026-10-19', toOn: '2026-10-22' },
    ];
    const schedule = weekSchedule(
      SESSIONS,
      moves,
      [{ workoutId: 1, startedOn: '2026-10-22' }],
      WEDNESDAY,
    );
    const days = summary(schedule);
    expect(days[0]).toMatchObject({ workouts: [], movedAway: ['1>2026-10-22'] });
    // The workout done on Thursday is the one moved there, not the one skipped.
    expect(days[3]).toMatchObject({ workouts: ['1:skipped', '3:planned', '1:done<2026-10-19'] });
  });

  it('leaves skipped workouts out of what the day and the week count', () => {
    const schedule = weekSchedule(
      SESSIONS,
      [{ workoutId: 1, fromOn: '2026-10-22', toOn: null }],
      [{ workoutId: 3, startedOn: '2026-10-22' }],
      WEDNESDAY,
    );
    expect(schedule.days[3]).toMatchObject({ done: 1, total: 1 });
    expect(dayState(schedule.days[3]!, '2026-10-21')).toBe('done');
    expect(schedule).toMatchObject({ done: 1, planned: 4 });
  });

  it('ignores moves that no longer fit the plan', () => {
    const moves: WorkoutMove[] = [
      // Tuesday is not one of Push's days any more.
      { workoutId: 1, fromOn: '2026-10-20', toOn: '2026-10-21' },
      // Pull would be on a day of another week.
      { workoutId: 2, fromOn: '2026-10-20', toOn: '2026-10-27' },
      // Cardio is already on Thursday.
      { workoutId: 3, fromOn: '2026-10-24', toOn: '2026-10-22' },
    ];
    expect(summary(weekSchedule(SESSIONS, moves, [], WEDNESDAY))).toEqual(
      summary(weekSchedule(SESSIONS, [], [], WEDNESDAY)),
    );
  });
});

describe('dayState', () => {
  const stateOf = (moves: WorkoutMove[], finished: { workoutId: number; startedOn: string }[]) =>
    weekSchedule(SESSIONS, moves, finished, WEDNESDAY).days.map((day) =>
      dayState(day, '2026-10-21'),
    );

  it('sums up each day for the week card', () => {
    expect(
      stateOf(
        [{ workoutId: 3, fromOn: '2026-10-24', toOn: '2026-10-21' }],
        [
          { workoutId: 1, startedOn: '2026-10-22' },
          { workoutId: 2, startedOn: '2026-10-25' },
        ],
      ),
    ).toEqual(['missed', 'missed', 'today', 'partial', 'rest', 'movedAway', 'extra']);
  });

  it('tells done, skipped and planned days apart', () => {
    expect(
      stateOf(
        [{ workoutId: 1, fromOn: '2026-10-19', toOn: null }],
        [{ workoutId: 2, startedOn: '2026-10-20' }],
      ),
    ).toEqual(['skipped', 'done', 'rest', 'planned', 'rest', 'planned', 'rest']);
  });
});

describe('nextWorkouts', () => {
  it('is the next day with workouts still planned this week', () => {
    const schedule = weekSchedule(SESSIONS, [], [], WEDNESDAY);
    expect(nextWorkouts(schedule, SESSIONS, WEDNESDAY)).toEqual({
      inDays: 1,
      weekday: 4,
      sessions: [session(1, 4), session(3, 4)],
    });
  });

  it("continues on next week's plan once this week has nothing left", () => {
    const saturday = new Date(2026, 9, 24, 9, 0);
    const schedule = weekSchedule(
      SESSIONS,
      [],
      [{ workoutId: 3, startedOn: '2026-10-24' }],
      saturday,
    );
    expect(nextWorkouts(schedule, SESSIONS, saturday)).toEqual({
      inDays: 2,
      weekday: 1,
      sessions: [session(1, 1)],
    });
  });

  it('is null without a plan', () => {
    expect(nextWorkouts(weekSchedule([], [], [], WEDNESDAY), [], WEDNESDAY)).toBeNull();
  });
});

describe('moveTargets', () => {
  const datesOf = (moves: WorkoutMove[], workoutId: number, fromOn: string) =>
    moveTargets(weekSchedule(SESSIONS, moves, [], WEDNESDAY), workoutId, fromOn, '2026-10-21').map(
      (day) => day.date,
    );

  it('is today to Sunday, without the days the workout is already on', () => {
    // Push is on Thursday.
    expect(datesOf([], 1, '2026-10-19')).toEqual([
      '2026-10-21',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });

  it('leaves out a day a workout moved to, and frees a day it was skipped on', () => {
    const moves: WorkoutMove[] = [
      { workoutId: 1, fromOn: '2026-10-22', toOn: null },
      { workoutId: 1, fromOn: '2026-10-19', toOn: '2026-10-23' },
    ];
    expect(datesOf(moves, 3, '2026-10-24')).toEqual(['2026-10-21', '2026-10-23', '2026-10-25']);
    expect(datesOf(moves, 1, '2026-10-19')).toEqual([
      '2026-10-21',
      '2026-10-22',
      '2026-10-24',
      '2026-10-25',
    ]);
  });
});

describe('missedWorkouts', () => {
  it('lists the missed workouts with the day they were missed on and the day they are from', () => {
    const thursday = new Date(2026, 9, 22, 9, 0);
    const schedule = weekSchedule(
      SESSIONS,
      [{ workoutId: 1, fromOn: '2026-10-19', toOn: '2026-10-21' }],
      [],
      thursday,
    );
    const missed = missedWorkouts(schedule);
    expect(
      missed.map(({ workout, day }) => [
        workout.session.workoutId,
        day.date,
        originOf(workout, day),
      ]),
    ).toEqual([
      [2, '2026-10-20', '2026-10-20'],
      [1, '2026-10-21', '2026-10-19'],
    ]);
  });
});

describe('canUndo', () => {
  const undoable = (
    moves: WorkoutMove[],
    finished: { workoutId: number; startedOn: string }[] = [],
  ) =>
    moves.map((move) =>
      canUndo(weekSchedule(SESSIONS, moves, finished, WEDNESDAY), move.workoutId, move.fromOn),
    );

  it('undoes a move or a skip until the workout is done', () => {
    const moves: WorkoutMove[] = [
      { workoutId: 1, fromOn: '2026-10-19', toOn: '2026-10-21' },
      { workoutId: 3, fromOn: '2026-10-24', toOn: null },
    ];
    expect(undoable(moves)).toEqual([true, true]);
    expect(
      undoable(moves, [
        { workoutId: 1, startedOn: '2026-10-21' },
        { workoutId: 3, startedOn: '2026-10-24' },
      ]),
    ).toEqual([false, false]);
  });

  it('does not undo a move while another move of the workout is on its day', () => {
    // Push moved from Monday to Friday, then from Thursday to Monday.
    expect(
      undoable([
        { workoutId: 1, fromOn: '2026-10-19', toOn: '2026-10-23' },
        { workoutId: 1, fromOn: '2026-10-22', toOn: '2026-10-19' },
      ]),
    ).toEqual([false, true]);
    // Push skipped on Thursday, then moved there from Monday.
    expect(
      undoable([
        { workoutId: 1, fromOn: '2026-10-22', toOn: null },
        { workoutId: 1, fromOn: '2026-10-19', toOn: '2026-10-22' },
      ]),
    ).toEqual([false, true]);
  });
});

describe('startMove', () => {
  const moveOf = (
    workoutId: number,
    moves: WorkoutMove[] = [],
    finished: { workoutId: number; startedOn: string }[] = [],
  ) => startMove(weekSchedule(SESSIONS, moves, finished, WEDNESDAY), workoutId, '2026-10-21');

  it("moves a workout's earliest missed day to today", () => {
    expect(moveOf(1)).toEqual({ fromOn: '2026-10-19', missed: true });
    expect(moveOf(2)).toEqual({ fromOn: '2026-10-20', missed: true });
  });

  it('moves its next planned day to today when none was missed', () => {
    expect(moveOf(1, [], [{ workoutId: 1, startedOn: '2026-10-19' }])).toEqual({
      fromOn: '2026-10-22',
      missed: false,
    });
    expect(moveOf(3)).toEqual({ fromOn: '2026-10-22', missed: false });
  });

  it('keeps the day a missed workout moved from', () => {
    const moves: WorkoutMove[] = [{ workoutId: 2, fromOn: '2026-10-20', toOn: '2026-10-19' }];
    expect(moveOf(2, moves)).toEqual({ fromOn: '2026-10-20', missed: true });
  });

  it('is null for a workout planned today, done, or not in the plan', () => {
    const moves: WorkoutMove[] = [{ workoutId: 3, fromOn: '2026-10-24', toOn: '2026-10-21' }];
    expect(moveOf(3, moves)).toBeNull();
    expect(moveOf(2, [], [{ workoutId: 2, startedOn: '2026-10-20' }])).toBeNull();
    expect(moveOf(9)).toBeNull();
  });
});
