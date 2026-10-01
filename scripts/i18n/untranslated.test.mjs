import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectUntranslatedKeys,
  flattenLocale,
  loadLocales,
} from "./shared.mjs";
import {
  collectUntranslated,
  compareKeys,
  compareWithBaseline,
  readBaseline,
} from "./untranslated-baseline.mjs";

const script = path.join(import.meta.dirname, "untranslated.mjs");

// en-US plus two locales, small enough to read at a glance:
//   pl-PL  brand is left in English on purpose; tasks:count_few has no en-US
//          counterpart and still carries the _other wording.
//   de-DE  fully translated.
function enUS() {
  return {
    common: { save: "Save", cancel: "Cancel", brand: "Kaneo" },
    tasks: { count_one: "{{count}} task", count_other: "{{count}} tasks" },
  };
}

function plPL() {
  return {
    common: { save: "Zapisz", cancel: "Anuluj", brand: "Kaneo" },
    tasks: {
      count_one: "{{count}} zadanie",
      count_few: "{{count}} tasks",
      count_many: "{{count}} zadań",
      count_other: "{{count}} zadania",
    },
  };
}

function deDE() {
  return {
    common: { save: "Speichern", cancel: "Abbrechen", brand: "Kaneo (DE)" },
    tasks: {
      count_one: "{{count}} Aufgabe",
      count_other: "{{count}} Aufgaben",
    },
  };
}

const baselineOfFixture = {
  "de-DE": [],
  "pl-PL": ["common:brand", "tasks:count_few"],
};

// Locale files live in <root>/i18n and the baseline in <root>/baseline.json,
// mirroring the repository, where the baseline is not inside i18n/.
async function withFixture(
  run,
  { locales, baseline = baselineOfFixture } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kaneo-i18n-"));
  const dir = path.join(root, "i18n");
  const baselineFile = path.join(root, "baseline.json");

  try {
    await fs.mkdir(dir);
    const files = locales ?? {
      "en-US": enUS(),
      "pl-PL": plPL(),
      "de-DE": deDE(),
    };
    for (const [locale, data] of Object.entries(files)) {
      await writeLocale(dir, locale, data);
    }
    // Not a locale: the loader must skip it, as it does for the real schema.
    await fs.writeFile(path.join(dir, "schema.json"), "{}\n");
    if (baseline) {
      await fs.writeFile(baselineFile, JSON.stringify(baseline));
    }

    return await run({ root, dir, baselineFile });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeLocale(dir, locale, data) {
  await fs.writeFile(path.join(dir, `${locale}.json`), JSON.stringify(data));
}

async function editLocale(dir, locale, edit) {
  const file = path.join(dir, `${locale}.json`);
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  edit(data);
  await fs.writeFile(file, JSON.stringify(data));
}

function cli({ dir, baselineFile }, ...args) {
  const result = spawnSync(
    process.execPath,
    [script, ...args, "--dir", dir, "--baseline", baselineFile],
    { encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("an unchanged tree matches its baseline", async () => {
  await withFixture(async (fixture) => {
    const current = await collectUntranslated(fixture.dir);
    assert.deepEqual(current, baselineOfFixture);
    assert.ok(
      compareWithBaseline(current, baselineOfFixture).every(
        ({ added, stale }) => added.length === 0 && stale.length === 0,
      ),
    );

    const result = cli(fixture, "--check");
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /pl-PL: 2 untranslated, 0 new, 0 stale/);
    assert.match(result.stdout, /de-DE: 0 untranslated, 0 new, 0 stale/);
  });
});

test("a new English placeholder fails and names the locale and key", async () => {
  await withFixture(async (fixture) => {
    // What `pnpm i18n:check:fix` does: copy the English text into the locale.
    await editLocale(fixture.dir, "en-US", (data) => {
      data.common.archive = "Archive";
    });
    await editLocale(fixture.dir, "pl-PL", (data) => {
      data.common.archive = "Archive";
    });
    await editLocale(fixture.dir, "de-DE", (data) => {
      data.common.archive = "Archivieren";
    });

    const result = cli(fixture, "--check");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /pl-PL: 3 untranslated, 1 new, 0 stale/);
    assert.match(result.stdout, /de-DE: 0 untranslated, 0 new, 0 stale/);
    assert.match(
      result.stdout,
      /New untranslated keys[\s\S]*pl-PL:\s+- common:archive/,
    );
    assert.doesNotMatch(result.stdout, /Stale baseline entries/);
    assert.match(result.stdout, /pnpm i18n:untranslated:update/);
  });
});

test("a locale that is not in the baseline must ship translated", async () => {
  await withFixture(async (fixture) => {
    await writeLocale(fixture.dir, "fr-FR", enUS());

    const result = cli(fixture, "--check");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /fr-FR: 5 untranslated, 5 new, 0 stale/);
    assert.match(result.stdout, /fr-FR:\s+- common:brand\n\s+- common:cancel/);
  });
});

test("a baseline key that is now translated fails as stale", async () => {
  await withFixture(async (fixture) => {
    await editLocale(fixture.dir, "pl-PL", (data) => {
      data.common.brand = "Kaneo PL";
    });

    const result = cli(fixture, "--check");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /pl-PL: 1 untranslated, 0 new, 1 stale/);
    assert.match(
      result.stdout,
      /Stale baseline entries[\s\S]*pl-PL:\s+- common:brand/,
    );
    assert.doesNotMatch(result.stdout, /New untranslated keys/);
    assert.match(
      result.stdout,
      /only shrink[\s\S]*pnpm i18n:untranslated:update/,
    );
  });
});

test("a baseline key removed from en-US fails as stale", async () => {
  await withFixture(async (fixture) => {
    // Removed everywhere, as `pnpm i18n:report:fix` does.
    for (const locale of ["en-US", "pl-PL", "de-DE"]) {
      await editLocale(fixture.dir, locale, (data) => {
        delete data.common.brand;
      });
    }

    const result = cli(fixture, "--check");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /pl-PL: 1 untranslated, 0 new, 1 stale/);
    assert.match(
      result.stdout,
      /Stale baseline entries[\s\S]*pl-PL:\s+- common:brand/,
    );
  });
});

