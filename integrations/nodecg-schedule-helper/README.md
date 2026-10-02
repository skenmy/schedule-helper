# nodecg-schedule-helper

A NodeCG bundle that tells [Schedule Helper](../../README.md) which run
nodecg-speedcontrol has up and what its timer is doing, so the schedule can
follow the stream: a run change or a timer start shows up as a suggestion for
the operators (or is acted on, with auto-apply on), with the start time taken
from speedcontrol's own timer.

It only reads speedcontrol's `runDataActiveRun` and `timer` replicants. Nothing
changes in speedcontrol or the dashboard.

## Install

1. Copy this folder into NodeCG's `bundles/` as `nodecg-schedule-helper`.
2. In Schedule Helper, open **Stream capture → Auto-tracking → Stream PC** and
   press **Set up the stream PC**. Copy the configuration it shows into
   `cfg/nodecg-schedule-helper.json`:

   ```json
   {
     "url": "https://schedule.skenmy.com",
     "room": "oengus/myevent/main",
     "token": "…"
   }
   ```

3. Restart NodeCG. The log says `Reporting speedcontrol to …`, and Schedule
   Helper shows what speedcontrol reports under Stream PC.

Needs Node 18+ (NodeCG 2) or NodeCG 1.8+. No dependencies.

## What it sends

On every change of active run or timer state, and every 15 seconds:

```json
{
  "t": "token",
  "via": "bundle",
  "run": { "externalID": "1234", "game": "…", "category": "…", "players": ["…"] },
  "timer": { "state": "running", "elapsedMs": 81234 }
}
```

The elapsed time is a duration, so the stream PC's clock doesn't need to be
right. Runs imported from Oengus keep their line ID (`externalID`), which
matches Schedule Helper's run exactly; otherwise the game, category and runners
are matched against the live run and the next three.

## Can't install a bundle?

Use the bridge page instead: a browser on the stream PC (or an OBS browser
source) reads speedcontrol through NodeCG's own socket and reports the same
thing. Schedule Helper shows its address next to the bundle configuration.
