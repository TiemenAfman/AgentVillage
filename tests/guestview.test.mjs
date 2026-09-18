// What a visitor gets handed, and the one join in it that has to survive the redaction.
//
// A house carries `sheds`: a list of the *ids* of the apprentices standing in its yard,
// `shed:<session>:<agent>`. The apprentices are buildings of their own in the same list,
// and ui.js draws the yard's roll by looking each id up among them. So the ids have to
// come out of guestVillage() as ids - strings, still matching the shed's own `id` after
// both have had the session uuid renamed out of them. They were being spread into an
// object rest to strip fields a string does not have, which handed back the characters:
// sixty keys per shed, no id, and a roll that matched nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guestVillage } from '../lib/guestview.mjs';

const SESSION = '0aded9dd-965c-438d-a44f-462bf2829bc0';
const AGENT = 'a02a58fad9a49a61b';
const SHED = `shed:${SESSION}:${AGENT}`;
const ROOT = 'D:\\git\\Martijn\\AgentVillage';

// Cut down from a real village.json: one house with one apprentice in its yard, and the
// apprentice as a building beside it, the way lib/village.mjs writes them. A district id
// really is the lowercased path, which is why it is spelled out rather than made up.
function village() {
  return {
    generatedAt: 1,
    districts: [{ id: `p:${ROOT.toLowerCase()}`, root: ROOT, branches: ['claude/some-branch'] }],
    buildings: [
      {
        id: `house:${SESSION}`, sessionId: SESSION, kind: 'house',
        title: 'the opening prompt, verbatim', gitBranch: 'claude/some-branch',
        cwd: ROOT,
        sheds: [SHED],
      },
      {
        id: SHED, sessionId: SESSION, kind: 'shed',
        master: `house:${SESSION}`, agentType: 'Explore',
        title: 'Explore subagent', description: 'look something up',
      },
    ],
    assignments: [],
  };
}

const houseOf = (g) => g.buildings.find((b) => b.kind === 'house');
const shedOf = (g) => g.buildings.find((b) => b.kind === 'shed');

test('a shed id stays a string', () => {
  const house = houseOf(guestVillage(village()));
  assert.equal(house.sheds.length, 1);
  assert.equal(typeof house.sheds[0], 'string');
  // The shape the bug produced, spelled out so a reader knows what this is guarding
  // against: an id spread into an object comes back as its own characters.
  assert.notDeepEqual(house.sheds[0], { ...SHED });
});

test('a shed id still points at its shed after redaction', () => {
  const guest = guestVillage(village());
  const house = houseOf(guest);
  const shed = shedOf(guest);
  // The lookup ui.js does: every id in the yard has to find a building.
  const byId = new Map(guest.buildings.map((b) => [b.id, b]));
  assert.equal(byId.get(house.sheds[0]), shed);
});

test('a shed id is renamed rather than passed through', () => {
  const house = houseOf(guestVillage(village()));
  const id = house.sheds[0];
  assert.ok(!id.includes(SESSION), `session uuid survived in ${id}`);
  // Renamed, not dropped: the agent half is not a uuid and carries nothing of the
  // conversation, so it stays and the id keeps its shape.
  assert.match(id, new RegExp(`^shed:[^:]+:${AGENT}$`));
});

test('the rest of the redaction still holds', () => {
  const guest = guestVillage(village());
  const flat = JSON.stringify(guest);
  assert.ok(!flat.includes(SESSION), 'a session uuid reached a visitor');
  assert.ok(!flat.includes('the opening prompt'), 'a title reached a visitor');
  assert.ok(!flat.includes('claude/some-branch'), 'a branch name reached a visitor');
  assert.ok(!flat.includes('git'), 'an absolute path reached a visitor');
  assert.equal(houseOf(guest).cwd, 'AgentVillage');
  assert.equal(guest.districts[0].root, 'AgentVillage');
  assert.equal(guest.guestView, true);
});
