export function drawTunnel(canvas, palette, scale) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width / scale;
  const height = canvas.height / scale;
  const centerX = width / 2;
  const centerY = height / 2;
  const entrance = [width * .64, height * .8];
  const throat = [Math.min(89, width * .285), 41];
  const frame = (halfWidth, halfHeight) => {
    const corner = Math.min(halfWidth, halfHeight) * .37;
    return [
      [-halfWidth + corner, -halfHeight], [halfWidth - corner, -halfHeight],
      [halfWidth, -halfHeight + corner], [halfWidth, halfHeight - corner],
      [halfWidth - corner, halfHeight], [-halfWidth + corner, halfHeight],
      [-halfWidth, halfHeight - corner], [-halfWidth, -halfHeight + corner],
    ];
  };

  function path(points, close = false) {
    context.beginPath();
    for (const [index, [x, y]] of points.entries()) {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    if (close) context.closePath();
  }

  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.translate(centerX, centerY);
  context.lineWidth = 1;
  const far = frame(...throat);
  const near = frame(...entrance);

  // Vary the wall tone by face, keeping the vanishing point free of noise.
  context.fillStyle = palette.wall;
  for (let index = 0; index < near.length; index++) {
    const next = (index + 1) % near.length;
    context.globalAlpha = index % 2 ? .17 : .39;
    path([far[index], far[next], near[next], near[index]], true);
    context.fill();
  }
  context.strokeStyle = palette.tunnel;
  for (let index = 0; index < near.length; index++) {
    context.globalAlpha = index % 2 ? .52 : .72;
    path([far[index], near[index]]);
    context.stroke();
  }

  for (const depth of [.06, .15, .25, .38, .53, .71, .94]) {
    context.globalAlpha = .76 - depth * .37;
    path(frame(throat[0] + (entrance[0] - throat[0]) * depth,
      throat[1] + (entrance[1] - throat[1]) * depth), true);
    context.stroke();
  }

  context.globalAlpha = .24;
  context.strokeStyle = palette.accent;
  path(far, true);
  context.stroke();

  context.globalAlpha = .95;
  context.lineWidth = 1.5;
  for (const corner of [0, 2, 4, 6]) {
    const first = far[corner];
    const next = far[(corner + 1) % far.length];
    const previous = far[(corner + far.length - 1) % far.length];
    const from = (point) => first.map((value, index) => value + (point[index] - value) * .16);
    path([from(previous), first, from(next)]);
    context.stroke();
  }

  context.fillStyle = palette.accent;
  context.globalAlpha = .86;
  for (const side of [-1, 1]) {
    context.fillRect(side * (throat[0] + Math.max(6, width * .035)) - 2, -2, 4, 4);
  }
}
