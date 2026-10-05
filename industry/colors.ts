/** Pick the more readable foreground using WCAG relative luminance. */
export function inkOn(bg: string, dark = "#111111", light = "#ffffff"): string {
  const luminance = (hex: string) => {
    const value = hex.slice(1);
    const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    });
    return .2126 * r! + .7152 * g! + .0722 * b!;
  };
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(bg)) return dark;
  const contrast = (a: number, b: number) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  const l = luminance(bg);
  return contrast(l, luminance(dark)) >= contrast(l, luminance(light)) ? dark : light;
}
