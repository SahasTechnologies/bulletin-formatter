/**
 * The round-trip tests for a frame.
 *
 * A frame is written down by `lib/boxState.ts` and read back by `boxFromHistory`
 * (undo) and `buildBoxes`/`buildModel` (a saved document). Nothing about either
 * half looks wrong on its own, so the only way to catch a field that is written
 * but never read - or read but never written - is to push a frame that has
 * *every* field set through both doors and look at what comes out.
 *
 * That is exactly the bug this file was written for: the undo stack recorded a
 * frame's column rule before its rebuild could read it, and the rebuild learned
 * to read `align`/`css` before the stack had ever recorded them. Both halves
 * looked correct in isolation; a frame lost its rule on the next Ctrl+Z.
 *
 * Two guards, deliberately layered:
 *
 *  - `FRAME_FIELDS` in `lib/boxState.ts` is checked against `TextBox` by the
 *    TypeScript build, so a new frame field cannot be silently ignored.
 *  - this file checks that every one of those fields survives both round trips,
 *    so a new field cannot be listed and then dropped by a serializer.
 *
 * Run with `npm test`. The app modules are loaded through Vite (already a
 * dependency) rather than a test runner of its own, because the source uses
 * bundler-style extensionless imports and TypeScript - neither of which plain
 * Node reads on its own. Only `document.createElement` is needed by the code
 * under test, so the DOM is stubbed below instead of adding a browser
 * environment; see `installMeasureStub`.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

/**
 * The one DOM API the code under test reaches for.
 *
 * `buildBoxes` probes a text frame's markup to see whether it is really a lone
 * `<img>` left over from the old format (and promotes it to a picture box if so).
 * Reporting "not an image" is all this test needs, and it keeps the probe on the
 * path an ordinary text frame takes. Anything else - a real measurement host, or
 * the legacy re-split - would need a browser, so it is left to fail loudly here
 * rather than be quietly faked.
 */
globalThis.document = {
  createElement() {
    let html = '';
    return {
      get innerHTML() {
        return html;
      },
      set innerHTML(value) {
        html = value;
      },
      get firstElementChild() {
        return null;
      },
      get textContent() {
        return '';
      },
      children: [],
    };
  },
};

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});
after(() => server.close());

const { FRAME_FIELDS, boxFromHistory, historyStateOf, snapshotOfBox, storedBoxOf } =
  await server.ssrLoadModule('/src/lib/boxState.ts');
const { buildModel } = await server.ssrLoadModule('/src/lib/frames.ts');

/** A4 portrait, the page every bulletin is laid out for. */
const PAGE = { width: 794, height: 1123 };

/* ------------------------------------------------------------- fixtures -- */

/**
 * A text frame with every field a *text* frame carries set to a distinctive
 * value, so a dropped field shows up as a missing value rather than a
 * coincidence. No value matches a default the readers substitute, because a
 * reader that quietly substitutes a default is the other half of this bug.
 */
function textFrame(overrides = {}) {
  return {
    id: 'text-1',
    pageIndex: 2,
    x: 96,
    y: 240,
    w: 602,
    h: 707,
    html: '<p>Body copy that lives in this frame.</p>',
    nextId: null,
    columns: 2,
    rule: '#0000ff',
    ruleWidth: 5,
    align: 'justify',
    css: 'font-size:13pt;line-height:1.45',
    ...overrides,
  };
}

/** A picture (or any placed object) with every *object* field set. */
function objectFrame(overrides = {}) {
  return {
    id: 'object-1',
    pageIndex: 4,
    x: 120,
    y: 300,
    w: 400,
    h: 260,
    html: '',
    nextId: null,
    kind: 'image',
    src: 'asset:probe_1',
    pdfPage: 3,
    radius: 18,
    fade: 7,
    fit: 'contain',
    fill: '#f6efe4',
    stroke: '#2b2622',
    thickness: 3,
    ph: 'Click to add artwork',
    ...overrides,
  };
}

/**
 * Fields a *save* legitimately does not carry for a placed object.
 *
 * Typography has no meaning on a picture, and an object has no text of its own -
 * so the saved shape of an object is narrower than the saved shape of a text
 * frame, on purpose. The undo writer records one shape for every frame instead
 * (see `snapshotOfBox`), which is why the exception applies only to the save.
 */
const NOT_ON_A_SAVED_OBJECT = ['html', 'columns', 'rule', 'ruleWidth', 'align', 'css'];

