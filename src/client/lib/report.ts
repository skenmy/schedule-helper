// The event report page (views/Report.svelte): where it lives and its exports.
// The numbers come from shared/report.ts, the same code the server's
// /report.json and /report.csv use.

import { reportCsv, type Report } from '../../shared/report.ts';
import { roomPath } from '../../shared/sources.ts';
import type { RoomRef } from '../../shared/types.ts';

export const reportPath = (ref: RoomRef) => `${roomPath(ref)}?report=1`;

export const reportApi = (ref: RoomRef, format: 'json' | 'csv') =>
  `/api/rooms${roomPath(ref)}/report.${format}`;

/**
 * Saves the CSV from what's on screen, so it works offline too. The BOM makes
 * Excel read it as UTF-8 (runner names, en dashes).
 */
export function downloadCsv(report: Report): void {
  const blob = new Blob([`\uFEFF${reportCsv(report)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.event.ref.event}-${report.event.ref.slug}-report.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
