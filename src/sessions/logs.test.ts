import { supabase } from '@/lib/supabase';
import { act, createTestQueryClient, renderHook } from '@/test/render';

import { MOVES_KEY } from '@/workouts/moves';

import { fetchBests, fetchLastSets, useLogWorkout } from './logs';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const row = (exerciseId: string, more: object) => ({
  exercise_id: exerciseId,
  weight_kg: null,
  reps: null,
  seconds: null,
  meters: null,
  ...more,
});

beforeEach(() => jest.clearAllMocks());

describe('fetchBests', () => {
  it('groups the bests by exercise and kind', async () => {
    jest.mocked(supabase.rpc).mockResolvedValue({
      data: [
        { exercise_id: 'bench', kind: 'heaviest', value: 85 },
        { exercise_id: 'bench', kind: 'one_rep_max', value: 104.8 },
        { exercise_id: 'plank', kind: 'most_time', value: 140 },
        // A kind the app does not know yet is left out.
        { exercise_id: 'plank', kind: 'slowest', value: 1 },
      ],
      error: null,
    } as never);
    await expect(fetchBests(['bench', 'plank'])).resolves.toEqual({
      bench: { heaviest: 85, one_rep_max: 104.8 },
      plank: { most_time: 140 },
    });
    expect(supabase.rpc).toHaveBeenCalledWith('exercise_bests', {
      exercise_ids: ['bench', 'plank'],
    });
  });
});

describe('fetchLastSets', () => {
  it('groups the latest sets by exercise, in order', async () => {
    jest.mocked(supabase.rpc).mockResolvedValue({
      data: [
        row('bench', { weight_kg: 80, reps: 8 }),
        row('bench', { weight_kg: 80, reps: 7 }),
        row('plank', { seconds: 50 }),
      ],
      error: null,
    } as never);
    await expect(fetchLastSets(['bench', 'plank', 'curl'])).resolves.toEqual({
      bench: [
        { weightKg: 80, reps: 8, seconds: null, meters: null },
        { weightKg: 80, reps: 7, seconds: null, meters: null },
      ],
      plank: [{ weightKg: null, reps: null, seconds: 50, meters: null }],
    });
    expect(supabase.rpc).toHaveBeenCalledWith('last_sets', {
      exercise_ids: ['bench', 'plank', 'curl'],
    });
  });

  it('fails with the error the database returns', async () => {
    const error = { code: '500', message: 'boom' };
    jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error } as never);
    await expect(fetchLastSets(['bench'])).rejects.toBe(error);
  });
});

describe('useLogWorkout', () => {
  it('saves the log and returns its id', async () => {
    jest.mocked(supabase.rpc).mockResolvedValue({ data: 12, error: null } as never);
    const log = {
      clientId: '11111111-1111-1111-1111-111111111111',
      workoutId: 7,
      plannedExercises: 1,
      plannedSets: 3,
      startedAt: 'a',
      finishedAt: 'b',
      exercises: [],
    };
    const queryClient = createTestQueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useLogWorkout(), { queryClient });
    await act(async () => {
      await expect(result.current.mutateAsync(log)).resolves.toBe(12);
    });
    expect(supabase.rpc).toHaveBeenCalledWith('log_workout', { log });
    // The log may bring a move, so the week's moves are loaded again too.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: MOVES_KEY });
  });
});
