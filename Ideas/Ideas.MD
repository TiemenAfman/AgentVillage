Voor dit concept zou ik vooral functies toevoegen die **multiplayer interessant maken zonder het oorspronkelijke idee — “de wereld is een visualisatie van echte agent-activiteit” — kapot te maken**.

### 1. Spelers krijgen een eigen eilandhuis

iedere eiland eigenaar krijgt: 

* eigen huis/werkplaats
* eigen eilandje of perceel
* opslag
* persoonlijke tuin
* vlag/embleem
* eventueel een teleportpoort naar andere eilanden

Je eigen eiland kan dan de **thuisbasis** zijn, terwijl Promptholm zelf het centrale dorp is.

![Image](https://images.openai.com/static-rsc-4/DdJzaspGTct1T_EQ01Lj1erXcYIGZD_xOihHF-CTUI56x6UHvRkAaX7zZALiAKUr1wmFZEdbFgJU26DTC6GyY5AN_Zq2FuV8OTxGld-U9jFAbAwhd_kBl-ihiRB--7PNgUhePqPtvGs3A7AA3xjZN49BvxTuKcUVn4mruoYyU32XNdedxQnNyEYMKIdk8Fen?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/aiS2O9ZJlYGumuv_pjaLQJ34NjxQJ-RRJzP61kZsC1KVIEvs7-XeYhH9xZ0viabHhh6Rz5svLSUxW-uNdgjkdT7tzva1uOQ99wvd5UH7wgS_cjojI0yKp4KND0iFJxpJNNJ16NJ3SfUcPifi6YxtAMQd5qQdYQPtcOAB1Ibeq2beGfngdOBksV438WqmxeLh?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/vCocheXVWcuBC8zwYYkkcU6XB5gKJqnFLVkr6KFjgkGoIDp8z2lP7Y7WpwmggTYw8o72Kle8YkUPxC99qLoc_0ScZd2RpfvRjM27VgDSQNKdYOfPBSzP8mHT5EBq4jIFSy_wrhASmKJF2ciaslleKrRFArOTbiuvSHVwNN5_mCFFPP9ynohKsL53uidkiOs1?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/3i7Xt5iR5gVGc8BL3w2uwERt2O6NVlU1LiAnw4uZSRUuj48yZ_SFBWvkSY_imHCmfmANL9jcua1J_sy4zFhKrkNzI2ZtrwaXQqN0KS2Dyw3LJLYQyXxTvsV3dDHRePw9Im331P1G1wpUJr5U8BkO5fQwpJxZ9MkhjuuwdzG1YkQcbHcD2PIERnXroaPJpagd?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/SfbjF3lE8zxCF8vn7lQBzB9IaXPa4-bOHgz1KUdyDTcgpb22SYCtYgDEqTUfIUSEC8qYnu5-pFtgjopoRT8k3uO85o0ZLqUA8qYJF16ABNGIbldIiqU7yusRWVBT3WeRU5Aa1K9_1RQ2WCatIWLsSUZKaOzKCtr0cZaKp6imqfhItUd6RZyZAVch1KoZqvOI?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/s4XVFOAQJakG1aSUv97Pz9ldjSZf6_Rpr0ZNr2B3j8WleEKrQMLwN2OoQicvcoCuy_PFh38taiexENDicb8a7iuLK7nwQ6QvkciBGXJOvMjlBbqB31Dsn579ZfpUy-GbFAjFAsQPQntGJih952L5_NgRbishyo0LDTglDU2uksUvQJQpNQx2sHjk6iHdWYka?purpose=fullsize)

### 2. Echte multiplayer-interactie

Ik zou het bewust simpel houden:

* spelers kunnen rondlopen
* zwaaien / emotes
* elkaar zien zitten/lopen
* samen gebouwen bekijken
* items laten vallen
* simpele interacties
* deuren openen
* bootjes gebruiken
* samen naar een ander eiland

**Geen MMO-achtige combat nodig.** Het interessante is juist dat je iemand anders letterlijk door diens AI-wereld ziet lopen.

---

### 3. Een eiland per repository

Dit vind ik eigenlijk een heel sterke uitbreiding.

Bijvoorbeeld:

```text
Promptholm
│
├── Town Island
│
├── BoikonLibrary Island
│
├── HMI Island
│
├── Game Island
│
└── Experimental Island
```

Een repository krijgt automatisch een eiland dat groeit naarmate eraan gewerkt wordt.

Daarop:

* gebouwen = projecten/modules
* wegen = afhankelijkheden
* werkplaatsen = actieve development
* magazijnen = assets
* torens = belangrijke milestones
* rook/activiteit = recente activiteit

Dan wordt multiplayer ook vanzelf interessant: **“kom eens kijken naar mijn projectwereld.”**

---

### 4. Portals tussen eilanden

In plaats van een enorme seamless open world zou ik meerdere compacte eilanden maken.

Bijvoorbeeld:

**Town Hall → Island Map**

Daar staat een grote kaart waarop je ziet:

```text
       [Game Island]
            |
[HMI] -- [PROMPTHOLM] -- [Library]
            |
       [Outlands]
```

Een speler loopt naar een eiland, interacteert met de portal en wordt daarheen gebracht.

Dat maakt de wereld praktisch onbeperkt zonder dat één Three.js-scene gigantisch wordt.

---

### 5. Dagelijkse wereld-events

Niet willekeurige quests, maar gebeurtenissen gebaseerd op echte data.

Bijvoorbeeld:

**“A new session has arrived.”**

Dan komt letterlijk een boot aan.

**“Repository updated.”**

Er rijdt een kar met materiaal naar het betreffende gebouw.

**“Large commit.”**

Een gebouw krijgt tijdelijk steigers en bouwactiviteit.

**“Claude session finished.”**

De settler stopt met bouwen en gaat bijvoorbeeld naar huis.

Dat zou het concept enorm levendig maken.

---

### 6. Een wereldkaart die echt leeft

Een grote kaart aan het gemeentehuis:

* eilanden
* online spelers
* actieve Claude-sessies
* repositories
* belangrijke gebouwen
* actieve werkzaamheden
* bootverbindingen

En multiplayer:

> **Martijn is currently on HMI Island**

Je kunt dan naar hem toe.

---

### 7. Samen bouwen, maar met betekenis

Ik zou bouwen niet helemaal vrij maken zoals Minecraft.

Wel bijvoorbeeld:

* brug bouwen
* steiger uitbreiden
* nieuwe aanlegplaats maken
* tuin aanleggen
* bankjes plaatsen
* lampen ophangen
* hekwerk aanpassen
* dorpsplein uitbreiden

Maar de **grote gebouwen blijven datagedreven**.

Zo houd je:

> Data = structuur
> Speler = aankleding

Dat past heel goed bij Promptholm.

---

### 8. Een fysieke "activity layer"

Dit zou ik persoonlijk hoog op de lijst zetten.

De wereld laat niet alleen zien **wat** een agent is, maar ook **wat hij nu doet**.

Bijvoorbeeld:

| Agentstatus     | Wereld               |
| --------------- | -------------------- |
| Thinking        | zit bij vuur/tafel   |
| Reading         | zit in bibliotheek   |
| Editing         | hamert in werkplaats |
| Running command | werkt bij machine    |
| Waiting         | zit op bank          |
| Error           | rode lamp/rook       |
| Finished        | loopt naar huis      |

Dan hoef je niet eens tekst te lezen om te weten wat er gebeurt.

---

### 9. NPC's die eigenlijk agenten zijn

Je huidige settler-systeem is hiervoor perfect.

Ik zou ze meer karakter geven zonder data te verzinnen:

* naam uit session/project
* huidig project
* huidige activiteit
* aantal turns
* gebruikte modelklasse
* laatste activiteit
* gebouwstatus

En misschien een **“follow”**-modus:

> Follow this settler

Dan loopt je speler achter de agent aan terwijl die zijn werk doet.

---

### 10. Een museum / chronicle

Je hebt al de chronicle bar. Ik zou daar een fysiek gebouw van maken:

**The Chronicle**

Daarin kun je de geschiedenis van het eiland bekijken.

Bijvoorbeeld:

```text
Day 1
└─ First settler arrived

Day 4
└─ First repository founded

Day 12
└─ 10th session arrived

Day 21
└─ First hamlet completed

Day 37
└─ Island reclaimed new land
```

Met een soort interactieve tijdlijn.

---

### 11. Fotomodus

Heel simpel maar voor zo'n wereld verrassend waardevol:

* vrije camera
* depth of field
* tijdstip kiezen
* regen/weer
* HUD uit
* screenshot

En eventueel:

**“Share island”**

Niet de data delen, maar een snapshot/export van de wereld.

---

### 12. Weer + seizoenen

Je hebt dag/nacht en maand al.

Daar zou ik beperkt op voortbouwen:

* regen
* mist
* storm
* sneeuw
* herfstbladeren
* onweer
* wind
* golven

Maar ook hier: **geen willekeurige fantasy-elementen nodig**. De wereld mag sfeervol worden zonder dat hij zijn betekenis verliest.

---







### 13 Werkplaats

De werkplaats is de plek waar je tools maakt en upgrades koopt.

Bijvoorbeeld:

🪓 Bijl → bomen hakken
⛏️ Houweel → steen/erts verzamelen
🌱 Betere schep → grotere/efficiëntere akkers
🎣 Hengel → vissen
🔨 Hamer → bepaalde bouwwerken repareren/upgraden
🏠 Werkplaats-upgrades → betere tools beschikbaar

En je huidige coinsysteem wordt dan:

groenten → market → coins → werkplaats → tools/upgrades

Dat geeft de bestaande market meteen een doel.




# Road System – Ideeën & Specificatie

## 14A — Commands uitvoeren via chat

Maak het mogelijk om developer/debug-commands uit te voeren via de bestaande chatinterface.

* Commands worden herkend wanneer een bericht begint met bijvoorbeeld `/`.
* Commands worden **niet als normaal chatbericht naar andere spelers gestuurd**.
* Commands worden **niet opgeslagen in de normale chatgeschiedenis**.
* De command wordt lokaal geïnterpreteerd en uitgevoerd.
* Alleen de gebruiker die de command invoert ziet eventueel de output/resultaten.
* Voorbeelden:

  * `/roads` → toont/verbergt het volledige road network.
  * `/roads debug` → toont extra informatie over de roads.
  * `/roads clear` → debug-visualisatie uitschakelen.
* Onbekende commands geven alleen lokaal een foutmelding.
* Het normale chatgedrag blijft volledig ongewijzigd voor berichten die niet als command worden herkend.

## 14B — Alle roads als wireframe/OID visualiseren

Voeg een debug-command toe waarmee het volledige wegennetwerk zichtbaar gemaakt kan worden.

Bijvoorbeeld:

`/roads`

De command moet:

* alle `paths` en `bridges` uit het bestaande road network visualiseren;
* de roads als wireframe/debug-geometrie weergeven;
* duidelijk zichtbaar maken welke grid cells onderdeel zijn van een road;
* bridges eveneens tonen;
* de originele wereld en road geometry niet aanpassen;
* met dezelfde command opnieuw kunnen worden uitgeschakeld.

Dit is primair bedoeld om het gegenereerde road network en eventuele fouten in de layout te kunnen inspecteren.

## 14C — Huizen zonder verbinding met Town Square highlighten

Controleer welke huizen via het bestaande road network daadwerkelijk verbonden zijn met de Town Square.

Een huis wordt als **niet verbonden** beschouwd wanneer er via `paths` en `bridges` geen geldige route van het huis naar de Town Square bestaat.

Niet-verbonden huizen moeten:

* automatisch worden gedetecteerd;
* duidelijk worden gemarkeerd;
* een **geanimeerd 🚫-symbool** boven het betreffende huis krijgen;
* zichtbaar blijven zolang het huis niet verbonden is;
* automatisch verdwijnen zodra er een geldige road connection ontstaat.

Dit moet gebaseerd zijn op daadwerkelijke graph connectivity en niet alleen op visuele nabijheid van een weg.

De functionaliteit moet ook rekening houden met bridges, zodat een huis aan de andere kant van water niet ten onrechte als onbereikbaar wordt beschouwd wanneer er wel een brugverbinding bestaat.

## 14D — Gebruikers kunnen roads tekenen en aanpassen

Maak het mogelijk voor gebruikers om het wegennetwerk zelf aan te passen.

De gebruiker moet bijvoorbeeld:

* een nieuwe road kunnen tekenen;
* bestaande roads kunnen verlengen;
* roads kunnen omleggen;
* roads kunnen verwijderen;
* roads kunnen aansluiten op bestaande roads.

Bij het tekenen moet het systeem rekening houden met de bestaande grid/cell-structuur.

Een road mag alleen als geldige road worden opgeslagen wanneer de betreffende cellen daarvoor geschikt zijn.

Na iedere wijziging moet het systeem:

1. het road network bijwerken;
2. de connectivity opnieuw bepalen;
3. controleren welke huizen nog verbonden zijn met de Town Square;
4. eventuele 🚫-markeringen automatisch bijwerken.

De gebruiker moet dus direct kunnen zien welk effect een wijziging aan het wegennetwerk heeft.

### Belangrijk

De bestaande `roadCells()` functie moet hierbij als uitgangspunt blijven dienen. Deze combineert momenteel:

`village.paths + village.bridges`

De nieuwe functionaliteit moet dus niet een tweede, afwijkend road-systeem introduceren, maar werken met hetzelfde road network dat ook door de settlers/pathfinding wordt gebruikt.

denk aan de multiplayer support


## Wat ik voor multiplayer vooral zou vermijden

Ik zou **niet** meteen toevoegen:

* XP
* levels
* health
* wapens
* loot
* skill trees
* crafting trees
* hunger
* survival
* generieke quests
* enorme inventory
* PvP

Dan verandert Promptholm van een interessante **AI-world visualizer** in de zoveelste survival game.

De unieke kern is juist:

> **Je softwareontwikkeling bestaat als een fysieke wereld waar je samen doorheen kunt lopen.**

Daar zou ik alles omheen bouwen.

### Mijn ideale volgende laag

Als ik jouw huidige versie als basis neem, zou ik de roadmap ongeveer zo doen:

**1. Multiplayer avatars**
↓
**2. Eigen spelerhuis/perceel**
↓
**3. Eilanden + portals**
↓
**4. Repository → eigen eiland**
↓
**5. Live agent activity**
↓
**6. Samen bouwen/aankleden**
↓
**7. Wereldkaart + Chronicle**
↓
**8. Weer/fotomodus**

Daarmee krijg je iets dat veel meer voelt als een **kleine multiplayer open-world game**, terwijl de bestaande Claude/Code-integratie juist de reden blijft waarom deze wereld anders is dan een gewone game.

---

# Wat er nog ontbreekt op het eiland (25 september 2026)

Een rondgang langs wat het eiland kan tekenen. Gemaakt en op `/demo` te zien, nog niet
geplaatst: de zagerij en de smidse (`Plans/zagerij.md`, `Plans/smidse.md`), en de stal met
paard, de dieren en de veld- en dorpsspullen (`Plans/stal-en-veld.md`). Wat hieronder staat is
nog alleen een idee.

### 15. Werkplekken voor de gereedschapseconomie

Hoort bij #13 Werkplaats: groenten → markt → munten → gereedschap. Elk gereedschap krijgt een
plek waar je het gebruikt, met een passieve settler die daar werkt (zoals de smid):

* **Zagerij en smidse echt plaatsen** — de modellen zijn af; nog kiezen welke trede en welke
  plek (bij het plein, of de zagerij aan de bosrand; dat laatste vraagt een bosregel op de
  server, want het bos wordt nu pas in de browser verspreid).
* **Steengroeve of mijn** 🪨 — bij de houweel: een wand met een gat, een lorrie op rails, een
  hoop stenen; een steenhouwer die hakt.
* **Vissershut** 🎣 — bij de hengel, aan de haven: netten te drogen, een visrek, een roeibootje
  op de kant; een visser die zijn net uitslaat.

### 16. Trainingsveld

Er ligt al een plaatje voor klaar (`Ideas/Images to Render/trainingarea.png`). Oefenpoppen van
stro om op te slaan, schietschijven, een rek met houten zwaarden. Past bij het vechten dat er
al is (zwaard, schild, aanvallen en blokkeren): een plek om te oefenen zonder dat een bewaker
terugslaat.

### 17. Een geheugenplek

Uitwerking van #10 Museum / chronicle, maar als iets wat je op het eiland ziet staan: een
monument of gedenksteen per afgerond project of grote mijlpaal, met de naam erop; of het
Chronicle-gebouw zelf, waar binnen de tijdlijn hangt. Zo laat een project dat klaar is een spoor
na op het eiland in plaats van alleen in de lijst.
