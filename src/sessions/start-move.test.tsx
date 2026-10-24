import { act, fireEvent, render, screen } from '@/test/render';

import { askStartMove, StartMoveSheet } from './start-move';

describe('StartMoveSheet', () => {
  it('asks whether a workout counts for its missed day, and answers with the choice', async () => {
    await render(<StartMoveSheet />);
    expect(screen.queryByRole('header')).toBeNull();
    let answer: Promise<unknown> = Promise.resolve();
    await act(() => {
      answer = askStartMove({ name: 'Push', fromOn: '2026-10-19', missed: true });
    });
    expect(screen.getByText("Do Monday's Push today?")).toBeTruthy();
    expect(
      screen.getByText(
        'Push was planned for Monday and missed. Moved to today, it counts towards this week.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Saved to your history, not counted towards the week. Monday stays missed.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Move to today' }));
    await expect(answer).resolves.toBe('move');
    expect(screen.queryByText("Do Monday's Push today?")).toBeNull();
  });

  it('names a later day as still planned, and answers extra or cancel', async () => {
    await render(<StartMoveSheet />);
    let answer: Promise<unknown> = Promise.resolve();
    await act(() => {
      answer = askStartMove({ name: 'Legs', fromOn: '2026-10-23', missed: false });
    });
    expect(
      screen.getByText(
        'Legs is planned for Friday. Moved to today, it counts towards this week and Friday is free.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Extra workout' }));
    await expect(answer).resolves.toBe('extra');

    await act(() => {
      answer = askStartMove({ name: 'Legs', fromOn: '2026-10-23', missed: false });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await expect(answer).resolves.toBeNull();
  });
});
