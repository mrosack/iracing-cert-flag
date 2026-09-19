export interface CheckerboardOptions {
  colorA?: string;
  colorB?: string;
}

/**
 * Builds an SVG for a canvasWidth x canvasHeight background: a true 2D checkerboard of
 * `cols` x `rows` squares covering the entire canvas. Since the canvas is exactly 3:2 and
 * cols:rows is exactly 12:8 (also 3:2), each square comes out perfectly square with no
 * rounding - a real checkered-flag pattern, not independently-sized border strips. The
 * certificate is composited on top by the caller, covering a smaller block of the same
 * grid, so the exposed squares form a uniform-size frame around it.
 */
export function buildBackgroundSvg(
  canvasWidth: number,
  canvasHeight: number,
  cols: number,
  rows: number,
  options: CheckerboardOptions = {}
): string {
  const { colorA = "#000000", colorB = "#ffffff" } = options;
  const cellWidth = canvasWidth / cols;
  const cellHeight = canvasHeight / rows;

  const squares: string[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const color = (row + col) % 2 === 0 ? colorA : colorB;
      squares.push(
        `<rect x="${col * cellWidth}" y="${row * cellHeight}" width="${cellWidth}" height="${cellHeight}" fill="${color}"/>`
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    ${squares.join("\n    ")}
  </svg>`;
}

/**
 * A thin light-gray rectangle outline traced just inside the certificate's own edges (not
 * extended across the full canvas, and not bleeding out into the checker squares), drawn as
 * a final overlay so the certificate's white background doesn't bleed invisibly into a white
 * checker square at the seam - it reads clearly against both black and white squares.
 */
export function buildBorderSvg(
  canvasWidth: number,
  canvasHeight: number,
  certX: number,
  certY: number,
  certWidth: number,
  certHeight: number,
  lineWidth: number,
  color = "#999999"
): string {
  // SVG strokes are centered on the path by default, so the path is inset by half the
  // stroke width - that way the stroke's outer edge lands exactly on the cert boundary
  // instead of straddling it and spilling into the checkers.
  const x = certX + lineWidth / 2;
  const y = certY + lineWidth / 2;
  const w = certWidth - lineWidth;
  const h = certHeight - lineWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>
  </svg>`;
}
