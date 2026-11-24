# Urban Defence: play it on your own computer

The game runs straight from its files. There's no server or install, and it doesn't need the internet once you have the files.

## Get it

1. Download the work branch as a ZIP:
   https://github.com/Blind1900/Palace/archive/refs/heads/urban-defence-game-source-2026-11-09.zip
   (or, on https://github.com/Blind1900/Palace, switch to the branch `urban-defence-game-source-2026-11-09`, then Code > Download ZIP). The ZIP holds the whole Palace repository, about 160 MB unpacked.
2. Unzip it anywhere.
3. Open `code/games/urban-defence/index.html` in **Chrome** or **Edge**: double-click it, or drag it onto a browser window.

## Play

- **Menu**:
  - **YOU vs COMPUTER**: pick your side, left or right.
  - **COMPUTER vs COMPUTER**: watch two computer players. **PLAY LEFT** or **PLAY RIGHT** takes over a side at any moment, and **HAND BACK** gives it back.
  - **LAPTOP (SMALLER)**: a smaller map for slower machines.
- **Goal**: destroy every core of the enemy's capitals, then plant your own capital over their ruins. You win when its first tower rises.
- **Camera**: drag to pan, or use WASD and the arrow keys (while no unit is in your hands). The mouse wheel zooms. Click the minimap (bottom right) to jump there.
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
- **Build**: SEED CAPITAL, SEED FARM and SEED MILITARY plant seeds, only where your side can see. Cities, farms and bases spread from them by themselves, but they never go up a level by themselves.
- **Upgrade**: UPGRADE, then click one of your cities, farms or bases to raise it a level. The pointer shows the price: capital 120 HM × its level, military base 80 × level, farm 60 × level. Its spread and its towers then grow on up to the new level.
- **Rush a tunnel**: RUSH TUNNEL (50 HM), then click inside one of your tunnels. Its next 4 minutes of digging and finishing happen in 1.
- **Deploy**: the unit buttons on the bottom bar deploy from your front base, or from the base you've selected. A base's level decides what it can deploy. Each unit costs HM and SM (the button shows both, HM+SM), and your army can't outgrow your population.
  - A base with a hangar has a **spawn pad** in its floor, over its armoured core. Troopers, tanks and mechs come up on it and leave by the hangar door. In a town, they head for the town's gate first. Batteries (rockets, Iron Dome, Patriot) don't use the pad: they're set down where they always were, since they can't drive out.
  - The jets are being replaced by smaller **avenger drones** (the DRONE button). Until the drones are in, they still take off from the runway.
- **Turrets**: TURRET (60 HM), then click flat ground your side can see, or the floor of a tunnel room. A turret base is laid there and a turret seated on it. You can have 3 per level of your military bases. Turrets don't take population.
  - **Building turrets**: military buildings and big towers have turret bases on their roofs.
  - **Losing one**: if a base is blown, its turret is lost. A building's base comes back with the building, and its turret returns a little later.
- **Hack**: select one trooper and Shift+right-click an enemy base or tower. It goes up to the control panel on the top floor, and hacks it if it stays there 15 seconds. (You can also drive it there yourself.)
  - A military base: some of its defences go silent for a while.
  - A tower: you see what the enemy sees for a while.
- **F3** shows what each part of the game costs per frame.

## Other pages

- `beta-legacy.html`: the old beta.
- `pixel-world.html`: the sandbox with the world tools (water, blasts, seeds, unit drops), for a look under the hood.
