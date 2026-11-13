// The lab's ladder and landings are tied to the actual frame, not decorative floors.
function createCollapseTrooper(model, left, shaftColumn) {
  const rows = [null, 9, 6, 3, 0];
  const shaftX = left + (shaftColumn + 0.5) * model.size;
  const landingX = left + (shaftColumn + 1.5) * model.size;
  const trooper = {
    x: left - 28, y: model.ground, floor: 0, target: 0,
    state: 'Ready', facing: 1, moving: false, health: 100, vy: 0,
    input: { left: false, right: false, up: false, down: false },
    contacts: new Set(),
    requestFloor(floor) {
      if (!Number.isInteger(floor) || floor < 0 || floor >= rows.length) throw new Error('Invalid floor');
      this.target = floor;
      this.manual = false;
      this.onLadder = false;
      this.state = 'Moving';
    },
    step(dt) {
      if (this.health <= 0) { this.state = 'Incapacitated'; this.moving = false; return; }
      const touching = new Set();
      for (const debris of model.fragments) {
        const speed = Math.max(Math.hypot(debris.vx, debris.vy), debris.impactSpeed || 0);
        if (model.touchesRect(debris, this.x - 5, this.y - 20, 10, 20, true)) {
          touching.add(debris);
          if (speed > 35 && !this.contacts.has(debris)) {
            this.health = Math.max(0, this.health - Math.min(60, Math.max(10, (speed - 35) * 0.3)));
          }
        }
      }
      this.contacts = touching;
      if (this.health <= 0) { this.state = 'Incapacitated'; this.moving = false; return; }
      const height = (floor) => floor === 0 ? model.surfaceAt(this.x) :
        model.ground - (11 - rows[floor]) * model.size + (model.size - model.thickness) / 2;
      const intact = (floor) => floor === 0 || model.sections.some((section) =>
        section.row === rows[floor] && section.column === shaftColumn + 1 && section.attached &&
        Math.abs(section.x - (left + section.column * model.size)) < 3 &&
        Math.abs(section.y + (model.size - model.thickness) / 2 - height(floor)) < 3);
      const input = this.input;
      if (input.left || input.right || input.up || input.down || this.manual) {
        this.manual = true;
        const horizontal = Number(input.right) - Number(input.left);
        const wasOnGround = Math.abs(this.y - model.surfaceAt(this.x)) < 1;
        if (horizontal) {
          this.facing = horizontal;
          this.x = Math.max(5, Math.min(635, this.x + horizontal * 70 * dt));
        }
        const ladderRow = Math.max(0, Math.min(model.rows - 1,
          Math.floor((this.y - 1 - (model.ground - model.rows * model.size)) / model.size)));
        const nearLadder = Math.abs(this.x - shaftX) < 12;
        const climbing = nearLadder && (input.up || input.down) && model.ladderSegment(ladderRow);
        const holding = this.onLadder && nearLadder && !horizontal && model.ladderSegment(ladderRow);
        const oldY = this.y;
        if (climbing) {
          this.onLadder = true;
          const nextY = Math.max(model.ground - model.rows * model.size,
            Math.min(model.ground, this.y + (Number(input.down) - Number(input.up)) * 55 * dt));
          const nextRow = Math.max(0, Math.min(model.rows - 1,
            Math.floor((nextY - 1 - (model.ground - model.rows * model.size)) / model.size)));
          if (model.ladderSegment(nextRow)) this.y = nextY;
          this.vy = 0;
        } else if (holding) {
          this.vy = 0;
        } else {
          this.onLadder = false;
          this.vy = Math.min(400, this.vy + 420 * dt);
          const groundY = model.surfaceAt(this.x);
          this.y = wasOnGround ? groundY : Math.min(groundY, this.y + this.vy * dt);
          for (const section of model.sections) {
            if (!section.attached || !section.horizontal || this.x < section.x || this.x > section.x + model.size) continue;
            const top = section.y + (model.size - model.thickness) / 2;
            if (oldY <= top + 1 && this.y >= top) {
              this.y = top;
              this.vy = 0;
            }
          }
          if (this.y === groundY) this.vy = 0;
        }
        this.floor = rows.findIndex((row, floor) => Math.abs(this.y - height(floor)) < 2);
        if (this.floor < 0) this.floor = 0;
        this.moving = !!horizontal || climbing || this.vy > 0;
        this.state = climbing ? 'Climbing' : this.moving ? 'Moving' : 'Ready';
        return;
      }
      if (!intact(this.floor) || !intact(this.target) ||
          rows.some((row, floor) => floor > Math.min(this.floor, this.target) &&
            floor < Math.max(this.floor, this.target) && !intact(floor))) {
        this.moving = false;
        this.state = 'Route blocked by collapse';
        if (this.y < model.ground - 1) this.manual = true;
        return;
      }
      const fromRow = Math.floor((Math.min(this.y, height(this.target)) - (model.ground - model.rows * model.size)) / model.size);
      const toRow = Math.min(model.rows - 1, Math.floor((Math.max(this.y, height(this.target)) - 1 -
        (model.ground - model.rows * model.size)) / model.size));
      for (let row = Math.max(0, fromRow); row <= toRow; row += 1) {
        if (!model.ladderSegment(row)) {
          this.moving = false;
          this.state = 'Route blocked by collapse';
          if (this.y < model.ground - 1) this.manual = true;
          return;
        }
      }
      const move = (value, target, amount) => value + Math.sign(target - value) * Math.min(Math.abs(target - value), amount);
      const destinationX = this.target === 0 ? left + model.size * 3 : landingX;
      this.moving = false;
      if (this.floor !== this.target || Math.abs(this.y - height(this.target)) > 0.1) {
        if (Math.abs(this.x - shaftX) > 0.1) {
          this.facing = Math.sign(shaftX - this.x);
          this.x = move(this.x, shaftX, 50 * dt);
        } else {
          this.y = move(this.y, height(this.target), 40 * dt);
          if (Math.abs(this.y - height(this.target)) < 0.1) this.floor = this.target;
        }
        this.moving = true;
      } else if (Math.abs(this.x - destinationX) > 0.1) {
        this.facing = Math.sign(destinationX - this.x);
        this.x = move(this.x, destinationX, 50 * dt);
        if (this.floor === 0) this.y = model.surfaceAt(this.x);
        this.moving = true;
      }
      this.state = this.moving ? 'Moving' : 'At destination';
    },
  };
  return trooper;
}