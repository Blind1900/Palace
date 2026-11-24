# Urban Defence: play it on your own computer

The game runs straight from its files. There's no server or install, and it doesn't need the internet once you have the files.

## Get it

1. Download the work branch as a ZIP:
   https://github.com/Blind1900/Palace/archive/refs/heads/urban-defence-game-source-2026-11-09.zip
   (or, on https://github.com/Blind1900/Palace, switch to the branch `urban-defence-game-source-2026-11-09`, then Code > Download ZIP). The ZIP holds the whole Palace repository, about 160 MB unpacked.
2. Unzip it anywhere.
3. Open `code/games/urban-defence/index.html` in **Chrome** or **Edge**: double-click it, or drag it onto a browser window.

## Play

- **Start screen**: click **START** (or press Enter). The mode menu follows:
  - **Match**: YOU vs COMPUTER; COMPUTER vs COMPUTER, where you watch and **PLAY LEFT** or **PLAY RIGHT** takes over a side at any moment (**HAND BACK** gives it back); or GAMEPLAY TEST (below).
  - **Map size**: SMALL (about 5-10 minutes; best on slower machines), MEDIUM (10-20) or LARGE (20+). Each is drawn to its own shape.
  - **Side**: LEFT or RIGHT.
  - **Aesthetic**: your side's look. **R**, **B** or **P** (the game calls its styles by these letters).
  - **START** begins; **BACK** or Esc returns to the start screen. Use the mouse, or Tab and Enter.
- **Goal**: destroy every core of the enemy's capitals, then plant your own capital over their ruins. You win when its first tower rises.
- **Camera**: drag to pan, or use WASD and the arrow keys (while no unit is in your hands). The mouse wheel zooms. Click the minimap (bottom right) to jump there. While a unit is in your hands, the view keeps it in the middle.
- **What you can see**: your buildings see round their tops and your units round their heads: troopers least, then tanks, mechs, military antennas, and drones furthest. The taller the building, the further it sees. Only mountains block sight. Ground you have never seen is black. Ground you saw once but can't see now is grey and shows what was there when you last looked; the enemy's units show only where you see them.
- **The land**: each end of the map is open country, with a lake near the very end and no mountain in the outer fifth. The middle of the map is the great barrier, a mountain taller than any other or a wide lake. One or two high mountains stand on the whole map; the other high ground is rolling hills, and every slope can be climbed by a tank.
- **Units**:
  - **Select**: click a unit. Shift+click adds or removes one. Shift+drag a box selects many.
  - **A group**: right-click the ground to send it there; right-click an enemy unit or building to attack it. H holds it, Q lets it go its own way again, Esc deselects.
  - **One unit is in your hands** as soon as you select it. It drops what it was doing and stands still until you press a key. Its panel shows its keys, and the view follows it as it moves.
    - **Move**: hold A/D or the left/right arrows. It moves only while the key is held.
    - **Jump**: Space, W or the up arrow. A drone climbs instead, and S or the down arrow dives it.
    - **Aim and fire**: left-click aims its weapon at the spot and fires there. Moving the mouse doesn't turn it; F fires where your last click aimed.
    - **Alt fire**: right-click fires its second weapon at the spot: a grenade, the other shell, or a missile.
    - **Trooper**: S or the down arrow crouches, 1 2 3 pick its item, F uses it, R reloads.
    - **Clicking other units**: clicking an enemy shoots at it; clicking another of your own units takes that one instead.
    - **Orders**: Shift+right-click still sends it on an order (go, attack, or hack an enemy building).
    - **Letting go**: Q lets it go its own way, and Esc lets it go. Left alone for a few seconds, it carries on with its orders.
- **Pause**: P (or PAUSE on the top bar).
- **The opening**: you start with no territory. The match opens with the CAPITAL seed in your hand: as you move the pointer, a line runs from it down to the ground, green where the seed can go and red where it can't (the note at the pointer says why), and where it's green the outline of your core bunker stands on the ground. Click to place it; it's free. The computer places its own, the clock starts once both stand, and from the core your towers and farms spread outward. Growth clears trees in its way.
- **Seeding later**: the same green or red line and building outline show for every seed in hand.
- **Gameplay test**: choose GAMEPLAY TEST on the menu, or open `pixel-world.html?mode=game&start=test` (add `&side=right`, `&map=small|medium|large`, `&style=R|B|P` or `&seed=N` as you like).
  - It opens the same way as every match (above), but everything builds four times as fast: the cities' growth, the crews and the tunnels.
  - A starting capital's main building is the core bunker. Capitals you seed later have the capital building.
- **Facing**: the left side's units and military buildings face right, towards the other end; the right side's face left.
- **The bottom bar**: SELECT; under SEED, CAPITAL, FARM and MILITARY; under BUILD, TURRET, ROCKETS, DOME, PATRIOT and RUSH; under DEPLOY, the units to pick from and one DEPLOY button. Prices read HM+SM.
- **Build**: the SEED tools plant seeds, only where your side can see. Cities, farms and bases spread from them by themselves, but they never go up a level by themselves.
- **Upgrade**: over the main building of each of your cities, farms and bases is an **UPGRADE** button showing the next level and its price (capital 120 HM × its level, military base 80 × level, farm 60 × level). It raises the main building and the buildings round it. The main building takes 3 minutes to grow whole at each level in a capital, 2 in a military base and 1.5 in a farm, and the button adds GROWING while it does. You can raise it again while it grows, which starts its time over. The button is dimmed while you're short of HM, and it goes once the city is fully grown.
- **Tunnels**: a city digs its road through a mountain only once it's level 3. Until a city has done that, nobody's army can cross that mountain. Its tunnel mouths are proper entrances: an arch ring over the road, a stone face and wing walls. Where a base building's doorway stands right by a mouth, a covered way joins the two.
- **Gate halls**: the ground floor of every tower and base block is a gate hall your vehicles drive through, as tall as a road tunnel. Troopers climb the ladder in the hall to the first floor.
- **Mines**: from level 3 a city sinks a shaft straight down from under its core, and a miner sets out from the bottom towards the nearest ore. In every mine one miner works the face while the other prospects: he digs a drift towards the next ore no one has reached and opens a new mine there. A cave on his way becomes a room with a solid floor, and he crosses it as a shortcut. Ore no one has reached yet sparkles. Look closely at it: each deposit is the shape of an animal (a koi, a hawk, a wolf, a bull or an eel).
- **HM store**: HM over 1200 in hand goes down into a strongroom dug beside your first mine, where it lies as a heap of ore. When you run short, it comes back up.
- **Rush a tunnel**: RUSH (50 HM), then click inside one of your tunnels. Its next 4 minutes of digging and finishing happen in 1.
- **Quit**: Esc first lets go of whatever you're holding (a unit, a selection, a tool). With nothing held, it asks **QUIT THE MATCH?** and pauses while it asks: YES returns to the start screen, NO (or Esc again) goes on.
- **The computer player** changes its plan as the match turns. When your army is at its door it fortifies (turrets and artillery, everything it has thrown at your units in its ground). When it clearly outguns what it sees it rushes (small early waves). Otherwise it builds (seeds, upgrades, then a big wave). In a fight it handles its units itself: they focus on your weakest unit in reach, troopers throw grenades into groups, mechs fire missiles at armour, and badly hurt units fall back to join the next wave.
- **Deploy**: pick a unit on the bottom bar, then press DEPLOY. It lights when you can afford the unit you picked. Units come from your front base, or from the base you've selected, and they come up from the base's core. A base's level decides what it can deploy. Each unit costs HM and SM (the button shows both, HM+SM), and your army can't outgrow your population. A base up on a mountain sends no one out until a road tunnel gives it a way down.
- **Military bases**: a base spreads over smaller buildings round its main one: a watchtower, a barracks with a sandbagged nest on its roof, and a bunker. More of them come as it levels. Fences and concrete walls across the ways in stop enemy troopers, though tanks drive over them. Your own troops pass them.
- **Building times**: a seed's main building, and each level you buy for it, takes 3 minutes to grow whole in a capital, 2 in a military base and 1.5 in a farm (a quarter of that in the gameplay test). While it grows, the crews' dust and fumes rise out of vents in its roof.
  - A base with a hangar has a **spawn pad** in its floor, over its armoured core. Troopers, tanks and mechs come up on it and leave by the hangar door. In a town, they head for the town's gate first.
  - The jets are being replaced by smaller **avenger drones** (the DRONE button). Until the drones are in, they still take off from the runway.
- **Turrets**: TURRET (60 HM), then click flat ground your side can see, or the floor of a tunnel room. A turret base is laid there and a turret seated on it. You can have 3 per level of your military bases. Turrets don't take population.
  - **Building turrets**: military buildings and big towers have turret bases on their roofs.
  - **Losing one**: if a base is blown, its turret is lost. A building's base comes back with the building, and its turret returns a little later.
- **Missile artillery**: ROCKETS (70 HM + 15 SM), DOME, the Iron Dome (90 + 15), and PATRIOT (120 + 20) aren't vehicles. Like turrets, each stands on its own base, but only out under the open sky, never in a tunnel or under a roof. Pick one, then click flat ground your side can see.
  - Each needs a military base of its level (rockets 2, Iron Dome 3, Patriot 4). You can have one per level of your military bases, all three kinds together. They don't take population.
  - Military roofs carry their own launcher and interceptor bases.
- **Hack**: select one trooper and Shift+right-click an enemy base or tower. It goes up to the control panel on the top floor, and hacks it if it stays there 15 seconds. (You can also drive it there yourself.)
  - A military base: some of its defences go silent for a while.
  - A tower: you see what the enemy sees for a while.
- **Healing**: a hurt trooper heals by one of your housing towers or military bases (5 health a second). Tanks and mechs are mended more slowly (2 a second), at your military bases only.
- **F3** shows what each part of the game costs per frame.

## Other pages

- `beta-legacy.html`: the old beta.
- `pixel-world.html`: the sandbox with the world tools (water, blasts, seeds, unit drops), for a look under the hood.
