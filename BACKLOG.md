# Backlog

Work identified during the `main..dev` baseline review that is deliberately
**not** being done on `chore/claude-baseline`. That branch is scoped to the
delta between `main` and `dev` only.

Each item records what was found, why it is out of scope there, and where it
should land instead.

---

## 1. `constructInsertString` builds SQL without escaping

**Severity:** high — silent data loss
**Where it belongs:** its own branch, e.g. `fix/db-sql-escaping`
**Why not on the baseline branch:** pre-dates the delta; `db/utils.js:962` is
unchanged since before `main`.

`db/utils.js:962`:

```js
function constructInsertString(arr) {
  return "'" + arr.join("', '") + "'";
}
```

Values are concatenated into the statement rather than bound, with no escaping.
Any single quote in a value breaks the generated SQL.

The reachable failure is `recordRebalanceFailure`, which passes `errorMsg`
straight through. That text comes from bos/LND and can contain apostrophes
(`can't route`). The chain:

1. Apostrophe breaks the INSERT
2. `executeDb(db, cmd)` is called with no callback, so the error only reaches
   the internal `if (err) logger.debug(...)` — below the default log level
3. The surrounding `try/catch` cannot catch it: `db.run` delivers errors
   asynchronously to the callback, it never throws
4. `doIt()`'s retry tests the *returned* `err`, which only the sync catch sets,
   so it is always `undefined` and no retry fires

Net: a rebalance failure whose error text contains an apostrophe is dropped
from rebalance history with no visible log. That history drives exponential
backoff and peer selection, so the loss is not cosmetic.

`recordTelegramMessageSync` already works around this narrowly, at
`db/utils.js:582`:

```js
const m = msg.replaceAll("'", '"');
```

That patches one caller and corrupts message text as a side effect
(`didn't` becomes `didn"t`).

**Suggested fix.** Escape at the single choke point using SQL-standard quote
doubling, then delete the `replaceAll` workaround so message text survives
intact:

```js
function constructInsertString(arr) {
  // values are concatenated into the statement rather than bound, so an
  // apostrophe would otherwise break the insert
  return "'" + arr.map(v => String(v).replaceAll("'", "''")).join("', '") + "'";
}
```

Parameterised queries are the proper fix, but that is a large refactor of an
intentionally unlinted legacy layer and should be costed separately.

---

## 2. Documented Node version does not match what the code needs

**Severity:** high — new users hit it on first run
**Where it belongs:** Phase 2, alongside `chore/runtime-modernization`
**Why not on the baseline branch:** the fix has to agree with the `engines`
bump that `runtime-modernization` already makes. Landing the two separately
risks them disagreeing.

Note this one **is** delta-caused. `main` contains no `styleText` and no
`replaceAll`, so it genuinely ran on Node 16 as documented. The delta raised
the floor.

| Source | Claims | Reality |
|---|---|---|
| `package.json` engines | `>=12` | wrong before and after |
| `README.md:27` | "version 16.x+" | wrong as of the delta |
| Actual code | — | **Node 20.12+** |

What forces it up:

- `cli/index.js:2` `styleText` from `node:util` — Node 20.12+
- `db/utils.js:582` `replaceAll` — Node 15+
- `api/utils.js:1-2` `node:` prefixed requires — Node 14.18+ (already on `main`)

`engines` is not enforced by npm without `engine-strict`, so `npm install`
succeeds and the failure surfaces at runtime instead — `styleText` is
`undefined` on Node 16/18 and help rendering throws.

`chore/runtime-modernization` sets `engines` to `>=22` and adds `.nvmrc`, but
does not touch the README. **Update `README.md:27` to match whatever `engines`
ends up at, in the same change.**

---

## 3. Async `executeDb` errors bypass both the catch and the retry

**Severity:** medium
**Where it belongs:** with item 1 — same code path, same branch

Independent of the escaping issue, `executeDb` errors are structurally
unreachable by the callers' error handling:

