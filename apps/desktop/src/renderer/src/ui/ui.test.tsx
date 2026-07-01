import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, Select, Switch, Dialog, ToastProvider, useToast, VirtualList } from './index';

describe('shared components', () => {
  it('Button fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('Switch toggles and exposes role=switch', () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onChange={setOn} label="feature" />;
    }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'feature' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('Dialog shows when open and closes on Escape', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open={false} title="T" onClose={onClose}>
        body
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <Dialog open title="T" onClose={onClose}>
        body
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Select opens a listbox and selects an option', () => {
    function Harness() {
      const [v, setV] = useState('a');
      return (
        <Select
          label="Letter"
          value={v}
          onChange={setV}
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ]}
        />
      );
    }
    render(<Harness />);
    const trigger = screen.getByLabelText('Letter');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }));
    // selection applied + listbox closed
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('VirtualList renders only the visible window of rows', () => {
    const items = Array.from({ length: 200 }, (_, i) => `row-${i}`);
    const { container } = render(
      <VirtualList
        items={items}
        itemHeight={20}
        height={100}
        getKey={(it) => it}
        renderItem={(it) => <div>{it}</div>}
      />,
    );
    expect(screen.getByText('row-0')).toBeInTheDocument();
    expect(screen.queryByText('row-150')).toBeNull();

    const list = container.querySelector('.ui-vlist')!;
    fireEvent.scroll(list, { target: { scrollTop: 1000 } });
    expect(screen.getByText('row-50')).toBeInTheDocument();
    expect(screen.queryByText('row-0')).toBeNull();
  });

  it('Toast shows a message via useToast', () => {
    function Trigger() {
      const toast = useToast();
      return <Button onClick={() => toast.show('saved', 'success')}>show</Button>;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    expect(screen.getByText('saved')).toBeInTheDocument();
  });
});
