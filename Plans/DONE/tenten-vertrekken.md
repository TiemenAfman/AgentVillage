# Tenten die niets te doen krijgen, vertrekken weer

**✅ DONE**

Wens (Tiemen, 2026-09-28): inwoners die alleen een tent hebben en lange tijd geen opdrachten
krijgen, vertrekken weer, en het aantal settlers slinkt mee. Een unlock die je eenmaal hebt
gehaald blijft staan als je door vertrek weer onder de grens zakt, maar het duurt dan langer
voor je iets nieuws krijgt. Zo ruimen de tentjes zichzelf op. Huizen blijven altijd staan.

## Hoe het zat

- Een settler is een sessie; zijn `tier` volgt uit het aantal menselijke beurten
  (`TIERS` in `lib/village.mjs`): onder de 3 is het een **tent**, vanaf 3 een hut en hoger.
- Een settler verliest zijn huis alleen als hij verbannen wordt, als hij een bezoeker was
  (een agent van het sprintbord, weg na `visitorGraceMs`), of als hij een lege sessie was die
  nooit een regel schreef. Alle drie gaan via `dropped` in `buildVillage`, en `scan.mjs` geeft
  die plots terug aan het land.
- De mijlpaalladder las `ordered[m.at - 1]`: de n-de settler op aankomst. Minder settlers
  betekende dus meteen dat een gebouw "ontgrendeld: nee" werd. De plot bleef in
  `layout.json` staan (een `civic:`-plot wordt nooit gewist), maar `assemble` tekende hem niet
  meer. Met vertrekkende tenten zou dat gebeuren; dat mag niet.
- Wat verder aan het settleraantal hing: de fairway (eenmalig, al sticky), de polders
  (`layout.polders` groeit alleen), de breedte van het plein (`Math.max`, sticky), de brug
  (`planBridge`, alleen aangeroepen boven `BRIDGE_AT`), de werfstadia (`yardStage`), de
  verdiende boten (`earnedBoats`) en het meubilair op het plein (per leerling).

## Besluiten

1. **Wie vertrekt.** Een settler die als tent getekend wordt (`tier === 'tent'`), niet
   draait (`active`), en wiens laatste activiteit (`lastAt`) langer dan `tentGraceMs` geleden
   is. Standaard **een week**; `tentGraceMs` in `config.json`, `0` zet het uit. Een week omdat
   een sessie die je een paar dagen laat liggen en dan weer oppakt geen verhuizing hoort te
   zijn, en omdat een tent die een week niets gevraagd is echt klaar is.
   Wie **niet** vertrekt, ook al is het formeel een tent:
   - een **bezoeker** — die heeft zijn eigen, veel kortere regel;
   - een **genodigde** (`founders`, via het stadhuis) — de keeper heeft hem zelf binnengehaald,
     en een oude sessie uitnodigen die de volgende scan weer vertrekt zou een knop zijn die
     niets doet;
   - een settler die de keeper een **eigen wijkje** gaf (`layout.rehomed`) — anders verdwijnt
     het wijkje van de keeper met hem;
   - een **kadehuis** (`harbour`) — dat wordt als hut op palen getekend, nooit als tent, en de
     kade is geschiedenis (er komen geen nieuwe bij);
   - een **hotel** (vanaf `HOTEL_AT` leerlingen) — dat is een toren, geen tent.
   Kortom: wat je als tentje op het eiland ziet staan. Een hut, een huisje en alles erboven
   blijft voor altijd.
2. **Hoe hij vertrekt.** Precies zoals een bezoeker: zijn huis en zijn schuurtjes gaan in
   `dropped`, de plots komen vrij, en zijn eigen voorpad gaat mee (zoals bij verbannen).
   `pruneUnreachable` en het opnieuw leggen van voorpaden in `placeAll` helen een buur wiens
   pad erop aansloot. Een wijk die daardoor leegloopt houdt op te bestaan, zoals altijd.
3. **Terugkomen kan.** Wordt de sessie weer opgepakt, dan is `lastAt` vers en staat de tent er
   de volgende scan gewoon weer (op een nieuwe plek). En het stadhuisregister toont een
   vertrokken tent niet meer als "on the island" maar als *packed up*, met **Invite**: een
   uitnodiging maakt hem genodigde, en die blijven.
4. **De ladder telt het meeste dat het dorp ooit tegelijk had.** Eén getal per ladder
   (`settlers`, `apprentices`), `reached`: alles met `at <= reached` staat. De bevolking in de
   kop en "volgende mijlpaal over N" tellen wie er *nu* woont. Omdat de ladder oploopt, is dat
   precies "een unlock blijft staan, en de volgende vraagt dat het dorp weer groot genoeg
   wordt": wie van 60 naar 45 zakt, wacht voor de zagerij (55) nog steeds tot 55, dus tien
   settlers langer dan hij anders had gewacht.
   Dezelfde `reached` voedt alles wat verdiend is: mijlpalen, meubilair, werfstadia, verdiende
   boten, en de poorten in `placeAll` (fairway, polders, plein, brug) via `reachedOf(model)`.
   Anders bouwt de werf de Batavia terug de helling op terwijl ze al op de rede ligt, of
   verdwijnt een boot die het dorp al had.
5. **`reached` staat in `layout.json`** als `layout.ladder = { since, settlers, apprentices }`,
   geschreven door `scan.mjs` (dus layout.json houdt één schrijver) en alleen veranderd als het
   dorp een nieuw hoogtepunt haalt. In layout.json omdat het een beslissing over het verleden
   is die niet uit de data terug te rekenen valt (een verbanning of een opgeruimd transcript
   haalt mensen uit de geschiedenis), en omdat het de enige onvervangbare file is. Een oudere
   versie laat het veld staan (`loadLayout` houdt onbekende velden, `saveLayout` schrijft het
   hele object).
6. **De eerste scan verandert niets aan wat er stond.** Zonder `layout.ladder` begint
   `reached` op wat de oude regel telde: iedereen die er woont plus iedereen die volgens de
   nieuwe regel al weg zou zijn. `since` is het moment van die eerste scan, en geen vertrek
   wordt eerder gedateerd dan `since` — anders werd de regel met terugwerkende kracht op de
   geschiedenis gezet en schoven de data van oude mijlpalen, polders en pleinstappen in de
   kroniek.
7. **Data in de kroniek.** `arrivals` was "wanneer kwam de n-de settler", en dat was altijd al
   "wanneer had het dorp voor het eerst n settlers" zolang niemand vertrok. Het wordt nu dat
   laatste, met vertrek meegerekend (`firstsOf`): de n-de datum is het eerste moment dat er n
   tegelijk woonden. Vóór `since` is dat bit voor bit de oude lijst. Mijlpalen, polders,
   fairway, brug en pleinstappen lezen hem ongewijzigd.

## Bekende beperkingen

- Een vertrekmoment is `lastAt + tentGraceMs`, ook als de scan het pas later ziet (de
  islander stond uit). Dat is het juiste moment voor de kroniek; het hoogtepunt kan daardoor
  niet achteraf dalen, want dat staat vast in `layout.ladder`.
- Een tent die vertrok en terugkomt telt in de geschiedenis alsof hij er al die tijd was
  (zijn vertrek is uit de data verdwenen). Dat verschuift hooguit een datum in de kroniek;
  `reached` groeit er niet van, want dat komt alleen van het huidige aantal.
- Een verbanning haalt iemand nog steeds helemaal uit de telling (zoals altijd), maar een
  unlock gaat er niet meer door verloren: `reached` daalt nooit.
