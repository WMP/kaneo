import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The update-readme skill rewrites README.md regularly. These checks catch what
// a rewrite tends to break: links, anchors, screenshots and the baseline marker.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const skill = ".claude/skills/update-readme/SKILL.md";
const imageDirectory = "docs/images/kaneo-pro";
// Normalized line endings keep every line number equal to the editor's.
const readme = readFileSync(path.join(root, "README.md"), "utf8").replace(
  /\r\n?/g,
  "\n",
);

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

const decode = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// A failure lists every offender, so one run is enough to fix the README.
const assertNone = (offenders, problem) =>
  assert.ok(
    offenders.length === 0,
    `${problem} (see ${skill}):\n${offenders.join("\n")}`,
  );

// Code blocks and HTML comments can hold text that looks like a link or a
// heading but is neither on GitHub. scan() blanks them out, once for the text a
// reader sees and once for the comments. Only characters other than newlines
// are replaced, so offsets and line numbers still match the file.
const blank = (text) => text.replace(/[^\n]/g, " ");

// A fence is three or more backticks or tildes, also inside a blockquote. A
// backtick in the info string of a backtick fence means inline code instead.
const fenceOf = (line) => {
  const match = line.match(/^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})(.*)$/);
  if (!match || (match[1][0] === "`" && match[2].includes("`"))) return null;
  return { marker: match[1], info: match[2].trim() };
};

function scan(markdown) {
  const shown = [];
  const commented = [];
  const unclosed = [];
  let fence = null;
  let comment = 0; // line where the open comment started, 0 outside one

  for (const [index, line] of markdown.split("\n").entries()) {
    const number = index + 1;
    const found = fenceOf(line);
    // Inside a comment a fence marker is plain text, and so is "<!--" inside a
    // fence. The closing fence repeats the character, is at least as long and
    // carries no text.
    const opens = !fence && !comment && found;
    const closes =
      fence &&
      found &&
      !found.info &&
      found.marker[0] === fence.marker[0] &&
      found.marker.length >= fence.marker.length;
    if (fence || opens) {
      if (opens) fence = { marker: found.marker, line: number };
      if (closes) fence = null;
      shown.push(blank(line));
      commented.push(blank(line));
      continue;
    }

    let outside = "";
    let inside = "";
    let rest = line;
    while (rest !== "") {
      const edge = comment ? rest.indexOf("-->") : rest.indexOf("<!--");
      const length = edge === -1 ? rest.length : edge + (comment ? 3 : 0);
      const part = rest.slice(0, length);
      outside += comment ? blank(part) : part;
      inside += comment ? part : blank(part);
      if (edge !== -1) comment = comment ? 0 : number;
      rest = rest.slice(length);
    }
    shown.push(outside);
    commented.push(inside);
  }

  if (fence) {
    unclosed.push({ line: fence.line, what: "code fence is never closed" });
  }
  if (comment) {
    unclosed.push({ line: comment, what: "HTML comment is never closed" });
  }
  return {
    visible: shown.join("\n"),
    comments: commented.join("\n"),
    unclosed,
  };
}

// "](" finds a Markdown link or image whatever its text is. HTML links and
// images use the src and href attributes.
const targetPattern =
  /\]\(\s*(<[^>\n]*>|[^\s)]*)|(?<![\w-])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const targetsOf = (markdown) =>
  [...markdown.matchAll(targetPattern)].map((match) => ({
    line: lineOf(markdown, match.index),
    target: (match[1] ?? match[2] ?? match[3]).replace(/^<|>$/g, "").trim(),
  }));

const isExternal = (target) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);

// The repository path a relative target points to, or null when there is
// nothing to look up: an external URL, a pure "#anchor" or an empty target.
function repositoryPath(target) {
  if (isExternal(target)) return null;
  const file = decode(target.split("#")[0].split("?")[0]);
  // A leading slash counts from the repository root, never from the
  // filesystem root, so a link cannot make the test look at other files.
  return file ? path.posix.normalize(file.replace(/^\/+/, "")) : null;
}

const existsInRepository = (file) => {
  const resolved = path.resolve(root, file);
  return (
    (resolved === root || resolved.startsWith(`${root}${path.sep}`)) &&
    existsSync(resolved)
  );
};