test("a key removed from en-US alone is stale, not a new placeholder", async () => {
  await withFixture(async (fixture) => {
    await editLocale(fixture.dir, "en-US", (data) => {
      delete data.common.brand;
    });

    const [pl] = compareWithBaseline(
      await collectUntranslated(fixture.dir),
      baselineOfFixture,
    ).filter(({ locale }) => locale === "pl-PL");
    assert.deepEqual(pl.added, []);
    assert.deepEqual(pl.stale, ["common:brand"]);
  });
});

test("a baseline locale without a locale file is stale", async () => {
  await withFixture(
    async (fixture) => {
      const result = cli(fixture, "--check");
      assert.equal(result.status, 1);
      assert.match(result.stdout, /fr-FR: 0 untranslated, 0 new, 1 stale/);
      assert.match(result.stdout, /fr-FR:\s+- common:brand/);
    },
    { baseline: { ...baselineOfFixture, "fr-FR": ["common:brand"] } },
  );
});

test("new and stale entries are both reported, with the update hint after translating", async () => {
  await withFixture(async (fixture) => {
    await editLocale(fixture.dir, "pl-PL", (data) => {
      data.common.brand = "Kaneo PL";
      data.common.cancel = "Cancel";
    });

    const result = cli(fixture, "--check");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /pl-PL: 2 untranslated, 1 new, 1 stale/);
    assert.match(result.stdout, /Once the new keys above are translated/);
  });
});

test("plural forms are judged like the existing report", async () => {
  await withFixture(async (fixture) => {
    const { locales, reference } = await loadLocales(fixture.dir);
    const pl = locales.find(({ locale }) => locale === "pl-PL");
    const expected = collectUntranslatedKeys(
      pl.data,
      reference.data,
      flattenLocale(reference.data),
    );
    const current = await collectUntranslated(fixture.dir);

    assert.deepEqual(current["pl-PL"], [...expected].sort(compareKeys));
    // _few has no en-US counterpart: it is compared with _other, so it counts.
    assert.ok(current["pl-PL"].includes("tasks:count_few"));
    // Translated plural forms do not.
    assert.ok(!current["pl-PL"].includes("tasks:count_many"));
    assert.ok(!current["pl-PL"].includes("tasks:count_other"));

    // Translating the locale-only form retires its baseline entry.
    await editLocale(fixture.dir, "pl-PL", (data) => {
      data.tasks.count_few = "{{count}} zadania";
    });
    let result = cli(fixture, "--check");
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /Stale baseline entries[\s\S]*pl-PL:\s+- tasks:count_few/,
    );

    // A new placeholder in another plural category is caught the same way.
    await editLocale(fixture.dir, "pl-PL", (data) => {
      data.tasks.count_few = "{{count}} zadania";
      data.tasks.count_many = "{{count}} tasks";
    });
    result = cli(fixture, "--check");
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /New untranslated keys[\s\S]*pl-PL:\s+- tasks:count_many/,
    );
  });
});

