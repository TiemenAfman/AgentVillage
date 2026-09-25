# Een huis naar een eigen wijkje

## Aanleiding

Lovely Meteor ("Crypto trading setup Bitvavo") is in de map Settlers gestart en woont dus in
het wijkje Settlers, tussen 58 sessies die aan het eiland werken. Tiemen wil dat die sessie een
eigen wijkje krijgt: **Crypto**.

## Waarom het niet vanzelf kan

- Een wijkje is een repository: `lib/village.mjs` kiest het uit de map waarin een sessie het
  meest werkte (`repos.resolve(cwd)` → `p:<pad>`). Er is geen handmatige indeling.
- Een huis verhuist nooit vanzelf: wie een plot heeft, houdt het (`lib/layout.mjs`,
  `if (layout.plots[h.id]) continue`). Een ander wijkje zonder meer zou het huis midden in
  Settlers laten staan, met een leeg nieuw wijkje ergens anders.
- De planner verplaatst alleen hele wijkjes (`move`) en geeft of neemt land (`parcel`).

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Waar komt het? | Een nieuwe planner-op **`rehome`**: `{ op: 'rehome', house: 'house:<uuid>', name: 'Crypto' }`, via dezelfde deur als de rest (`POST /api/plan`, droogtest eerst, snapshot, undo). | De enige deur waardoor een huis bewust mag verhuizen. Alle bestaande vangnetten gelden: `otherMoved` leeg, niemand zonder weg, de volgende scan byte-identiek. |
| Waar wordt de indeling bewaard? | In **`layout.rehomed`**: `{ 'house:<uuid>': { district: 'n:crypto', name: 'Crypto' } }`. | `layout.json` is het ene onvervangbare bestand en de plek waar het plot al staat; indeling en plot moeten samen blijven of samen terug (undo zet het snapshot terug, met de indeling erbij). Een los bestand dat kwijtraakt zou het huis in een wijkje zetten dat niet meer bestaat. |
| Hoe weet het model het? | `buildVillage({ rehomed })` zet zo'n sessie ná het vouwen per repository in een **genoemd wijkje** `n:<slug>` (kind `project`, eigen kleur uit de hash van het id, geen root, geen kantoor). De leerlingen volgen hun meester vanzelf. `scan.mjs` laadt de layout daarom vóór het model. | Eén plek die zegt wie waar woont; alles daarna (districten, populatie, land) volgt de gewone weg. |
| Het huis zelf? | De op haalt het plot van het huis, van zijn schuurtjes en zijn eigen pad weg; `placeAll` sticht daarna het nieuwe wijkje op een plek die het zelf kiest en zet het huis erin, precies zoals bij elk nieuw wijkje. | Geen tweede plaatsingsregel. Waar het wijkje landt kan daarna met `move` in de planner. |
| Het model tijdens het plan? | `runPlan` krijgt een `remodel(rehomed)` mee van `scan.mjs` en bouwt het model opnieuw als een op de indeling veranderde, voor de proef én voor het echte werk; de scan gebruikt daarna dat model. | Het model is gebouwd vóór het plan; zonder dit zou `placeAll` het huis gewoon terugzetten in Settlers. |
| Naam → id? | `n:` + kleine letters, cijfers en streepjes uit de naam (`Crypto` → `n:crypto`). Een tweede huis met dezelfde naam gaat naar hetzelfde wijkje. | `n:` botst nooit met `p:` (paden), `quay` of `outlands`. |
| Terug? | `POST /api/plan/undo` zoals altijd. Een `rehome` terug naar het eigen project is een latere op; nu niet gebouwd. | |
| Knop in de planner? | Nog niet; deze eerste keer gaat via de API. | Eerst zien of het werkt en of het vaker nodig is. |

## Bestanden

- `lib/village.mjs` — `rehomed` in `buildVillage`, `namedDistrict()`.
- `lib/plan.mjs` — `parsePlan` + `opRehome`, `runPlan(..., { remodel })`.
- `scan.mjs` — layout vóór het model, `remodel` doorgeven, het nieuwe model gebruiken.
- `tests/plan-rehome.test.mjs`.