// GitHub's anchor: lowercase, drop everything except letters, numbers, spaces,
// hyphens and underscores, then turn each space into a hyphen.
const slugify = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replaceAll(" ", "-");

// Anchors of the ATX headings in document order. A repeated heading gets -1,
// -2 and so on. A link inside a heading counts as its text only.
function anchorsOf(markdown) {
  const seen = new Map();
  return markdown.split("\n").flatMap((line) => {
    const match = line.match(
      /^[ \t]*(?:>[ \t]*)*#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/,
    );
    if (!match) return [];
    const slug = slugify(match[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"));
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    return [count === 0 ? slug : `${slug}-${count}`];
  });
}

const baselinePattern = /^readme-baseline: [0-9a-f]{7,40}(?![0-9A-Za-z])/;

const { visible, comments, unclosed } = scan(readme);
const targets = targetsOf(visible);

// Everything below ignores what scan() blanks out. An unclosed fence or comment
// would hide the rest of the README from these checks, and from GitHub as well.
test("README.md closes every code fence and HTML comment", () => {
  assertNone(
    unclosed.map(({ line, what }) => `README.md:${line} -> ${what}`),
    "README.md has an unclosed code fence or HTML comment that hides the rest of the file",
  );
});

// The README has no link inside a code block or a comment today, so without
// this check a broken ignore rule would only show up after a later edit.
test("link extraction reads Markdown and HTML targets and skips code and comments", () => {
  const sample = [
    "[one](one.md) ![two](two.png#x)",
    '<img src="three.png" alt="3" />',
    "```md",
    "[skipped](fenced.md) <!-- not a comment",
    "```",
    "<!-- [skipped](commented.md)",
    "```",
    "<img src='commented.png'> -->",
    '<a href="four.md?q=1">4</a> <!-- c --> [five](<five six.md> "Title")',
    "text [six]( six.md )",
  ].join("\n");
  const scanned = scan(sample);
  assert.deepEqual(scanned.unclosed, []);
  assert.deepEqual(targetsOf(scanned.visible), [
    { line: 1, target: "one.md" },
    { line: 1, target: "two.png#x" },
    { line: 2, target: "three.png" },
    { line: 9, target: "four.md?q=1" },
    { line: 9, target: "five six.md" },
    { line: 10, target: "six.md" },
  ]);
  assert.deepEqual(scan("a\n```\nb\n<!-- c").unclosed, [
    { line: 2, what: "code fence is never closed" },
  ]);
  assert.deepEqual(scan("a\n<!-- c\nb").unclosed, [
    { line: 2, what: "HTML comment is never closed" },
  ]);

  for (const external of [
    "https://example.com/a",
    "http://example.com",
    "mailto:me@example.com",
    "//example.com/a",
    "#top",
    "?page=2",
    "",
  ]) {
    assert.equal(repositoryPath(external), null, external);
  }
  assert.equal(repositoryPath("docs/a%20b.png?raw=1#frag"), "docs/a b.png");
  assert.equal(repositoryPath("./docs/../LICENSE"), "LICENSE");
  assert.equal(repositoryPath("/LICENSE"), "LICENSE");
  assert.ok(existsInRepository("README.md"));
  assert.ok(existsInRepository("docs"));
  assert.ok(!existsInRepository("missing-file.md"));
  assert.ok(!existsInRepository(".."), "a link must not leave the repository");
});

test("README.md links and images point to files that exist in the repository", () => {
  assertNone(
    targets.flatMap(({ line, target }) => {
      const file = repositoryPath(target);
      return file === null || existsInRepository(file)
        ? []
        : [`README.md:${line} -> ${target}`];
    }),
    "README.md links to files that do not exist",
  );
});

// A wrong slug function would make the anchor check below fail or pass for no
// reason, so its rules are pinned with known headings.
test("heading anchors follow GitHub's slug rules", () => {
  for (const [heading, slug] of Object.entries({
    "Kaneo vs Kaneo Pro": "kaneo-vs-kaneo-pro",
    "Upgrading from Kaneo": "upgrading-from-kaneo",
    "What's new?": "whats-new",
    "MCP for AI agents": "mcp-for-ai-agents",
    "Self-hosted_setup (v2)": "self-hosted_setup-v2",
    // Each space becomes a hyphen, also the one a removed symbol leaves behind.
    "Tom & Jerry": "tom--jerry",
    "Crème brûlée": "crème-brûlée",
  })) {
    assert.equal(slugify(heading), slug, heading);
  }

  const markdown = [
    "# Title",
    "## Usage",
    "```sh",
    "# comment, not a heading",
    "```",
    "<!-- ## Hidden -->",
    "## Usage ##",
    "### A [link](x.md) title",
    "### Usage",
    "#hashtag is not a heading",
  ].join("\n");
  assert.deepEqual(anchorsOf(scan(markdown).visible), [
    "title",
    "usage",
    "usage-1",
    "a-link-title",
    "usage-2",
  ]);
});

test("README.md in-page anchors match its headings", () => {
  const anchors = new Set(anchorsOf(visible));
  assert.ok(
    anchors.size > 0,
    `README.md has no headings to link to (see ${skill})`,
  );
  assertNone(
    targets.flatMap(({ line, target }) =>
      target.startsWith("#") && !anchors.has(decode(target.slice(1)))
        ? [`README.md:${line} -> ${target}`]
        : [],
    ),
    "README.md links to headings that do not exist",
  );
});

test("README.md uses every PNG in docs/images/kaneo-pro and each image it references exists", () => {
  const directory = path.join(root, imageDirectory);
  const pngs = (existsSync(directory) ? readdirSync(directory) : [])
    .filter((filename) => /\.png$/i.test(filename))
    .sort();
  // With an empty folder both checks below would pass without proving anything.
  assert.ok(
    pngs.length > 0,
    `${imageDirectory} holds no PNG screenshots (see ${skill})`,
  );

  const references = targets.flatMap(({ line, target }) => {
    const file = repositoryPath(target);
    return file?.startsWith(`${imageDirectory}/`)
      ? [{ line, target, file }]
      : [];
  });
  const used = new Set(references.map(({ file }) => file));
  assertNone(
    [
      ...pngs
        .filter((filename) => !used.has(`${imageDirectory}/${filename}`))
        .map(
          (filename) =>
            `${imageDirectory}/${filename} -> not used by README.md; reference it or delete it`,
        ),
      ...references
        .filter(({ file }) => !existsInRepository(file))
        .map(
          ({ line, target }) =>
            `README.md:${line} -> ${target} (the file does not exist)`,
        ),
    ],
    "README.md and its screenshots are out of step",
  );
});

// The skill reads the marker with sed, so a second or malformed one would break
// `git log "$base"..origin/main`. CI clones can be shallow, which is why only
// the format is checked and the commit is never resolved.
test("README.md has exactly one readme-baseline marker in an HTML comment", () => {
  for (const valid of [
    "readme-baseline: 0ecbbf7",
    `readme-baseline: ${"a".repeat(40)} -->`,
  ]) {
    assert.match(valid, baselinePattern);
  }
  for (const invalid of [
    "readme-baseline: 0ecbbf",
    `readme-baseline: ${"a".repeat(41)}`,
    "readme-baseline: 0ECBBF7",
    "readme-baseline: 0ecbbf7g",
    "readme-baseline: main",
    "readme-baseline:0ecbbf7",
  ]) {
    assert.doesNotMatch(invalid, baselinePattern);
  }

  const markers = [...readme.matchAll(/readme-baseline:[^\n]*/g)];
  const problems = markers.flatMap((marker) => {
    const where = `README.md:${lineOf(readme, marker.index)} -> ${marker[0].trim()}`;
    return [
      ...(baselinePattern.test(marker[0])
        ? []
        : [`${where} (expected 7 to 40 lowercase hex characters)`]),
      ...(comments.startsWith("readme-baseline:", marker.index)
        ? []
        : [`${where} (not inside an HTML comment)`]),
    ];
  });
  if (markers.length !== 1) {
    problems.unshift(
      `README.md -> expected exactly one readme-baseline marker, found ${markers.length}`,
    );
  }
  assertNone(problems, "README.md has a wrong readme-baseline marker");
});
