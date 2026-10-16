# MealJot tools 1.0.0 — Muse integration

Free, local Node 22+ executable tools; no hosted API or paid infrastructure.
The same JS suggestion composition, filtering, row identities and append
mutations run in MealJot's Simple/Advanced UI and these tools. Agents read and
conditionally write Microsoft Graph directly, **not a desktop sync folder**.

**Muse's verified transport:** Node and stdio MCP work, but its credential broker
cannot inject tokens into a child process without model exposure. For Muse use
the **tokenless broker mode below**, not `MEALJOT_ACCESS_TOKEN` or device code.
Muse's existing connector still needs least-privilege rescoping and verified
Food Tracker AppFolder routing. Software deployment does not resolve that.

## Install a pinned artifact

Release:
https://github.com/shivbijlani/food-tracker/releases/tag/mealjot-tools-v1.0.0

Download `mealjot-tools-1.0.0.tgz` and its `.sha256` asset from that release.
Verify the SHA-256 against the published digest **before** extracting/installing.
The same version is also served at https://mealjot.com/tools/mealjot-tools-1.0.0.tgz
with `version.json` and a `.sha256` sidecar in that directory.

```powershell
$base = 'https://github.com/shivbijlani/food-tracker/releases/download/mealjot-tools-v1.0.0'
Invoke-WebRequest "$base/mealjot-tools-1.0.0.tgz" -OutFile mealjot-tools-1.0.0.tgz
Invoke-WebRequest "$base/mealjot-tools-1.0.0.tgz.sha256" -OutFile mealjot-tools-1.0.0.tgz.sha256
$expected = (Get-Content mealjot-tools-1.0.0.tgz.sha256).Split(' ')[0]
if ((Get-FileHash mealjot-tools-1.0.0.tgz -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Checksum mismatch' }
tar -xzf mealjot-tools-1.0.0.tgz
node .\package\bin\mealjot.js --version
node .\package\bin\mealjot.js mcp
```

No `npm install` is required: the archive includes its entire runtime dependency
closure and has no npm dependencies. Alternatively install the **verified local
archive** using `npm install -g .\mealjot-tools-1.0.0.tgz`, then run `mealjot mcp`.
Do not use an unpinned `npx` command.

MCP configuration (adjust the absolute executable path):

```json
{
  "mcpServers": {
    "mealjot": {
      "command": "node",
      "args": ["C:\\tools\\mealjot-1.0.0\\package\\bin\\mealjot.js", "mcp"]
    }
  }
}
```

The host's **secure token broker** injects `MEALJOT_ACCESS_TOKEN` into this process
environment at launch; do not put a token literal in this configuration. The
executable captures it in memory and deletes the environment variable. It never
writes access/refresh tokens to disk, prints them, or accepts them in tool
arguments, CLI flags, or prompts. Broker mode requires a new process/token when
the token expires. The CLI returns JSON to stdout and redacted errors to stderr;
MCP uses newline-delimited JSON-RPC on stdio, with tool errors marked `isError`.
No HTTP server or unauthenticated public write endpoint is installed.

## Sign-in prerequisites — not enabled by deployment

Use delegated Microsoft Graph authorization issued for **Food Tracker's**
client ID `94f25f67-e08b-415e-b1aa-4159093d401d`, scope
`Files.ReadWrite.AppFolder offline_access`. This reaches the app's
`Apps/MealJot Food Tracker/` folder in the signed-in user's OneDrive.
An AppFolder token issued for Muse's own registration reaches **Muse's different
app folder**, not Food Tracker's files. Do not request `Files.ReadWrite.All`.
The token broker is responsible for authenticating the intended account and
registration; the tools cannot verify issuer-client provenance for opaque Graph
tokens. A successful read of an empty catalog does not prove correct routing.
Confirm a known saved food/recipe before enabling writes.

The existing Food Tracker registration is a SPA. Native device-code flow may
require an administrator-approved public-client setting; deployment does not
change that setting or grant consent. With that approval and explicit user
authorization for sign-in, `node .\package\bin\mealjot.js mcp --device-code` prints
the verification URL/user code to stderr, signs in, and refreshes tokens in
memory for the lifetime of the process. No credential cache is created. An
unavailable device flow fails explicitly. The current SPA redirect registrations
do not establish native loopback support; none is assumed or added here.
Muse's connector configuration and sign-in must still be completed in Muse.