test("--update writes sorted locales and keys, then --check passes", async () => {
  await withFixture(
    async (fixture) => {
      // Insertion order is deliberately not alphabetical, and the code-unit
      // order differs from localeCompare ("Zeta" < "alpha", "a.b" < "a_b").
      const common = () => ({
        zeta: "Z",
        Zeta: "ZZ",
        alpha: "A",
        a: { b: "x" },
        a_b: "y",
      });
      await writeLocale(fixture.dir, "en-US", {
        common: common(),
        tasks: { count_one: "{{count}} task", count_other: "{{count}} tasks" },
      });
      await writeLocale(fixture.dir, "pl-PL", {
        common: common(),
        tasks: {
          count_one: "{{count}} task",
          count_few: "{{count}} tasks",
          count_other: "{{count}} tasks",
        },
      });
      await writeLocale(fixture.dir, "de-DE", {
        common: common(),
        tasks: { count_one: "{{count}} task", count_other: "{{count}} tasks" },
      });

      const result = cli(fixture, "--update");
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /2 locales, 15 untranslated keys/);

      const raw = await fs.readFile(fixture.baselineFile, "utf8");
      assert.ok(raw.endsWith("\n"));
      const written = JSON.parse(raw);

      assert.deepEqual(Object.keys(written), ["de-DE", "pl-PL"]);
      assert.deepEqual(written["pl-PL"], [
        "common:Zeta",
        "common:a.b",
        "common:a_b",
        "common:alpha",
        "common:zeta",
        "tasks:count_few",
        "tasks:count_one",
        "tasks:count_other",
      ]);
      assert.deepEqual(
        written["de-DE"],
        written["pl-PL"].filter((key) => key !== "tasks:count_few"),
      );

      assert.equal(cli(fixture, "--check").status, 0);
    },
    { baseline: null },
  );
});

test("--update shrinks the baseline when keys were translated", async () => {
  await withFixture(async (fixture) => {
    await editLocale(fixture.dir, "pl-PL", (data) => {
      data.common.brand = "Kaneo PL";
    });

    const result = cli(fixture, "--update");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pl-PL: \+0 accepted, -1 gone/);
    assert.doesNotMatch(result.stdout, /baseline grew/);
    assert.deepEqual(await readBaseline(fixture.baselineFile), {
      "de-DE": [],
      "pl-PL": ["tasks:count_few"],
    });
    assert.equal(cli(fixture, "--check").status, 0);
  });
});

test("--update accepts a new placeholder and says so", async () => {
  await withFixture(async (fixture) => {
    await editLocale(fixture.dir, "en-US", (data) => {
      data.common.archive = "Archive";
    });
    await editLocale(fixture.dir, "pl-PL", (data) => {
      data.common.archive = "Archive";
    });
    await editLocale(fixture.dir, "de-DE", (data) => {
      data.common.archive = "Archivieren";
    });

    const result = cli(fixture, "--update");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pl-PL: \+1 accepted, -0 gone/);
    assert.match(result.stdout, /baseline grew/);
    assert.ok(
      (await readBaseline(fixture.baselineFile))["pl-PL"].includes(
        "common:archive",
      ),
    );
  });
});

test("the plain report stays informational and ignores the baseline", async () => {
  await withFixture(async (fixture) => {
    await editLocale(fixture.dir, "pl-PL", (data) => {
      data.common.cancel = "Cancel";
    });

    const result = cli(fixture);
    assert.equal(result.status, 0);
    assert.equal(
      result.stdout,
      "de-DE: 0 untranslated\npl-PL: 3 untranslated\n",
    );

    const withKeys = cli(fixture, "--keys");
    assert.equal(withKeys.status, 0);
    assert.match(
      withKeys.stdout,
      /pl-PL: 3 untranslated\n {2}- common:brand\n {2}- common:cancel\n {2}- tasks:count_few\n/,
    );
  });
});

test("usage and baseline problems exit 2 instead of passing", async () => {
  await withFixture(async (fixture) => {
    assert.equal(cli(fixture, "--chek").status, 2);
    assert.equal(cli(fixture, "--check", "--update").status, 2);
    assert.equal(cli(fixture, "--check", "--keys").status, 2);

    await fs.writeFile(fixture.baselineFile, "{ not json");
    let result = cli(fixture, "--check");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not valid JSON/);

    await fs.writeFile(fixture.baselineFile, JSON.stringify({ "pl-PL": "x" }));
    result = cli(fixture, "--check");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /object of string arrays/);

    await fs.rm(fixture.baselineFile);
    result = cli(fixture, "--check");
    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /not found[\s\S]*pnpm i18n:untranslated:update/,
    );
  });
});
