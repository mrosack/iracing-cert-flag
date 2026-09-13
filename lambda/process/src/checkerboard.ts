export interface CheckerboardOptions {
  colorA?: string;
  colorB?: string;
}

/**
 * Builds an SVG for a canvasWidth x canvasHeight background: a single column of
 * alternating black/white squares filling the left edge and a mirrored column
 * filling the right edge (both justified flush to their respective edges). The
 * square size is chosen so a whole number of them tiles the full canvas height
 * exactly - no partial square at the top or bottom - by rounding the cell size
 * up to the nearest whole divisor of canvasHeight that's still >= targetBorderWidth.
 * That means the column can end up a little wider than targetBorderWidth; the
 * caller composites the certificate on top, which clips off that excess rather
 * than leaving a gap between the checkers and the certificate.
 */
export function buildBackgroundSvg(
  canvasWidth: number,
  canvasHeight: number,
  targetBorderWidth: number,
  options: CheckerboardOptions = {}
): string {
  const { colorA = "#000000", colorB = "#ffffff" } = options;

  if (targetBorderWidth <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
      <rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="${colorB}"/>
    </svg>`;
  }

  const rows = Math.max(1, Math.floor(canvasHeight / targetBorderWidth));
  const cellSize = canvasHeight / rows;

  const squares: string[] = [];
  for (let i = 0; i < rows; i++) {
    const color = i % 2 === 0 ? colorA : colorB;
    const y = i * cellSize;
    squares.push(`<rect x="0" y="${y}" width="${cellSize}" height="${cellSize}" fill="${color}"/>`);
    squares.push(
      `<rect x="${canvasWidth - cellSize}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${color}"/>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    <rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="${colorB}"/>
    ${squares.join("\n    ")}
  </svg>`;
}

/** Thin black seam lines at the checker/cert boundaries, drawn as a final overlay. */
export function buildDividerSvg(canvasWidth: number, canvasHeight: number, borderWidth: number, lineWidth: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    <rect x="${borderWidth - lineWidth / 2}" y="0" width="${lineWidth}" height="${canvasHeight}" fill="#000000"/>
    <rect x="${canvasWidth - borderWidth - lineWidth / 2}" y="0" width="${lineWidth}" height="${canvasHeight}" fill="#000000"/>
  </svg>`;
}
