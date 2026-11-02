/** Backup format shared by the PC and link versions: one JSON file holding the SQLite database. */
export const BACKUP_FORMAT = "ai-company-backup";

export function toBackupJson(bytes: Uint8Array) {
  let b64: string;
  if (typeof Buffer !== "undefined") b64 = Buffer.from(bytes).toString("base64");
  else {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    b64 = btoa(s);
  }
  return { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), bytes: bytes.length, sqlite: b64 };
}

export function fromBackupJson(j: unknown): Uint8Array {
  const o = j as { format?: string; sqlite?: string };
  if (!o || o.format !== BACKUP_FORMAT || typeof o.sqlite !== "string") throw new Error("이 앱의 백업 파일이 아닙니다.");
  const bin = typeof Buffer !== "undefined" ? Buffer.from(o.sqlite, "base64") : Uint8Array.from(atob(o.sqlite), (c) => c.charCodeAt(0));
  const bytes = new Uint8Array(bin);
  if (new TextDecoder().decode(bytes.subarray(0, 15)) !== "SQLite format 3") throw new Error("백업 파일 안의 데이터베이스가 손상되었습니다.");
  return bytes;
}
