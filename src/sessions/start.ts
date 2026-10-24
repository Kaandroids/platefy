import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useFinishedThisWeek } from '@/history/history';
import { toIsoDate } from '@/i18n/dates';
import { useUserId } from '@/providers/session-provider';
import { useWorkoutName } from '@/workouts/format';
import { useWeekMoves } from '@/workouts/moves';
import { startMove, weekSchedule } from '@/workouts/week-schedule';
import { useWeek, type Workout } from '@/workouts/workouts';

import { fetchBests, fetchLastSets } from './logs';
import { offerRestAlarm } from './rest-alarm';
import { startSession, type ExerciseBests, type LastSets, type Session } from './session';
import { askStartMove } from './start-move';

/**
 * Starts a workout, filled in from last time and with each exercise's records, and opens it.
 * Without a connection it starts from the targets instead, and notices no records. A workout not
 * planned today that has a missed or later day this week first asks whether it counts for that
 * day (ADR 0028). The first time, it offers to signal the end of rests.
 */
export function useStartWorkout() {
  const { t } = useTranslation();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const workoutName = useWorkoutName();
  const today = new Date();
  const plan = useWeek();
  const moves = useWeekMoves(today);
  const finished = useFinishedThisWeek(today);
  return async (workout: Workout) => {
    if (!userId) {
      return;
    }
    // Without the week, as offline before it ever loaded, the workout is an extra one.
    let move: Session['move'];
    const now = new Date();
    if (plan.data && moves.data && finished.data) {
      const schedule = weekSchedule(plan.data.sessions, moves.data, finished.data, now);
      const from = startMove(schedule, workout.id, toIsoDate(now));
      if (from) {
        const answer = await askStartMove({ name: workoutName(workout), ...from });
        if (answer === null) {
          return;
        }
        move = answer === 'move' ? { from: from.fromOn, to: toIsoDate(now) } : undefined;
      }
    }
    const ids = workout.exercises.map((exercise) => exercise.exerciseId);
    const [last, bests] = await Promise.all([
      queryClient
        .fetchQuery({
          queryKey: ['last-sets', ...ids],
          queryFn: () => fetchLastSets(ids),
          staleTime: 0,
        })
        .catch((error: unknown): LastSets => {
          console.warn('Could not load the last sets', error);
          return {};
        }),
      queryClient
        .fetchQuery({
          queryKey: ['bests', ...ids],
          queryFn: () => fetchBests(ids),
          staleTime: 0,
        })
        .catch((error: unknown): ExerciseBests => {
          console.warn('Could not load the records', error);
          return {};
        }),
    ]);
    startSession(userId, workout, last, bests, Date.now(), move);
    router.push('/session');
    await offerRestAlarm({
      title: t('session.restAlarm.title'),
      message: t('session.restAlarm.message'),
      allow: t('session.restAlarm.allow'),
      notNow: t('session.restAlarm.notNow'),
      channelName: t('session.restOver.channel'),
    }).catch((error: unknown) => console.warn('Could not offer the rest alarm', error));
  };
}
