/** SCORM 1.2 CMITimespan: HHHH:MM:SS.SS */
export function formatScorm12Time(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.min(9999, Math.floor(totalS / 3600));
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h, 4)}:${p(m)}:${p(s)}.${p(cs)}`;
}

/** SCORM 2004 timeinterval (ISO 8601): PT#H#M#S */
export function formatScorm2004Time(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = (totalCs % 6000) / 100;
  return `PT${h}H${m}M${Number(s.toFixed(2))}S`;
}

/** SCORM 2004 time(second,10,0): YYYY-MM-DDThh:mm:ss */
export function formatScorm2004Timestamp(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/** SCORM 1.2 CMITime: HH:MM:SS */
export function formatScorm12Clock(d: Date): string {
  return d.toISOString().slice(11, 19);
}
