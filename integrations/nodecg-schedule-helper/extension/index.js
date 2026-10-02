// Schedule Helper for NodeCG speedcontrol. Tells a Schedule Helper schedule
// which run speedcontrol has up and what its timer is doing, so the schedule
// can follow the stream (see Schedule Helper's README, "NodeCG speedcontrol").
//
// Reads two speedcontrol replicants and POSTs a small report whenever the run
// or the timer's state changes, and every 15 seconds as a heartbeat. Needs no
// changes to speedcontrol and nothing in the dashboard: configure it in
// cfg/nodecg-schedule-helper.json (url, room, token).

'use strict';

const http = require('node:http');
const https = require('node:https');

const HEARTBEAT_MS = 15_000;
const TIMEOUT_MS = 10_000;
/** Speedcontrol changes several replicants at once (reset the timer, change run): send once. */
const SETTLE_MS = 250;

/** What's news: the run, and the timer's state (not its ticking). */
const newsOf = (report) => JSON.stringify([report.run, report.timer && report.timer.state]);
const RETRY_MS = 5_000;

/**
 * What speedcontrol's replicants say, as Schedule Helper's report (without the
 * token). Kept in step with src/client/lib/nodecg-report.ts (the bridge page).
 */
function buildReport(run, timer, now = Date.now()) {
  // Speedcontrol ticks every 100 ms; add the time since its last tick, but never
  // more than a second of it (right after a resume, `timestamp` is from before).
  const sinceTick =
    timer && timer.state === 'running' && timer.timestamp
      ? Math.min(1_000, Math.max(0, now - timer.timestamp))
      : 0;
  const elapsedMs = timer ? Math.max(0, (timer.milliseconds || 0) + sinceTick) : 0;
  return {
    via: 'bundle',
    run: run
      ? {
          externalID: run.externalID != null ? String(run.externalID) : null,
          game: run.game || null,
          category: run.category || null,
          players: (run.teams || [])
            .flatMap((team) => (team.players || []).map((p) => p && p.name))
            .filter(Boolean)
            .slice(0, 32),
        }
      : null,
    timer: timer && timer.state ? { state: timer.state, elapsedMs: Math.round(elapsedMs) } : null,
  };
}

/** POSTs JSON; resolves with the status and parsed body, rejects on network errors. */
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': data.length },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(data);
  });
}

function start(nodecg, { heartbeatMs = HEARTBEAT_MS } = {}) {
  const log = nodecg.log;
  const { url, room, token } = nodecg.bundleConfig || {};
  if (!url || !room || !token) {
    log.warn(
      'Not reporting: set url, room and token in cfg/nodecg-schedule-helper.json ' +
        '(Schedule Helper → Stream capture → Stream PC shows them).',
    );
    return null;
  }
  const endpoint = new URL(`/api/rooms/${room.replace(/^\/+|\/+$/g, '')}/nodecg`, url);
  const activeRun = nodecg.Replicant('runDataActiveRun', 'nodecg-speedcontrol');
  const timer = nodecg.Replicant('timer', 'nodecg-speedcontrol');

  let lastKey = '';
  let inFlight = false;
  let again = false;
  let problem = '';
  let settle = null;
  let retry = null;
  let seen = '';

  // The timer replicant changes every 100 ms while running. Only real news
  // (a run change, a start, a stop) is worth sending, and settling for, at once.
  function changed() {
    const news = newsOf(buildReport(activeRun.value, timer.value));
    if (news === seen) return;
    seen = news;
    clearTimeout(settle);
    settle = setTimeout(() => send(false), SETTLE_MS);
  }

  function failed(message) {
    if (message !== problem) log.warn(message);
    problem = message;
    lastKey = '';
    clearTimeout(retry);
    retry = setTimeout(() => send(true), RETRY_MS);
  }

  function send(force) {
    const report = buildReport(activeRun.value, timer.value);
    const key = newsOf(report);
    if (!force && key === lastKey) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    lastKey = key;
    postJson(endpoint, { t: token, ...report })
      .then(({ status, body }) => {
        if (status === 200) {
          if (problem) log.info(`Reporting to ${endpoint.origin} again.`);
          problem = '';
          return;
        }
        failed(`Schedule Helper said ${status}: ${(body && body.error) || 'no reason given'}`);
      })
      .catch((err) => failed(`Can't reach ${endpoint.origin}: ${err.message}`))
      .finally(() => {
        inFlight = false;
        if (again) {
          again = false;
          send(false);
        }
      });
  }

  activeRun.on('change', changed);
  timer.on('change', changed);
  const heartbeat = setInterval(() => send(true), heartbeatMs);
  if (heartbeat.unref) heartbeat.unref();
  log.info(`Reporting speedcontrol to ${endpoint.origin} for ${room}.`);
  return {
    send,
    stop: () => {
      clearInterval(heartbeat);
      clearTimeout(settle);
      clearTimeout(retry);
    },
  };
}

module.exports = (nodecg) => {
  start(nodecg);
};
module.exports.buildReport = buildReport;
module.exports.start = start;
