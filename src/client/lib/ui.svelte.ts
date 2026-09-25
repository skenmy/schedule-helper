// Local UI state for the room view: open panels and dialogs, active tab.

import type { RunKey } from '../../shared/types.ts';

export type TabId = 'schedule' | 'log' | 'capture' | 'broadcast' | 'kiosk' | 'progress';
/** `tool` shows the active workspace tab (capture, broadcast, kiosk, progress). */
export type MobileView = 'now' | 'upnext' | 'schedule' | 'log' | 'tool';

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  /** For irreversible actions: the word the operator must type to enable the button. */
  typeToConfirm?: string;
  resolve: (ok: boolean) => void;
}

class UI {
  tab = $state<TabId>('schedule');
  mobileView = $state<MobileView>('now');
  moreOpen = $state(false);
  /** Run whose detail sheet is open. */
  runSheet = $state<RunKey | null>(null);
  /** Run whose timing editor is open. */
  editTimes = $state<RunKey | null>(null);
  setElapsed = $state(false);
  palette = $state(false);
  help = $state(false);
  confirm = $state<ConfirmRequest | null>(null);

  ask(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
    this.confirm?.resolve(false);
    return new Promise((resolve) => (this.confirm = { ...req, resolve }));
  }

  /** Opens a workspace tab, switching mobile to where tabs live. */
  openTab(tab: TabId): void {
    this.tab = tab;
    this.mobileView = tab === 'schedule' || tab === 'log' ? tab : 'tool';
    this.moreOpen = false;
  }

  reset(): void {
    this.runSheet = null;
    this.editTimes = null;
    this.setElapsed = false;
    this.palette = false;
    this.help = false;
    this.moreOpen = false;
    this.confirm?.resolve(false);
    this.confirm = null;
  }
}

export const ui = new UI();

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}
