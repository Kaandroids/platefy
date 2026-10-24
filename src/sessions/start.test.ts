import { router } from 'expo-router';

import { useFinishedThisWeek } from '@/history/history';
import { act, createTestQueryClient, renderHook } from '@/test/render';
import { useWeekMoves } from '@/workouts/moves';
import { useWeek, type WeekSession, type Workout } from '@/workouts/workouts';

import { startSession } from './session';
import { useStartWorkout } from './start';
import { askStartMove } from './start-move';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/providers/session-provider', () => ({ useUserId: () => 'user-a' }));
jest.mock('@/workouts/workouts', () => ({ useWeek: jest.fn() }));
jest.mock('@/workouts/moves', () => ({ useWeekMoves: jest.fn() }));
jest.mock('@/history/history', () => ({ useFinishedThisWeek: jest.fn() }));
jest.mock('./logs', () => ({
  fetchLastSets: jest.fn().mockResolvedValue({}),
  fetchBests: jest.fn().mockResolvedValue({}),
}));
jest.mock('./rest-alarm', () => ({ offerRestAlarm: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./session', () => ({ startSession: jest.fn() }));
jest.mock('./start-move', () => ({ askStartMove: jest.fn() }));

// Wednesday, October 21.
const WEDNESDAY = new Date(2026, 9, 21, 9, 0);

const PUSH: Workout = {
  id: 1,
  name: 'Push',
  type: null,
  weekdays: [1],
  active: true,
  exercises: [],
  estimatedMinutes: 45,
};

const session: WeekSession = {
  workoutId: 1,
  weekday: 1,
  name: 'Push',
  type: null,
  exercises: [],
  estimatedMinutes: 45,
};

function mockWeek(loaded = true) {
  jest
    .mocked(useWeek)
    .mockReturnValue({ data: loaded ? { sessions: [session] } : undefined } as never);
  jest.mocked(useWeekMoves).mockReturnValue({ data: loaded ? [] : undefined } as never);
  jest.mocked(useFinishedThisWeek).mockReturnValue({ data: loaded ? [] : undefined } as never);
}

async function start() {
  const { result } = await renderHook(() => useStartWorkout(), {
    queryClient: createTestQueryClient(),
  });
  await act(() => result.current(PUSH));
}

describe('useStartWorkout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: WEDNESDAY, advanceTimers: true });
  });
  afterEach(() => jest.useRealTimers());

  it('asks about a missed workout and keeps its move when it moves to today', async () => {
    mockWeek();
    jest.mocked(askStartMove).mockResolvedValue('move');
    await start();
    expect(askStartMove).toHaveBeenCalledWith({ name: 'Push', fromOn: '2026-10-19', missed: true });
    expect(startSession).toHaveBeenCalledWith('user-a', PUSH, {}, {}, expect.any(Number), {
      from: '2026-10-19',
      to: '2026-10-21',
    });
    expect(router.push).toHaveBeenCalledWith('/session');
  });

  it('starts an extra workout without a move', async () => {
    mockWeek();
    jest.mocked(askStartMove).mockResolvedValue('extra');
    await start();
    expect(startSession).toHaveBeenCalledWith(
      'user-a',
      PUSH,
      {},
      {},
      expect.any(Number),
      undefined,
    );
  });

  it('does not start when the question is cancelled', async () => {
    mockWeek();
    jest.mocked(askStartMove).mockResolvedValue(null);
    await start();
    expect(startSession).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('starts without asking when the week has not loaded', async () => {
    mockWeek(false);
    await start();
    expect(askStartMove).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledWith(
      'user-a',
      PUSH,
      {},
      {},
      expect.any(Number),
      undefined,
    );
  });
});
