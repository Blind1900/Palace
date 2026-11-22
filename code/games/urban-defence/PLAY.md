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
- **Camera**: drag to pan, or use WASD and the arrow keys. The mouse wheel zooms. Click the minimap (bottom right) to jump there.
- **Units**:
  - **Select**: click a unit. Shift+click adds or removes one. Shift+drag a box selects many.
  - **Orders**: right-click the ground to send the selection there. Right-click an enemy unit or building to attack it.
  - **Hold or release**: H holds the selection, Q lets it go its own way again, Esc deselects.
  - **Direct control**: with one unit selected, its own keys drive it (shown in its panel). Let go for a few seconds and it carries on alone.
- **Build**: SEED CAPITAL, SEED FARM and SEED MILITARY plant seeds, only where your side can see. Cities, farms and bases grow from them by themselves.
- **Deploy**: the unit buttons on the bottom bar deploy from your front base, or from the base you've selected. A base's level decides what it can deploy. Each unit costs HM, and your army can't outgrow your population.
- **Hack**: select one trooper and right-click an enemy base or tower. It goes up to the control panel on the top floor, and hacks it if it stays there 15 seconds. (You can also drive it there yourself.)
  - A military base: some of its defences go silent for a while.
  - A tower: you see what the enemy sees for a while.
- **F3** shows what each part of the game costs per frame.

## Other pages

- `beta-legacy.html`: the old beta.
- `pixel-world.html`: the sandbox with the world tools (water, blasts, seeds, unit drops), for a look under the hood.