## Tokenless Muse broker transport (recommended for Muse)

```powershell
node .\package\bin\mealjot.js mcp --broker
# Or one-shot JSON on stdin:
Get-Content .\snapshot-request.json -Raw | node .\package\bin\mealjot.js plan
```

Use the same MCP configuration above with `args` ending in `"mcp", "--broker"`;
**no token environment variables**. Broker MCP exposes `mealjot_plan` and the
one-shot CLI exposes `plan`. Both accept:

```json
{
  "tool": "prepare_food_log",
  "arguments": { "items": ["yogurt"], "mode": "advanced" },
  "snapshots": {}
}
```

This runs the same underlying three food tools, without making network requests.
The result is a transport state, **never an unverified claim that food was saved**:

- `read_required`: Fetch only the listed Graph metadata and content through
  Muse's allowed-host HTTPS egress with **broker-substituted Authorization**.
  No token/surrogate is passed to Node, the model, prompts, output or a cache.
  Check ID/eTag again after downloading; a changed pair needs a fresh read.
  Do not forward bearer Authorization to the preauthenticated download URL.
  Supply `snapshots[filename] = { "content": "...", "id": "...", "etag": "..." }`;
  only a confirmed 404 becomes `{ "content": null, "id": null, "etag": null }`.
  Repeat the same plan call with those snapshots.
- `read_complete`: This contains the preparation or get-day result. Choose foods
  using the suggestion-first contract below. For commit, supply the unchanged
  preparation in `arguments` and fresh monthly/catalog snapshots.
- `write_required`: Execute only the returned HTTPS request using secret-hidden
  header substitution. It includes the entire new markdown body and `If-Match`
  for updates; creates use `If-None-Match: *` (Muse's broker reported enforcing
  this create condition). If the broker/Graph path does not enforce create-only
  semantics, **do not write**; use the direct adapter's conflict-fail reservation
  instead. Never strip the precondition or fall back to unconditional PUT.
- `already_applied`: The supplied fresh monthly snapshot contains the matching
  durable operation receipt. Only this commit state is evidence that the log
  action was applied; a same-ID/different-input receipt fails explicitly.

On 412, discard **all** snapshots and read again, then rerun the exact commit
operation. Do not replay the old body. After 200/201 or a network uncertainty,
also discard/read/replan to verify the receipt; an ambiguous response is not
success. Limit orchestration to five attempts, then show an explicit contention
error. On 401/403 stop for approved reconnect/rescoping; no blind delayed retry
or silent scope expansion. The planner validates dates, choices, catalog
revision and operation fingerprints identically to the direct adapter.

This tokenless plan is not a generic HTTP proxy: only the three food operations
and Food Tracker catalog/monthly filenames are supported. It requires the
broker to read the intended files and enforce the returned HTTP preconditions.
`special/approot` is relative to the token's registration, so an own-registration
Muse token—even with broad `Files.ReadWrite.All`—does **not** establish correct
Food Tracker AppFolder targeting. Least-privilege connector authentication and
correct target routing remain prerequisites; do not enable real writes until
those are demonstrated. Device-code is disabled for the existing registration
and enabling it alone would not solve Muse's process-injection limitation.

## Suggestion-first contract

1. Call `prepare_food_log` with `items` (one concise food search term per item)
   and `mode` (`advanced` or `simple`, default advanced). It is read-only and
   returns canonical names, saved nutrition, source references and a catalog
   revision. Search alternate terms if the first search misses; matching is the
   same case-insensitive substring filter as UI autocomplete (up to 30 options).
   Recipe nutrition is whole-recipe total divided by servings; portions and
   virtual halves follow the corresponding UI mode.
2. Call `commit_food_log` with the **entire preparation result**, date, meal,
   one selection per item and stable operation ID. Each selection uses
   `{ "optionId": "...", "quantity": 1 }`. Quantity multiplies the **selected
   portion**: quantity 2 of "Half yogurt" equals one original yogurt portion.
   Only match the correct food, not a vaguely related option to fill a result.
3. Call `get_day` to confirm entries and totals. Each nutrition total reports
   `known`, `unknownEntries` and `complete`; unknown is never presented as a
   known zero.

For a genuinely new food, first check `savedFoods` in the preparation (the
user's whole saved catalog, sent so the model can see every saved food, not
only text matches). If one is the same food, select its `optionId` and scale
`quantity` (e.g. "1.5oz chicken" with saved "1oz Rotisserie chicken" → 1.5).
Otherwise estimate the nutrition yourself — the calling model is the
estimator, calibrating against similar `savedFoods` — and explicitly select:

