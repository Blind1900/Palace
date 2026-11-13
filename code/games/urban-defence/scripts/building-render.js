function createFactionArchitectureStyles(random = Math.random) {
  const styles = ['asian', 'gothic', 'modern'];
  for (let index = styles.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [styles[index], styles[swapIndex]] = [styles[swapIndex], styles[index]];
  }
  return Object.freeze({ left: styles[0], right: styles[1], neutral: styles[2] });
}

function createBuildingRenderer({ ctx, camera, surfaceYAt, terrainYAt, worldToScreen,
  drawPixelLine, drawPixelRect, farmBuildingWidth: FARM_BUILDING_WIDTH,
  buildingBlueprints, cores, collapsedBuildings, factionArchitectureStyles }) {
  function architectureStyle(building) {
    return building.style || (factionArchitectureStyles && factionArchitectureStyles[building.owner]);
  }

  function drawBaseWallSegment(x, y, width, height, color, roofType = 'flat') {
    const roofY = y - height;
    const leftGround = surfaceYAt(x);
    const rightGround = surfaceYAt(x + width);

    ctx.save();
    ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x, leftGround - 8);
    ctx.lineTo(x, roofY);
    ctx.moveTo(x + width, roofY);
    ctx.lineTo(x + width, rightGround - 8);
    ctx.moveTo(x, leftGround - 1);
    ctx.lineTo(x, leftGround);
    ctx.moveTo(x + width, rightGround - 1);
    ctx.lineTo(x + width, rightGround);
    ctx.stroke();

    ctx.beginPath();
    if (roofType === 'asian') {
      ctx.moveTo(x - 2, roofY + 1);
      ctx.lineTo(x + width * 0.22, roofY + 1);
      ctx.lineTo(x + width * 0.5, roofY - 5);
      ctx.lineTo(x + width * 0.78, roofY + 1);
      ctx.lineTo(x + width + 2, roofY + 1);
      ctx.moveTo(x - 2, roofY + 1);
      ctx.lineTo(x - 1, roofY - 2);
      ctx.moveTo(x + width + 2, roofY + 1);
      ctx.lineTo(x + width + 1, roofY - 2);
    } else if (roofType === 'gothic') {
      ctx.moveTo(x, roofY);
      ctx.lineTo(x + width * 0.5, roofY - Math.min(10, width * 0.35));
      ctx.lineTo(x + width, roofY);
    } else if (roofType === 'modern') {
      ctx.moveTo(x - 1, roofY + 2);
      ctx.lineTo(x + 2, roofY - 1);
      ctx.lineTo(x + width - 2, roofY - 1);
      ctx.lineTo(x + width + 1, roofY + 2);
    } else if (roofType === 'gable') {
      ctx.moveTo(x, roofY);
      ctx.lineTo(x + width * 0.5, roofY - 5);
      ctx.lineTo(x + width, roofY);
    } else if (roofType === 'peak') {
      ctx.moveTo(x, roofY);
      ctx.lineTo(x + width * 0.25, roofY - 7);
      ctx.lineTo(x + width * 0.5, roofY);
      ctx.lineTo(x + width * 0.75, roofY - 7);
      ctx.lineTo(x + width, roofY);
    } else if (roofType === 'shed') {
      ctx.moveTo(x, roofY);
      ctx.lineTo(x + width * 0.8, roofY - 2);
      ctx.lineTo(x + width, roofY);
    } else {
      ctx.moveTo(x, roofY);
      ctx.lineTo(x + width, roofY);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTower(x, width, height, baseY, color, collapseChance = 0, style) {
    const ground = Math.min(surfaceYAt(x), surfaceYAt(x + width));
    const top = ground - height;
    const roofType = style || (width > 18 ? 'peak' : 'gable');
    drawBaseWallSegment(x, ground, width, height, color, roofType);

    const centerX = x + width * 0.5;
    const centerY = top + 5;
    const glow = worldToScreen(centerX, centerY);
    if (collapseChance > 0.3) {
      const radius = 10 + collapseChance * 15;
      ctx.fillStyle = 'rgba(255, 140, 60, 0.12)';
      ctx.beginPath();
      ctx.arc(glow.x, glow.y, radius * camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSlab(x, width, height, baseY, color, style) {
    const ground = Math.min(surfaceYAt(x), surfaceYAt(x + width));
    drawBaseWallSegment(x, ground, width, height, color, style || 'flat');
  }

  function drawBunker(x, width, height, baseY, color, style) {
    const ground = Math.min(surfaceYAt(x), surfaceYAt(x + width));
    drawBaseWallSegment(x, ground, width, height, color, style || 'shed');
  }

  function drawFarm(farm) {
    const ground = Math.min(surfaceYAt(farm.x), surfaceYAt(farm.x + FARM_BUILDING_WIDTH));
    drawBaseWallSegment(farm.x, ground, FARM_BUILDING_WIDTH, farm.height, buildingColor(farm),
      roofStyle(farm, farm.seed % 2 ? 'gable' : 'peak'));

    for (const [left, right] of [
      [farm.x - farm.cropLeft, farm.x],
      [farm.x + FARM_BUILDING_WIDTH, farm.x + FARM_BUILDING_WIDTH + farm.cropRight],
    ]) {
      for (let stemX = left + 2; stemX < right - 1; stemX += 4) {
        const stemGround = surfaceYAt(stemX);
        drawPixelLine(stemX, stemGround - 1, stemX, stemGround - 7, '#e4c85a', 1);
      }
    }
  }

  function drawMilitaryBase(build) {
    const { x, width, height, level, direction } = build;
    const color = buildingColor(build);
    const ground = Math.min(surfaceYAt(x), surfaceYAt(x + width));
    const top = ground - height;
    drawBaseWallSegment(x, ground, width, height, color, roofStyle(build, 'flat'));
    drawPixelLine(x + width * 0.3, top + 5, x + width * 0.7, top + 5, color, 1);
    drawPixelLine(x + width * 0.5, top + 1, x + width * 0.5, top + 9, color, 1);
    drawPixelLine(x + width - 4, top, x + width - 4, top - 7, color, 1);
    drawPixelLine(x + width - 4, top - 7, x + width + 1, top - 5, color, 1);

    const turretX = x + width * 0.25;
    if (build.defenseHealth > 0) {
      drawPixelLine(turretX - 3, top - 1, turretX + 3, top - 1, color, 1.5);
      drawPixelLine(turretX, top - 2, turretX + direction * 7, top - 6, color, 1.5);
      const guardX = x + width * 0.72;
      drawPixelRect(guardX - 1, top - 9, 2, 2, color);
      drawPixelLine(guardX, top - 7, guardX, top - 2, color, 1);
      drawPixelLine(guardX, top - 5, guardX + direction * 4, top - 5, color, 1);
      drawPixelLine(guardX, top - 2, guardX - 2, top, color, 1);
      drawPixelLine(guardX, top - 2, guardX + 2, top, color, 1);
    }

    if (level >= 3) {
      const launcherX = x + width * 0.48;
      drawPixelLine(launcherX - direction * 2, top - 1, launcherX + direction * 4, top - 10, color, 2);
      drawPixelLine(launcherX + direction, top - 1, launcherX + direction * 7, top - 10, color, 2);
    }
    if (level >= 4) {
      const interceptorX = x + width * 0.88;
      drawPixelLine(interceptorX, top, interceptorX, top - 12, color, 1.5);
      drawPixelLine(interceptorX, top - 12, interceptorX + direction * 3, top - 8, color, 1.5);
    }
  }

  function drawMine(x, width, height, baseY, color, style) {
    const ground = Math.min(surfaceYAt(x), surfaceYAt(x + width));
    drawBaseWallSegment(x, ground, width, height, color, style || 'peak');
    drawPixelLine(x + width * 0.5, ground - height, x + width * 0.5, ground - 2, color, 1.2);
  }

  function roofStyle(building, fallback) {
    const style = architectureStyle(building);
    return ['asian', 'gothic', 'modern'].includes(style) ? style : fallback;
  }

  function drawArchitectureDetails(building, color) {
    const style = architectureStyle(building);
    if (!['asian', 'gothic', 'modern'].includes(style)) return;
    const width = building.kind === 'farm' ? FARM_BUILDING_WIDTH : building.width;
    const ground = Math.min(surfaceYAt(building.x), surfaceYAt(building.x + width));
    const top = ground - building.height;
    const accent = building.owner === 'left' ? '#bce77b' : building.owner === 'right' ? '#ffc58f' : '#d6d2ad';

    if (style === 'asian') {
      const tiers = building.height > 55 ? 3 : 2;
      for (let tier = 1; tier <= tiers; tier += 1) {
        const y = top + building.height * tier / (tiers + 1);
        drawPixelLine(building.x - 1, y + 1, building.x + width * 0.2, y - 1, color, 1);
        drawPixelLine(building.x + width * 0.2, y - 1, building.x + width * 0.5, y + 2, color, 1);
        drawPixelLine(building.x + width * 0.5, y + 2, building.x + width * 0.8, y - 1, color, 1);
        drawPixelLine(building.x + width * 0.8, y - 1, building.x + width + 1, y + 1, color, 1);
        for (const fraction of [0.2, 0.5, 0.8]) {
          drawPixelLine(building.x + width * fraction, y + 2,
            building.x + width * fraction, y + building.height / (tiers + 1), color, 0.8);
        }
      }
      drawPixelRect(building.x + width * 0.5 - 1, top + 2, 2, 2, accent);
      return;
    }

    if (style === 'gothic') {
      drawPixelLine(building.x + width * 0.5, top - Math.min(12, width * 0.4),
        building.x + width * 0.5, top + building.height * 0.18, color, 1.2);
      for (const fraction of [0.18, 0.82]) {
        const buttressX = building.x + width * fraction;
        drawPixelLine(buttressX, top + building.height * 0.12, buttressX, ground - 1, color, 1);
        drawPixelLine(buttressX - 2, ground - 1, buttressX, ground - 7, color, 1);
      }
      const windowX = building.x + width * 0.5;
      const windowTop = top + Math.max(7, building.height * 0.3);
      drawPixelLine(windowX - 2, windowTop + 4, windowX, windowTop, accent, 1);
      drawPixelLine(windowX, windowTop, windowX + 2, windowTop + 4, accent, 1);
      drawPixelLine(windowX - 2, windowTop + 4, windowX + 2, windowTop + 4, accent, 1);
      return;
    }

    const rows = Math.max(1, Math.min(5, Math.floor(building.height / 12)));
    for (const fraction of [0.25, 0.5, 0.75]) {
      drawPixelLine(building.x + width * fraction, top + 4, building.x + width * fraction, ground - 2, color, 0.8);
    }
    for (let row = 1; row <= rows; row += 1) {
      const y = top + building.height * row / (rows + 1);
      drawPixelLine(building.x + 1, y, building.x + width - 1, y, color, 0.8);
    }
    drawPixelLine(building.x + width * 0.25 + 1, top + 5, building.x + width * 0.25 + 4, top + 8, accent, 1);
    drawPixelLine(building.x + width * 0.75 + 1, top + 5, building.x + width * 0.75 + 4, top + 8, accent, 1);
  }

  function buildingColor(building) {
    const style = architectureStyle(building);
    const architecturePalette = {
      left: { asian: '#315b82', gothic: '#3a4b78', modern: '#285e6b' },
      right: { asian: '#91474e', gothic: '#773e58', modern: '#8b4736' },
      neutral: { asian: '#83745d', gothic: '#776c7a', modern: '#5d7476' },
    };
    if (architecturePalette[building.owner] && architecturePalette[building.owner][style]) {
      return architecturePalette[building.owner][style];
    }
    const palette = {
      left: { housing: '#356496', farm: '#28567a', military: '#19416d', mine: '#476c8d' },
      right: { housing: '#964343', farm: '#79332f', military: '#692326', mine: '#8b5146' },
      neutral: { housing: '#9a9a91', farm: '#7f8a78', military: '#737b7c', mine: '#9a9281' },
    };
    const type = ['farm', 'military', 'mine'].includes(building.kind) ? building.kind : 'housing';
    return palette[building.owner][type];
  }

  function drawBlueprint(build) {
    const color = buildingColor(build);
    const leftGround = terrainYAt(build.x);
    const rightGround = terrainYAt(build.x + build.width);
    const baseY = (leftGround + rightGround) * 0.5;

    if (build.kind === 'tower') {
      drawTower(build.x, build.width, build.height, baseY, color, build.seed % 3 === 0 ? 0.8 : 0.4,
        roofStyle(build, build.width > 18 ? 'peak' : 'gable'));
      if (!build.neutral) {
        const center = build.x + build.width / 2;
        const top = Math.min(surfaceYAt(build.x), surfaceYAt(build.x + build.width)) - build.height - 7;
        drawPixelLine(center, top, center, top - 13, color, 1);
      }
    } else if (build.kind === 'farm') {
      drawFarm(build);
    } else if (build.kind === 'military') {
      drawMilitaryBase(build);
    } else if (build.kind === 'mine') {
      drawMine(build.x, build.width, build.height, baseY, color, roofStyle(build, 'peak'));
    } else if (build.kind === 'bunker') {
      drawBunker(build.x, build.width, build.height, baseY, color, roofStyle(build, 'shed'));
    } else if (build.kind === 'shed') {
      drawSlab(build.x, build.width, build.height, baseY, color, roofStyle(build, 'flat'));
    } else {
      drawSlab(build.x, build.width, build.height, baseY, color, roofStyle(build, 'flat'));
    }
    drawArchitectureDetails(build, color);
  }

  function drawMainBunker(core) {
    const center = core.x + 7;
    const ground = surfaceYAt(center);
    const bunker = { owner: core.owner, kind: 'military', x: center - 18, width: 36, height: 18 };
    const color = buildingColor(bunker);
    drawBaseWallSegment(bunker.x, ground, bunker.width, bunker.height, color, roofStyle(bunker, 'flat'));
    drawPixelRect(core.x, ground - 8, 14, 8, color);
    drawArchitectureDetails(bunker, color);
  }

  function drawBuildingDamage(build) {
    if (!build.damageMarks) return;
    const width = build.kind === 'farm' ? FARM_BUILDING_WIDTH : build.width;
    const ground = Math.min(surfaceYAt(build.x), surfaceYAt(build.x + width));
    const top = ground - build.height;
    let roofType = 'flat';
    if (build.kind === 'tower') roofType = width > 18 ? 'peak' : 'gable';
    else if (build.kind === 'farm') roofType = build.seed % 2 ? 'gable' : 'peak';
    else if (build.kind === 'mine') roofType = 'peak';
    else if (build.kind === 'bunker') roofType = 'shed';
    roofType = roofStyle(build, roofType);
    for (const mark of build.damageMarks) {
      const point = worldToScreen(build.x + mark.x, top + mark.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 10 * camera.zoom, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.4 + 0.6 * mark.damage / 100;
      drawBaseWallSegment(build.x, ground, width, build.height, '#ff2920', roofType);
      ctx.restore();
    }
  }

  function drawSettlements() {
    buildingBlueprints.forEach((build) => {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * (build.health / 100);
      drawBlueprint(build);
      ctx.restore();
      drawBuildingDamage(build);
    });

    cores.forEach(drawMainBunker);
  }

  function drawCollapsedBuildings() {
    ctx.save();
    ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
    ctx.scale(camera.zoom, camera.zoom);
    for (const piece of collapsedBuildings) {
      ctx.globalAlpha = Math.min(1, (12 - piece.age) / 3);
      ctx.strokeStyle = piece.color;
      ctx.lineWidth = 1.3;
      ctx.save();
      ctx.translate(piece.x + (piece.direction < 0 ? 0 : piece.width), piece.fractureY);
      ctx.rotate(piece.angle);
      const left = piece.direction < 0 ? 0 : -piece.width;
      const height = piece.fractureY - piece.top;
      ctx.strokeRect(left, -height, piece.width, height);
      ctx.restore();
    }
    ctx.restore();
  }

  return { buildingColor, drawSettlements, drawCollapsedBuildings };
}
