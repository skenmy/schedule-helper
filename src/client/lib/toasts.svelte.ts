// Transient notifications, with an optional action button.

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
  timeout: number;
}

let nextId = 1;

class Toasts {
  items = $state<Toast[]>([]);

  push(toast: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }): number {
    const id = nextId++;
    const timeout = toast.timeout ?? (toast.kind === 'error' ? 7000 : 4500);
    // Collapse repeats of the same message instead of stacking them.
    this.items = [
      ...this.items.filter((t) => t.title !== toast.title),
      { ...toast, id, timeout },
    ].slice(-4);
    if (timeout > 0) setTimeout(() => this.dismiss(id), timeout);
    return id;
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
