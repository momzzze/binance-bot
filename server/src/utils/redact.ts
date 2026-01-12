export function redact(value: string, visible = 4): string {
  if (!value) return '';
  if (value.length <= visible) return '*'.repeat(value.length);
  const start = value.slice(0, visible);
  const end = value.slice(-visible);
  return `${start}...${end}`;
}