/** Fields no round trip carries for a placed object: it has no text to carry. */
const NOT_ON_AN_OBJECT = ['html'];

/** The fields of a fixture that are actually set, as [name, value] pairs. */
function setFields(frame) {
  return Object.entries(frame).filter(([, value]) => value !== undefined && value !== null);
}

/** Round trip a frame the way a document is saved and reopened. */
function throughSave(frame) {
  const saved = JSON.stringify([storedBoxOf(frame, frame.html)]);
  return { saved: JSON.parse(saved)[0], reloaded: buildModel('', saved, PAGE)[0] };
}

/** Round trip a frame the way the undo stack does. */
function throughUndo(frame, liveHtml = frame.html) {
  const recorded = JSON.parse(historyStateOf([frame], () => liveHtml))[0];
  return { recorded, restored: recorded && boxFromHistory(recorded) };
}

/** Normalize away `undefined` keys, which is what both writers really store. */
const asJson = (value) => JSON.parse(JSON.stringify(value));

/* ------------------------------------------------------------ the guard -- */

test('the fixtures cover every field a frame must survive being written down', () => {
  const covered = new Set([
    ...Object.keys(textFrame()),
    ...Object.keys(objectFrame()),
  ]);
  const missing = FRAME_FIELDS.filter((field) => !covered.has(field));
  assert.deepEqual(
    missing,
    [],
    `FRAME_FIELDS lists fields no fixture sets, so nothing round-trips them: ${missing.join(', ')}`,
  );
  assert.equal(
    FRAME_FIELDS.length,
    new Set(FRAME_FIELDS).size,
    'FRAME_FIELDS must not repeat a field',
  );
  // The four that this file exists because of. If any leaves the list, the
  // tests below stop covering it.
  for (const field of ['rule', 'ruleWidth', 'align', 'css']) {
    assert.ok(FRAME_FIELDS.includes(field), `${field} must be a listed frame field`);
  }
});

/* ------------------------------------------------------------- the text -- */

test('a text frame keeps every field across a save and reload', () => {
  const frame = textFrame();
  const { reloaded } = throughSave(frame);

  assert.ok(reloaded, 'the saved frame came back at all');
  for (const [field, value] of setFields(frame)) {
    // A reload mints fresh ids so React remounts the frame; identity and the
    // links between frames are asserted separately below.
    if (field === 'id' || field === 'nextId') continue;
    assert.deepEqual(
      reloaded[field],
      value,
      `a reload lost “${field}”: saved ${JSON.stringify(value)}, got ${JSON.stringify(reloaded[field])}`,
    );
  }
  assert.notEqual(reloaded.id, frame.id, 'a reload mints fresh ids, by design');
});

test('a text frame keeps every field across an undo', () => {
  const frame = textFrame();
  const { restored } = throughUndo(frame);

  assert.ok(restored, 'the frame came back at all');
  for (const [field, value] of setFields(frame)) {
    assert.deepEqual(
      restored[field],
      value,
      `an undo lost “${field}”: recorded ${JSON.stringify(value)}, came back ${JSON.stringify(restored[field])}`,
    );
  }
  assert.equal(restored.id, frame.id, 'undo restores the same frames, so ids are kept');
});

/* ----------------------------------------------------------- the object -- */

test('a placed object keeps every field across a save and reload', () => {
  const frame = objectFrame();
  const { reloaded } = throughSave(frame);

  assert.ok(reloaded, 'the saved object came back at all');
  for (const [field, value] of setFields(frame)) {
    if (field === 'id' || field === 'nextId' || NOT_ON_A_SAVED_OBJECT.includes(field)) continue;
    assert.deepEqual(
      reloaded[field],
      value,
      `a reload lost the object's “${field}”`,
    );
  }
  assert.equal(reloaded.html, '', 'an object has no text of its own');
});

test('a placed object keeps every field across an undo', () => {
  const frame = objectFrame();
  const { restored } = throughUndo(frame, undefined);

  assert.ok(restored, 'the object came back at all');
  for (const [field, value] of setFields(frame)) {
    if (NOT_ON_AN_OBJECT.includes(field)) continue;
    assert.deepEqual(
      restored[field],
      value,
      `an undo lost the object's “${field}”`,
    );
  }
  assert.equal(restored.html, '', 'an object has no text of its own');
  assert.equal(restored.kind, 'image', 'and it is still the same kind of object');
});

/* ----------------------------------------------------------------- links -- */

