export interface CheckerboardOptions {
  columnsPerSide?: number;
  colorA?: string;
  colorB?: string;
}

/**
 * Builds an SVG for a canvasWidth x canvasHeight background: a checkerboard
 * pattern filling the left `borderWidth` px and right `borderWidth` px columns
 * (full height), white everywhere else. The certificate image is composited
 * on top of the white middle area by the caller.
 */
export function buildBackgroundSvg(
  canvasWidth: number,
  canvasHeight: number,
  borderWidth: number,
  options: CheckerboardOptions = {}
): string {
  const { columnsPerSide = 2, colorA = "#000000", colorB = "#ffffff" } = options;

  if (borderWidth <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
      <rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="${colorB}"/>
    </svg>`;
  }

  const cellSize = borderWidth / columnsPerSide;
  const tile = cellSize * 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    <defs>
      <pattern id="checker" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse">
        <rect x="0" y="0" width="${tile}" height="${tile}" fill="${colorB}"/>
        <rect x="0" y="0" width="${cellSize}" height="${cellSize}" fill="${colorA}"/>
        <rect x="${cellSize}" y="${cellSize}" width="${cellSize}" height="${cellSize}" fill="${colorA}"/>
      </pattern>
    </defs>
    <rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="${colorB}"/>
    <rect x="0" y="0" width="${borderWidth}" height="${canvasHeight}" fill="url(#checker)"/>
    <rect x="${canvasWidth - borderWidth}" y="0" width="${borderWidth}" height="${canvasHeight}" fill="url(#checker)"/>
  </svg>`;
}

/** Thin black seam lines at the checker/cert boundaries, drawn as a final overlay. */
export function buildDividerSvg(canvasWidth: number, canvasHeight: number, borderWidth: number, lineWidth: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    <rect x="${borderWidth - lineWidth / 2}" y="0" width="${lineWidth}" height="${canvasHeight}" fill="#000000"/>
    <rect x="${canvasWidth - borderWidth - lineWidth / 2}" y="0" width="${lineWidth}" height="${canvasHeight}" fill="#000000"/>
  </svg>`;
}
