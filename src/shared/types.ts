// Domain types shared by the server, the Svelte client and the overlay feed.

export type ScheduleSource = 'oengus' | 'horaro' | 'demo';

/** Identifies one schedule (and therefore one sync room). */
export interface RoomRef {
  source: ScheduleSource;
  event: string;
  slug: string;
}

/**
 * Stable identifier for a schedule line. Oengus lines use their upstream id;
 * Horaro/demo lines use a content-derived key. Keys (not indexes) are what
 * room state refers to, so re-importing a schedule with inserted or reordered
 * runs keeps check-ins, timings and the current run attached to the right run.
 */
export type RunKey = string;

export interface ScheduleLine {
  key: RunKey;
  game: string;
  category: string;
  console: string;
  /** Oengus run type: SINGLE, RACE, COOP, RELAY, … */
  type: string;
  runners: string[];
  estimateSec: number;
  /** Setup buffer that follows this line. */
  setupSec: number;
  /** Epoch ms, or null when upstream has no date for the line. */
  scheduledStart: number | null;
  /** Interlude / setup-only line (never "played"). */
  setupBlock: boolean;
  setupBlockText: string;
}

export interface Schedule {
  ref: RoomRef;
  eventName: string;
  scheduleName: string;
  /** Default Twitch channel advertised upstream. */
  twitch: string;
  lines: ScheduleLine[];
  fetchedAt: number;
}

export interface ScheduleSummary {
  slug: string;
  name: string;
}

export type CheckIn = 'ready' | 'missing';

/**
 * Everything we know about one run as it actually happened. The live timer is
 * derived from the current run's record: started + not ended = running.
 */
export interface RunRecord {
  startedAt?: number;
  endedAt?: number;
  skipped?: boolean;
  checkIn?: CheckIn;
  /** The runners are on their way. Any check-in (ready, missing, cleared) replaces it. */
  late?: RunnerLate;
  /** When the runner last checked in from their own link; an operator's check-in clears it. */
  selfAt?: number;
}

export interface RunnerLate {
  /** When they said so. */
  at: number;
  /** When they expect to be there, or null for "not sure". */
  etaAt: number | null;
  note: string;
  /** Said by the runner through their check-in link, not by an operator for them. */
  self: boolean;
}

export type LogKind = 'note' | 'tech' | 'runner' | 'system' | 'warning';

export interface LogEntry {
  id: number;
  at: number;
  kind: LogKind;
  text: string;
  runKey: RunKey | null;
  /** Display name of whoever caused the entry; null for automatic entries. */
  actor: string | null;
}

export interface Broadcast {
  text: string;
  color: string;
  by: string | null;
  at: number;
}

