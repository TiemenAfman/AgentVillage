// The animals' door in the hull (lib/animalbundle.mjs): the islander packs forgivingly, the
// sea parses strictly, and what the one makes the other takes unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packAnimals, parseAnimals, MAX_ANIMAL_BYTES, MAX_TRACES } from '../lib/animalbundle.mjs';
import { MAX_ANIMALS } from '../shared/animals.mjs';

const HALF = 32;

const good = () => ({
  v: 1, seq: 42, gen: 3,
  animals: [
    { id: 'animal:1', species: 'chicken', name: 'Pip', traits: ['bold', 'curious'], home: [1.5, -2.25], r: 0.9,
      about: 'A bold hen who keeps to Slate Mill\'s doorstep.', friends: [{ who: 'house:s3', label: 'bonded' }] },
    { id: 'animal:2', species: 'goat', name: 'Bram', traits: ['stubborn'], home: [-4, 6], r: 1.4, about: null, friends: [] },
  ],
  actions: [
    { id: 'act:57:0', animal: 'animal:1', act: 'peck', dur: 14, to: [3, -1], look: [3.5, -1] },
    { id: 'act:57:1', animal: 'animal:2', act: 'nudge', dur: 8, to: [-2, 5], look: null },
  ],
  traces: [
    { id: 'trace:nest:animal:1', kind: 'nest', x: 2, z: -2, rot: 1, name: 'Pip\'s nest by Slate Mill\'s door', at: 1790000000000 },
  ],
});

const refused = (body, why) => assert.throws(() => parseAnimals(body, { half: HALF }), (e) => e.status === 400, why);

test('a good herd is taken as it is', () => {
  const body = good();
  assert.deepEqual(parseAnimals(body, { half: HALF }), body);
});

test('what the islander packs is exactly what the sea takes', () => {
  const messy = {
    v: 1, seq: 7, gen: 2,
    animals: [
      // Out of order, a stray field, a trait twice and one nobody has, a name with an invisible
      // character, a bell and a wide gap in it, a home off the island, a patch too big and no friends list at all.
      { id: 'animal:3', species: 'sparrow', name: '  Tjilp   the\u200b bird\u0007 ', traits: ['vain', 'vain', 'wise'], home: [99, -99], r: 9, stray: true },
      { id: 'animal:1', species: 'chicken', name: 'Pip', traits: [], home: [0, 0], about: 'x'.repeat(400),
        friends: [{ who: 'house:s1', label: 'bonded' }, { who: 'house:3f2a9c1e-1234-4567-89ab-0123456789ab', label: 'bonded' },
          { who: 'house:s2', label: 'besties' }, { who: 'house:s1', label: 'nemesis' }, { who: 'house:s4' }, { who: 'house:s5' }, { who: 'house:s6' }] },
      { id: 'cow:1', species: 'cow', name: 'Bessie', traits: ['bold'], home: [0, 0], r: 1 },
      { id: 'animal:1', species: 'goat', name: 'Twin', traits: ['bold'], home: [0, 0], r: 1 },
    ],
    actions: [
      { id: 'act:1:1', animal: 'animal:1', act: 'peck', dur: 500, to: [40, 0] },
      { id: 'act:1:0', animal: 'animal:1', act: 'dust', dur: 0.2, to: [1, 1], look: 'there' },
      { id: 'act:1:2', animal: 'animal:9', act: 'peck', dur: 5, to: [1, 1] },
      { id: 'act:1:3', animal: 'animal:3', act: 'dance', dur: 5, to: [1, 1] },
    ],
    traces: Array.from({ length: 40 }, (_, i) => ({ id: `trace:find:lamp:${i}`, kind: 'find', x: i, z: -i, rot: -1, name: `Find ${i}`, at: 1000 + i })),
  };
  const packed = packAnimals(messy, { half: HALF });
  assert.deepEqual(parseAnimals(packed, { half: HALF }), packed, 'the sea refused or changed what the islander packed');

  assert.deepEqual(packed.animals.map((a) => a.id), ['animal:1', 'animal:3']);
  const [pip, tjilp] = packed.animals;
  assert.equal(tjilp.name, 'Tjilp the bird');
  assert.deepEqual(tjilp.traits, ['vain']);
  assert.deepEqual(tjilp.home, [HALF, -HALF]);
  assert.equal(tjilp.r, 4);
  assert.deepEqual(tjilp.friends, []);
  assert.deepEqual(pip.traits, ['curious'], 'a hen with no traits was not given the gentlest one');
  assert.equal(pip.r, 0.9);
  assert.equal(pip.about.length, 160);
  assert.deepEqual(pip.friends.map((f) => f.who), ['house:s1', 'house:s2', 'house:s4', 'house:s5']);
  assert.equal(pip.friends[1].label, 'tolerant');

  assert.deepEqual(packed.actions, [{ id: 'act:1:0', animal: 'animal:1', act: 'dust', dur: 1, to: [1, 1], look: null }]);
  assert.equal(packed.traces.length, MAX_TRACES);
  assert.ok(packed.traces.every((t) => t.rot === 3 && t.at >= 1008), 'the newest marks were not the ones kept');
});

