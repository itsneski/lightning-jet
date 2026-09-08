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

## 2. Documented Node version does not match what the code needs — RESOLVED

**Resolved** on `chore/runtime-modernization`, together with the `engines`
bump, so the two agree. `README.md:27` now says 22.x+ to match
`engines: { node: ">=22" }` and `.nvmrc`. Retained below for context.

**Severity:** high — new users hit it on first run

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

---

## 10. `tools/genconfig` still writes the pre-umbrel-0.5 macaroon paths

**Severity:** high — every fresh host install starts broken
**Where it belongs:** its own branch, small

The umbrel path migration updated two of the three places that carry these
paths and missed the third:

| File | Path | Install route |
|---|---|---|
| `README.md` | `app-data/lightning/...` (new) | docs |
| `docker/genconfig.sh` | `app-data/lightning/...` (new) | Docker |
| **`tools/genconfig`** | **`/home/umbrel/umbrel/lnd/...` (old)** | **host** |

`tools/genconfig` is the host install path — it runs on `postinstall` and
generates `api/config.json`. So on umbrel 0.5+ a fresh host install writes a
config pointing at a macaroon that does not exist, while the README beside it
gives the correct path. The host route is the primary one, per the install
instructions.

Fix is to bring the two paths in `tools/genconfig` in line with
`docker/genconfig.sh`. Worth checking at the same time whether the two
generators should share a single source rather than duplicating the template.

---

## 11. Upgrade node-telegram-bot-api to 2.x to clear the last dependency criticals

**Severity:** medium — security debt
**Where it belongs:** its own branch, needs testing against a live bot

After `chore/runtime-modernization`, three critical advisories remain:
`form-data`, `request` and `tar`. The first two both come from
`@cypress/request`, which `node-telegram-bot-api@0.67.0` still depends on.
Bumping 0.66 to 0.67 does not move them — audited before and after, the result
is identical.

`node-telegram-bot-api@2.1.0` has **no dependencies at all**, so it drops the
chain entirely and would take criticals from 3 to 1, leaving only `tar` (via
`@mapbox/node-pre-gyp`, under `sqlite3`). It requires `node >= 18`, which the
new Node 22 baseline satisfies.

The catch is that 0.67 to 2.1.0 is a major version jump on the code path that
delivers every alert. The surface in use is small and contained - all of it in
`service/telegram.js`:

- `new TelegramBot(token, { polling: true })`
- `bot.onText(regex, handler)` x2
- `bot.sendMessage(chatId, msg)` x4, one with `{ parse_mode: 'HTML' }`

So the migration is likely small, but it must be verified against a live bot
before shipping: a silent break here means losing every notification, including
the ones that report that something else broke.

---

## 12. Retire `check:cli`, now subsumed by the help snapshot

**Severity:** low — redundant work, and a coverage gap while it stays
**Where it belongs:** opportunistic, small

`check:cli` is a hardcoded chain of `node jet <command> --help` calls. It lists
**22 of the 25 commands** — `start`, `stop` and `restart` were never added,
which is the drift a hardcoded list invites.

`test/cli-help-snapshot` now runs `--help` for every command *and* asserts the
output, and it discovers commands from the help output rather than a list, so
new commands are covered the moment they are registered. That makes `check:cli`
strictly redundant: it does less, on fewer commands, and both run on every
`npm run check`.

Left in place for now because removing it is a change to existing tooling
rather than part of adding the test. When retiring it, drop the script from
`package.json`, take it out of the `check` chain, and update the command list
in `CLAUDE.md`.

---

## 13. `describegraph.json` is not gitignored

**Severity:** trivial
**Where it belongs:** opportunistic, one line

`bos` writes a `describegraph.json` into the repo root when certain commands
run. It is not in `.gitignore`, so it shows up as untracked in `git status` and
is easy to commit by accident.

Not produced by the new CLI surface tests — those leave the tree clean. Adding
`describegraph.json` to `.gitignore` is the whole fix.
