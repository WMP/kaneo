import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BASELINE_LAST_TAG,
  DEFAULT_JOURNAL,
  findOutOfOrder,
  findStaleIncoming,
  formatReport,
} from "./check-migration-order.mjs";

const script = new URL("./check-migration-order.mjs", import.meta.url).pathname;
const entry = (idx, tag, when) => ({
  idx,
  version: "7",
  when,
  tag,
  breakpoints: true,
});
const at = (iso) => Date.parse(iso);

const ordered = [
  entry(0, "0000_a", at("2026-09-01T00:00:00Z")),
  entry(1, "0001_b", at("2026-09-02T00:00:00Z")),
  entry(2, "0002_c", at("2026-09-03T00:00:00Z")),
];

test("an ordered journal passes", () => {
  assert.deepEqual(findOutOfOrder(ordered, "0000_a"), []);
  assert.deepEqual(findOutOfOrder([], "0000_a"), []);
});

test("an entry older than an earlier entry is reported with that entry", () => {
  const journal = [
    ...ordered,
    entry(3, "0003_late", at("2026-09-02T12:00:00Z")),
    entry(4, "0004_ok", at("2026-09-04T00:00:00Z")),
  ];
  const violations = findOutOfOrder(journal, "0000_a");
  assert.deepEqual(
    violations.map((v) => [v.entry.tag, v.newest.tag]),
    [["0003_late", "0002_c"]],
  );
  const report = formatReport({ outOfOrder: violations });
  assert.match(report, /0003_late/);
  assert.match(report, /0002_c/);
  assert.match(report, /re-stamp/);
  assert.match(report, /re-issue/);
});

test("an equal timestamp is skipped by drizzle too and is reported", () => {
  const journal = [...ordered, entry(3, "0003_same", ordered[2].when)];
  assert.deepEqual(
    findOutOfOrder(journal, "0000_a").map((v) => v.entry.tag),
    ["0003_same"],
  );
});

test("one old entry does not hide the following ones in running-max order", () => {
  const journal = [
    ...ordered,
    entry(3, "0003_late", at("2026-09-01T12:00:00Z")),
    entry(4, "0004_late", at("2026-09-02T12:00:00Z")),
  ];
  assert.deepEqual(
    findOutOfOrder(journal, "0000_a").map((v) => v.entry.tag),
    ["0003_late", "0004_late"],
  );
});

test("entries up to the baseline tag are exempt but still raise the maximum", () => {
  const journal = [
    entry(0, "0000_a", at("2026-09-05T00:00:00Z")),
    entry(1, "0001_b", at("2026-09-01T00:00:00Z")),
    entry(2, "0002_c", at("2026-09-03T00:00:00Z")),
  ];
  assert.deepEqual(
    findOutOfOrder(journal, "0001_b").map((v) => v.entry.tag),
    ["0002_c"],
  );
  assert.deepEqual(
    findOutOfOrder(
      [...journal, entry(3, "0003_d", at("2026-09-06T00:00:00Z"))],
      "0002_c",
    ),
    [],
  );
});

test("an incoming migration older than our newest one is reported", () => {
  // Upstream 0054_backfill_instance_admin (2026-09-26 15:53) against this
  // fork's 0051_ganttpro_additions (2026-09-28 05:07).
  const current = [
    entry(51, "0051_ganttpro_additions", at("2026-09-28T05:07:42Z")),
    entry(52, "0052_ganttpro_x", at("2026-09-30T20:07:21Z")),
  ];
  const incoming = [
    entry(51, "0051_ganttpro_additions", at("2026-09-28T05:07:42Z")),
    entry(54, "0054_backfill_instance_admin", at("2026-09-26T15:53:00Z")),
    entry(55, "0055_huge_sue_storm", at("2026-09-30T10:23:00Z")),
    entry(56, "0056_newer", at("2026-10-02T10:23:00Z")),
  ];
  const stale = findStaleIncoming(current, incoming);
  assert.deepEqual(
    stale.map((v) => v.entry.tag),
    ["0054_backfill_instance_admin", "0055_huge_sue_storm"],
  );
  assert.deepEqual(findStaleIncoming(current, current), []);
  assert.match(formatReport({ staleIncoming: stale }), /incoming 0054_/);
});

test("malformed journals are rejected", () => {
  assert.throws(() => findOutOfOrder([{ tag: "x" }]), /numeric/);
  assert.throws(() => findOutOfOrder(null), /array/);
});

test("the repository journal is ordered after the upstream baseline", () => {
  const { entries } = JSON.parse(readFileSync(DEFAULT_JOURNAL, "utf8"));
  assert.ok(entries.some((e) => e.tag === BASELINE_LAST_TAG));
  assert.deepEqual(findOutOfOrder(entries), []);
});

test("the command line exits non-zero for a bad journal and zero for the repository journal", () => {
  const dir = mkdtempSync(join(tmpdir(), "migration-order-"));
  const bad = join(dir, "bad.json");
  writeFileSync(
    bad,
    JSON.stringify({
      entries: [
        entry(0, BASELINE_LAST_TAG, at("2026-09-02T00:00:00Z")),
        entry(1, "0051_late", at("2026-09-01T00:00:00Z")),
      ],
    }),
  );
  const failed = spawnSync(process.execPath, [script, bad], {
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /0051_late/);

  const upstream = join(dir, "upstream.json");
  writeFileSync(
    upstream,
    JSON.stringify({
      entries: [
        entry(54, "0054_backfill_instance_admin", at("2026-09-26T15:53:00Z")),
      ],
    }),
  );
  const incoming = spawnSync(
    process.execPath,
    [script, DEFAULT_JOURNAL, "--incoming", upstream],
    { encoding: "utf8" },
  );
  assert.equal(incoming.status, 1);
  assert.match(incoming.stderr, /0054_backfill_instance_admin/);

  const out = execFileSync(process.execPath, [script, DEFAULT_JOURNAL], {
    encoding: "utf8",
  });
  assert.match(out, /Migration journal OK/);
});
