const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeScreentoneSettings(settings = {}) {
  return {
    pattern: ['dots', 'gradient', 'lines', 'crosshatch'].includes(settings.pattern) ? settings.pattern : 'dots',
    spacing: clamp(Number(settings.spacing) || 12, 4, 48),
    dotSize: clamp(Number(settings.dotSize) || 2, 0.5, 8),
    angle: ((Number(settings.angle) || 0) % 180 + 180) % 180,
    opacity: clamp(Number(settings.opacity ?? 100) / 100, 0, 1),
    color: /^#[0-9a-f]{6}$/i.test(settings.color) ? settings.color : '#24242a',
  };
}

export function getScreentoneDotRadius({ pattern = 'dots', dotSize = 2, x = 0, y = 0, width = 1200, height = 900 } = {}) {
  if (pattern !== 'gradient') return dotSize;
  const distance = Math.hypot(x - width / 2, y - height / 2);
  const reach = Math.hypot(width, height) * 0.5;
  return dotSize * clamp(1 - distance / reach, 0, 1);
}

export function getScreentoneAngles(pattern, angle = 0) {
  const base = ((Number(angle) || 0) % 180 + 180) % 180;
  if (pattern === 'crosshatch') return [base, (base + 45) % 180];
  return [base];
}

export function applyScreentoneToCanvas(canvas, rawSettings = {}, selection = null) {
  const settings = normalizeScreentoneSettings(rawSettings);
  const { width, height } = canvas;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('스크린톤을 적용할 2D 캔버스를 만들 수 없습니다.');

  context.save();
  if (selection?.length >= 3) {
    context.beginPath();
    selection.forEach((point, index) => index
      ? context.lineTo(point.x, point.y)
      : context.moveTo(point.x, point.y));
    context.closePath();
    context.clip();
  }

  context.globalAlpha = settings.opacity;
  context.fillStyle = settings.color;
  context.strokeStyle = settings.color;
  const diagonal = Math.ceil(Math.hypot(width, height));
  const spacing = settings.spacing;
  const centerX = width / 2;
  const centerY = height / 2;

  for (const angle of getScreentoneAngles(settings.pattern, settings.angle)) {
    context.save();
    context.translate(centerX, centerY);
    context.rotate(angle * Math.PI / 180);

    if (settings.pattern === 'lines' || settings.pattern === 'crosshatch') {
      context.lineWidth = Math.max(0.6, settings.dotSize * 0.55);
      context.beginPath();
      for (let offset = -diagonal; offset <= diagonal; offset += spacing) {
        context.moveTo(-diagonal, offset);
        context.lineTo(diagonal, offset);
      }
      context.stroke();
    } else {
      for (let y = -diagonal; y <= diagonal; y += spacing) {
        for (let x = -diagonal; x <= diagonal; x += spacing) {
          const radius = settings.pattern === 'gradient'
            ? getScreentoneDotRadius({ pattern: 'gradient', dotSize: settings.dotSize, x: x + centerX, y: y + centerY, width, height })
            : settings.dotSize;
          if (radius < 0.25) continue;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    context.restore();
  }
  context.restore();
  return settings;
}