test('the packer keeps a herd under the door\'s ceiling', () => {
  const traces = Array.from({ length: 32 }, (_, i) => ({ id: `trace:print:lamp:${i}`, kind: 'print', x: 0, z: 0, rot: 0, name: 'n'.repeat(120), at: i }));
  const animals = Array.from({ length: 6 }, (_, i) => ({ id: `animal:${i + 1}`, species: 'goat', name: 'g'.repeat(24), traits: ['bold', 'curious', 'greedy'],
    home: [0, 0], r: 1, about: 'a'.repeat(160), friends: Array.from({ length: 4 }, (_, k) => ({ who: `house:s${k}${'9'.repeat(30)}`, label: 'nemesis' })) }));
  const packed = packAnimals({ seq: 1, animals, traces }, { half: HALF });
  assert.ok(JSON.stringify(packed).length <= MAX_ANIMAL_BYTES);
  assert.deepEqual(parseAnimals(packed, { half: HALF }), packed);
});

test('the sea refuses the lot for anything that did not come out of the packer', () => {
  const with_ = (fn) => { const b = good(); fn(b); return b; };
  refused(with_((b) => { b.note = 'hello'; }), 'an unknown field on the body');
  refused(with_((b) => { b.animals[0].colour = 'red'; }), 'an unknown field on an animal');
  refused(with_((b) => { b.actions[0].speed = 3; }), 'an unknown field on an action');
  refused(with_((b) => { b.traces[0].size = 3; }), 'an unknown field on a trace');
  refused(with_((b) => { b.animals[0].friends[0].since = 1; }), 'an unknown field on a friend');
  refused(with_((b) => { b.v = 2; }), 'another version');
  refused(with_((b) => { b.animals[1].id = 'animal:1'; b.actions.pop(); }), 'a duplicate animal');
  refused(with_((b) => { b.actions[1].id = 'act:57:0'; }), 'a duplicate action');
  refused(with_((b) => { b.traces.push({ ...b.traces[0] }); }), 'a duplicate trace');
  refused(with_((b) => { b.actions[1].animal = 'animal:1'; }), 'two actions for one animal');
  refused(with_((b) => { b.actions[0].animal = 'animal:7'; }), 'an action for an animal not in the herd');
  refused(with_((b) => { b.animals[0].name = 7; }), 'a number where a word belongs');
  refused(with_((b) => { b.animals[0].species = 'cow'; }), 'a species with no story');
  refused(with_((b) => { b.animals[0].traits = ['wise']; }), 'a trait nobody has');
  refused(with_((b) => { b.animals[0].traits = []; }), 'no traits');
  refused(with_((b) => { b.animals[0].traits = ['bold', 'bold']; }), 'a trait twice');
  refused(with_((b) => { b.animals[0].traits = ['bold', 'curious', 'greedy', 'vain']; }), 'four traits');
  refused(with_((b) => { b.animals[0].home = [HALF + 0.5, 0]; }), 'a home off the island');
  refused(with_((b) => { b.actions[0].to = [0, -HALF - 1]; }), 'an errand off the island');
  refused(with_((b) => { b.traces[0].x = 99; }), 'a trace off the island');
  refused(with_((b) => { b.animals[0].r = 0.1; }), 'a patch too small');
  refused(with_((b) => { b.actions[0].dur = 121; }), 'an errand too long');
  refused(with_((b) => { b.actions[0].act = 'dance'; }), 'an act nobody draws');
  refused(with_((b) => { b.traces[0].kind = 'statue'; }), 'a trace kind nobody draws');
  refused(with_((b) => { b.traces[0].rot = 1.5; }), 'half a turn');
  refused(with_((b) => { b.animals[0].name = 'Pip\u0007'; }), 'a control character in a name');
  refused(with_((b) => { b.animals[0].name = 'x'.repeat(25); }), 'a name too long');
  refused(with_((b) => { b.animals[0].about = 'x'.repeat(161); }), 'too much said about her');
  refused(with_((b) => { b.animals[0].friends[0].who = 'house:3f2a9c1e-1234-4567-89ab-0123456789ab'; }), 'a friend under a real id');
  refused(with_((b) => { b.animals[0].friends = Array.from({ length: 5 }, (_, i) => ({ who: `house:s${i}`, label: 'bonded' })); }), 'five friends');
  refused(with_((b) => { b.animals[0].id = 'animal:100'; }), 'an animal id that is not one');
  refused(with_((b) => { b.actions[0].id = 'act:57'; }), 'an action id that is not one');
  refused(with_((b) => { b.traces[0].id = 'trace:Nest'; }), 'a trace id that is not one');
  refused(with_((b) => { b.seq = '42'; }), 'a sequence written as text');
  refused(with_((b) => { b.gen = -1; }), 'a generation below zero');
  refused(with_((b) => { b.animals = { 'animal:1': b.animals[0] }; }), 'animals that are not a list');
  refused(with_((b) => {
    b.animals = Array.from({ length: MAX_ANIMALS + 1 }, (_, i) => ({ ...b.animals[1], id: `animal:${i + 1}` }));
    b.actions = [];
  }), 'one animal too many');
  refused(with_((b) => { b.traces = Array.from({ length: MAX_TRACES + 1 }, (_, i) => ({ ...b.traces[0], id: `trace:nest:n${i}` })); }), 'one trace too many');
  refused(JSON.parse('{"v":1,"seq":1,"gen":1,"animals":[],"actions":[],"traces":[],"__proto__":{"x":1}}'), 'a prototype key');
  refused('herd', 'not an object');
  assert.throws(() => parseAnimals(good(), {}), 'no island to measure against');
});

test('the door\'s parser reaches for nothing the sea may not have', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../lib/animalbundle.mjs', import.meta.url)), 'utf8');
  const imports = [...src.matchAll(/^import .*from '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../shared/animals.mjs']);
});
