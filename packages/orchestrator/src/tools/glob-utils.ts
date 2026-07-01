export function globToRegExp(globPattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < globPattern.length; i += 1) {
    const char = globPattern[i] ?? '';
    if (char === '*') {
      const next = globPattern[i + 1];
      if (next === '*') {
        const after = globPattern[i + 2];
        if (after === '/') {
          source += '(?:.*/)?';
          i += 2;
          continue;
        }
        source += '.*';
        i += 1;
        continue;
      }
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
  }
  source += '$';
  return new RegExp(source);
}
