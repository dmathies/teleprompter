export function contrastingTextColor(hex) {
      const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
      if (!m) return "#fff";
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return luminance > 145 ? "#000" : "#fff";
    }

export function formatHealthAge(ms) {
      if (!Number.isFinite(ms) || ms < 0) return "—";
      const seconds = Math.floor(ms / 1000);
      if (seconds < 60) return seconds + "s";
      const minutes = Math.floor(seconds / 60);
      const rem = seconds % 60;
      if (minutes < 60) return minutes + "m" + String(rem).padStart(2, "0") + "s";
      const hours = Math.floor(minutes / 60);
      return hours + "h" + String(minutes % 60).padStart(2, "0") + "m";
    }

export function healthClass(age, ok, warn) {
      if (!Number.isFinite(age)) return "health-error";
      if (age <= ok) return "health-ok";
      if (age <= warn) return "health-warn";
      return "health-error";
    }

export function hslToRgb(h, s, l) {
      h = ((h % 360) + 360) % 360;
      s = Math.max(0, Math.min(1, s));
      l = Math.max(0, Math.min(1, l));
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const hp = h / 60;
      const x = c * (1 - Math.abs((hp % 2) - 1));
      let r1 = 0, g1 = 0, b1 = 0;
      if (hp < 1) [r1,g1,b1] = [c,x,0];
      else if (hp < 2) [r1,g1,b1] = [x,c,0];
      else if (hp < 3) [r1,g1,b1] = [0,c,x];
      else if (hp < 4) [r1,g1,b1] = [0,x,c];
      else if (hp < 5) [r1,g1,b1] = [x,0,c];
      else [r1,g1,b1] = [c,0,x];
      const m = l - c / 2;
      return [
        Math.round((r1 + m) * 255),
        Math.round((g1 + m) * 255),
        Math.round((b1 + m) * 255)
      ];
    }