test('a linked chain keeps its links across a save and reload', () => {
  const first = textFrame({ id: 'chain-a', nextId: 'chain-b' });
  const second = textFrame({ id: 'chain-b', pageIndex: 3, nextId: null });
  const saved = JSON.stringify([storedBoxOf(first, first.html), storedBoxOf(second, second.html)]);
  const reloaded = buildModel('', saved, PAGE);

  assert.equal(reloaded.length, 2, 'both frames came back');
  assert.ok(
    reloaded[0].nextId && reloaded[0].nextId === reloaded[1].id,
    'the chain still points at the remapped id of the frame it leads to',
  );
  assert.equal(reloaded[1].nextId, null, 'the end of the chain stays the end');
});

test('a chain whose link points nowhere does not invent one on reload', () => {
  const lone = textFrame({ id: 'chain-lone', nextId: 'gone-missing' });
  const reloaded = buildModel('', JSON.stringify([storedBoxOf(lone, lone.html)]), PAGE)[0];
  assert.equal(reloaded.nextId, null, 'a dangling link is dropped, not left dangling');
});

/* --------------------------------------------------- nothing invented -- */

test('a frame with no optional fields set does not gain any', () => {
  // The other half of the same bug: a reader that substitutes a default where
  // the writer had nothing turns "no column rule" into "the house rule" and "no
  // alignment" into an explicit one - which changes how the frame prints.
  const bare = {
    id: 'text-bare',
    pageIndex: 0,
    x: 140,
    y: 210,
    w: 400,
    h: 300,
    html: '<p>Plain copy.</p>',
    nextId: null,
  };
  const { saved, reloaded } = throughSave(bare);
  const { restored } = throughUndo(bare);

  for (const field of ['kind', 'src', 'columns', 'rule', 'ruleWidth', 'align', 'css', 'fit', 'ph']) {
    assert.equal(saved[field], undefined, `a save must not invent a “${field}”`);
    assert.equal(reloaded[field], undefined, `a reload must not invent a “${field}”`);
    assert.equal(restored[field], undefined, `an undo must not invent a “${field}”`);
  }
  assert.equal(reloaded.html, bare.html, 'and the copy is still the copy');
});

/* -------------------------------------------------- the writers agree -- */

test('the save writer and the undo writer record the same text frame', () => {
  // Not an accident to be tidied away: the two writers cover different ground
  // for pictures (typography is meaningless on a shape), but for a text frame
  // they describe the same thing. If one gains a field the other does not, the
  // saved document and its undo history start disagreeing about what it is.
  const frame = textFrame();
  const saved = asJson(storedBoxOf(frame, frame.html));
  const recorded = JSON.parse(historyStateOf([frame], () => frame.html))[0];

  assert.deepEqual(Object.keys(recorded).sort(), Object.keys(saved).sort());
  assert.deepEqual(recorded, saved);
});

test('the two writers agree on a placed object’s object fields', () => {
  const frame = objectFrame();
  const saved = asJson(storedBoxOf(frame, undefined));
  const recorded = asJson(snapshotOfBox(frame, () => undefined));

  for (const [field, value] of setFields(frame)) {
    assert.deepEqual(
      recorded[field],
      saved[field],
      `the writers disagree about the object's “${field}” (recorded ${JSON.stringify(recorded[field])}, saved ${JSON.stringify(saved[field])}, expected ${JSON.stringify(value)})`,
    );
  }
});

/* ------------------------------------------------------- the live DOM -- */

test('live DOM content wins over the stale seed, for both writers', () => {
  // A text frame's contentEditable contents are the truth while it is open;
  // `html` is only the seed it was built from. Recording the seed instead would
  // make both undo and reload jump back to the text the frame opened with.
  const frame = textFrame();
  const edited = '<h1>A headline the writer just typed</h1>';
  const savedLive = asJson(storedBoxOf(frame, edited));
  const recordedLive = JSON.parse(historyStateOf([frame], () => edited))[0];
  const savedSeed = asJson(storedBoxOf(frame));
  const recordedSeed = JSON.parse(historyStateOf([frame], () => undefined))[0];

  assert.equal(savedLive.html, edited, 'a save records what is on the sheet');
  assert.equal(recordedLive.html, edited, 'and so does an undo step');
  assert.equal(savedSeed.html, frame.html, 'with no live DOM the seed is the fallback');
  assert.equal(recordedSeed.html, frame.html, 'and it falls back the same way in both');
});