export interface DriftSettings {
  enabled: boolean;
  intervalMin: number;
  thresholdSec: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface CaptureResult {
  id: string;
  /** Server wallclock when the frame was grabbed. */
  at: number;
  auto: boolean;
  by: string | null;
  channel: string;
  error: string | null;
  elapsedSec: number | null;
  estimateSec: number | null;
  game: string | null;
  /** Schedule line the detected game resolved to, if any. */
  runKey: RunKey | null;
  confidence: Confidence | null;
  /** Our timer for the current run at `at`, when it had started. */
  ourElapsedSec: number | null;
  /** Stream timer minus ours (positive: the stream is ahead of us). */
  driftSec: number | null;
  /** Current run at capture time, to spot "stream shows a different game". */
  currentKey: RunKey | null;
}

/** What follows the stream to notice run changes on its own. Per room; not undoable. */
export interface TrackingSettings {
  /** Watch the Twitch channel's category and title. */
  twitch: boolean;
  /** Read stream frames (Claude) around expected run changes. */
  vision: boolean;
  /** Act without asking when two independent signals agree. Off: always ask. */
  autoApply: boolean;
  /** Listen to the stream PC's NodeCG speedcontrol (when it reports in). */
  nodecg: boolean;
}

/**
 * Where a signal came from. `nodecg` and `push` are reserved for sources that
 * talk to the stream PC (NodeCG speedcontrol, a timer bridge).
 */
export type SignalSource = 'twitch' | 'vision' | 'nodecg' | 'push';

export interface DetectionSignal {
  source: SignalSource;
  /** When the source saw it (server wallclock). */
  at: number;
  /** For the operator: "Twitch category → Spyro the Dragon", "stream timer 0:01:12". */
  detail: string;
  /** When the run started on stream, if this source can tell (a timer reading). */
  startedAt: number | null;
  /** When the run's timer finished on stream, if this source can tell (the stream PC's timer). */
  endedAt?: number | null;
}

/**
 * The stream appears to have moved on: to a later run, or the current run's
 * timer has started (or finished) on stream but not here. Accepting it is an ordinary,
 * undoable action; it never applies itself unless `tracking.autoApply` is on
 * and two independent signals agree.
 */
export interface Detection {
  id: string;
  runKey: RunKey;
  /**
   * `advance`: a later run is on stream. `start`: the current run has started on stream.
   * `finish`: the current run's timer has finished on stream while ours still runs.
   */
  kind: 'advance' | 'start' | 'finish';
  /** The live run when this was detected; if that changes, the detection is dropped. */
  currentKey: RunKey | null;
  /** Best estimate of the run's start on stream, from a timer reading. */
  startedAt: number | null;
  /** `finish` only: when the run's timer finished on stream. */
  endedAt?: number | null;
  firstAt: number;
  signals: DetectionSignal[];
}

/**
 * A detection an operator (or auto-apply) already dealt with. While the live
 * run is the same, the same suggestion isn't raised again, so a dismissal or
 * an undo sticks even though the stream keeps showing the same thing.
 */
export interface SettledDetection {
  runKey: RunKey;
  kind: Detection['kind'];
  currentKey: RunKey | null;
  at: number;
}

/** What the stream PC's NodeCG speedcontrol last reported (src/server/tracking/nodecg.ts). */
export interface NodecgStatus {
  /** When it last reported in. */
  at: number;
  /** The NodeCG bundle on the stream PC, or the bridge page in a browser there. */
  via: 'bundle' | 'bridge';
  game: string | null;
  /** The run on our schedule that speedcontrol's active run matched, if any. */
  runKey: RunKey | null;
  timer: 'stopped' | 'running' | 'paused' | 'finished' | null;
  /** The timer as of `at`. */
  elapsedSec: number | null;
  /** When speedcontrol's timer started (server clock), from its last report while running. */
  startedAt?: number | null;
  /** When it finished (server clock): that start plus its final time. */
  endedAt?: number | null;
}

/** The last thing a stream-info source (Twitch) reported for the room's channel. */
export interface StreamInfo {
  live: boolean;
  game: string | null;
  title: string | null;
  at: number;
  /** Set when the source is unavailable (no credentials, API error). */
  error: string | null;
}

export interface UndoInfo {
  /** Identifies the entry, so an undo can't revert a different change. */
  id: number;
  summary: string;
  actor: string | null;
  at: number;
}

export interface RoomState {
  /** Monotonic revision, bumped on every change. */
  rev: number;
  currentKey: RunKey | null;
  /** Set when the last run is advanced past; the marathon is over. */
  finishedAt: number | null;
  runs: Record<RunKey, RunRecord>;
  /** Newest first. Doubles as the audit trail. */
  log: LogEntry[];
  /** Last log id handed out; ids never repeat. */
  logSeq: number;
  /** Message board shown on kiosk message panels. */
  message: Broadcast | null;
  /** Banner pinned to the top of every operator's screen. */
  announcement: Broadcast | null;
  twitchChannel: string;
  drift: DriftSettings;
  capture: CaptureResult | null;
  captureBusy: boolean;
  tracking: TrackingSettings;
  /** A run change the sources noticed, waiting for an operator (or auto-apply). */
  detection: Detection | null;
  settled: SettledDetection | null;
  stream: StreamInfo | null;
  /** The stream PC's speedcontrol, once it has reported in. */
  nodecg: NodecgStatus | null;
  /** The action `undo` would revert, if any. */
  undo: UndoInfo | null;
  updatedAt: number;
}

export interface AuthUser {
  login: string;
  display: string;
  avatar: string | null;
}

export interface AuthInfo {
  authenticated: boolean;
  canWrite: boolean;
  root: boolean;
  user: AuthUser | null;
  loginUrl: string | null;
  manageUrl: string | null;
}