- `deleteTelegramMessages` (`db/utils.js:~600`) and `deleteProp`
  (`db/utils.js:~601`) call `executeDb(db, cmd)` with no callback at all, so
  failures are logged at `debug` and otherwise discarded
- the `doIt()` retry idiom used throughout the file only re-runs when the
  synchronous catch sets `err`, which never happens for async `db.run` errors

Worth noting the delta *improved* this line rather than regressing it: the old
code was `if (err & testMode)` — a bitwise `&` on an Error object, always
falsy, so it never logged at all. The new `if (err) logger.debug(...)` at least
records something. It is just still below the default threshold.

---

## 4. `api/telegram.js` has no throttling or deduplication

**Severity:** low — robustness
**Where it belongs:** its own branch

`sendMessage` sends unconditionally. There is no rate limit and no dedup, so
any caller in a recurring code path can flood the chat and get the bot
throttled by Telegram.

`chore/claude-baseline` fixed this at one call site (`653a1d2`, the rebalancer
loop) by making the notification edge-triggered. The other recurring callers
are currently safe only because they notify on a transition they then act on:
`launcher.js` restarts the service, `worker.js` kills the stuck process. That
is a convention holding by discipline, not by construction.

Consider a shared guard in `api/telegram.js` — suppress an identical message
within a window — so new call sites cannot reintroduce the problem.

---

## 5. `isLndAlive` logs before validating its argument

**Severity:** trivial
**Where it belongs:** opportunistic

`lnd-api/utils.js:132` logs `'lnd alive check'` before the
`if (!lndClient) throw` guard on the next line, so a bad call logs a check that
never happened.

---

## 6. os stats monitoring is only half implemented

**Severity:** medium — a full disk silently goes unmonitored
**Where it belongs:** feature work, its own branch

`api/constants.js:115-119` defines three monitored categories:

```js
cat: { mem: 'mem', cpu: 'cpu', disk: 'disk' }
```

`checkStats()` in `api/os-stats.js` only ever raises issues for `mem`.
`osStats()` collects `stats.cpu`, `stats.diskGb` and `stats.freeGb` and then
discards them, so the `cpu` and `disk` categories are declared but dead.

Disk is the one that matters: an lnd node that fills its disk stops working, and
the constants suggest this alert was meant to exist. Needs thresholds chosen
for both, in the shape the `mem` checks already use.

---

## 7. os stats alert text reports the measured value as the threshold

**Severity:** low — user-facing wording
**Where it belongs:** with item 6

`api/os-stats.js` builds messages as:

```js
msg: '[WARNING] memory utilization exceeds ' + stats.mem + ' %'
```

so at 86% utilisation the telegram alert reads "memory utilization exceeds
86 %", which states the measured value as if it were the threshold. The
threshold is 85. Running `node test/os-stats` reproduces it directly.

Should read either "is 86 %" or "exceeds 85 %".

---

## 8. The lint gate hides every warning

**Severity:** low — the gate is weaker than it looks
**Where it belongs:** with any lint tidy-up

`npm run check` runs `lint:errors`, which is `eslint --quiet`, so only errors
fail it. The config sets `no-unused-vars` and `eqeqeq` to `warn`, so those never
block. The tree currently has **17 warnings, 0 errors** — `npm run check` passes
and reports nothing.

That is a reasonable gradual-adoption stance, but "check passes" currently
means less than it appears. Either clear the 17 and promote the rules to
`error`, or leave them and be explicit that the gate only catches hard errors.

Also `eslint.config.cjs` ignores `old-jet-caporal.js`, which does not exist —
the real file is `jet.caporal.backup`, already covered by the `*.backup` entry.
Stale, safe to drop.

---

## 9. Typo in a peer-classification warning

**Severity:** trivial
**Where it belongs:** opportunistic

`api/utils.js:219` — `'cound find peer record for'` should be
`'could not find peer record for'`.