```json
{ "quantity": 1, "newFood": { "name": "1.5oz chicken in butter chicken", "nutritionStatus": "estimated", "nutrition": { "protein_g": 11 } } }
```

`nutrition.protein_g` is required for every new food; use
`nutritionStatus: "provided"` only when the user gave the numbers. A blank
protein would silently undercount the day, so the tool rejects it and asks the
caller to estimate and retry. Other fields may stay blank. Estimates are labeled in Notes. Saved-option nutrition is always
reloaded from the catalog, never trusted from model-supplied preparation values.
New foods are logged but **not automatically added to suggestions.csv**: this
avoids silently changing catalog nutrition or claiming a multi-file transaction.
The app retains its existing deliberate suggestion-upsert behavior on UI saves.

CLI calls take the same JSON on stdin:

```powershell
'{"items":["yogurt"],"mode":"advanced"}' | node .\package\bin\mealjot.js prepare_food_log
'{"date":"2026-10-12","mode":"advanced"}' | node .\package\bin\mealjot.js get_day
Get-Content .\commit-request.json -Raw | node .\package\bin\mealjot.js commit_food_log
```

Do not keep private food logs in shared prompt history or public scratch files.

## Retry, concurrency and compatibility

Use `operationId: "advanced:2026-10-12:<UUID>"` (or `simple:...`) once per intended
user log action and reuse it unchanged on retries. Prefix binds it to mode/date,
so reusing the same full ID with a different date/mode is rejected. The request
fingerprint and result receipt are stored atomically with the rows in that
month's markdown frontmatter. Same operation/request returns `duplicate: true`;
changed selections/date/meal return `OPERATION_CONFLICT` or `INVALID_INPUT`.
Receipts survive UI edits/deletion; retries do not resurrect deleted food.

Writes use a fresh item ID/eTag and `If-Match`. On 412 the operation re-reads and
reapplies against current entries, preserving concurrent additions. A missing
monthly file is created with a create-only upload (Graph `conflictBehavior=fail`);
if another writer created it first, the 409 triggers the same re-read and merge.
Repeated contention fails explicitly; retry with the same operation ID.
Catalog revisions are checked before resolving choices and immediately before
the log write. `STALE_PREPARATION` requires another lookup and reviewed choices.
Graph has no transaction across recipes, suggestions and the log; a catalog
change after the final check cannot be locked atomically, but the exact selected
nutrition snapshot is recorded and saved catalog nutrition is never modified.

Legacy rows get deterministic content-plus-occurrence IDs **in memory** on reads;
no read-only tool performs a migration write. New rows get stable IDs and UI
writes preserve them. OneDrive UI log sync uses a shared three-way merge and
conditional writes so offline UI edits do not overwrite agent-added rows.
Conflicting edits to the same row stop sync explicitly instead of silently
winning. Existing non-log files and Google Drive sync keep their prior behavior.
Do not erase `foodOperations` metadata or use older app versions to write these
logs: external editors/older software that remove receipts lose retry protection.

## Muse readiness check (no real writes)

After deploying the software, wire the MCP executable and secure token broker
in Muse, complete the approved sign-in, and verify `tools/list` exposes
`prepare_food_log`, `commit_food_log`, `get_day`. Call only
`prepare_food_log` for a **known existing food** and check its canonical name,
nutrition and source against MealJot. This confirms the correct AppFolder/account.
Do not create real food entries as an integration test.

For synthetic-only retry/concurrency checks, use the already verified/extracted
release archive (no dependencies or token required):

```powershell
node --test .\package\test\tools.node.mjs
```

This uses in-memory synthetic Graph responses, including a forced 412 with a
concurrent row, duplicate operation IDs, stale catalogs, both modes, and actual
CLI/MCP subprocesses. It never signs in or writes any user's OneDrive. A live
scratch-folder test requires separate explicit approval and a suitable test
account/registration; it is not part of deployment or these tests.

For the real UI/service-worker mock check, start `npm run dev -- --port 5197`,
then run `node scripts/e2e-food-tools.mjs http://localhost:5197`. This uses isolated
headless Edge profiles and synthetic Graph, verifies both modes and stable IDs,
and forces a 412 during OneDrive UI sync. No live Microsoft requests are needed.
