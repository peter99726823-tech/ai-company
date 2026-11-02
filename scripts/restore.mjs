// Restore a backup JSON into data/company.db.  Stop the app first (npm run dev / start).
//   npm run db:restore -- ./ai-company-backup-2026-11-02.json
import fs from "node:fs";
import path from "node:path";
const file = process.argv[2];
if (!file) {
  console.error("사용법: npm run db:restore -- 백업파일.json");
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(file, "utf8"));
if (j.format !== "ai-company-backup" || typeof j.sqlite !== "string") {
  console.error("이 앱의 백업 파일이 아닙니다.");
  process.exit(1);
}
const bytes = Buffer.from(j.sqlite, "base64");
if (bytes.subarray(0, 15).toString() !== "SQLite format 3") {
  console.error("백업 파일 안의 데이터베이스가 손상되었습니다.");
  process.exit(1);
}
const target = path.resolve(process.env.DATABASE_PATH ?? "./data/company.db");
if (fs.existsSync(target)) {
  const keep = `${target}.before-restore-${Date.now()}`;
  fs.copyFileSync(target, keep);
  console.log(`기존 데이터베이스를 ${keep} 에 보관했습니다.`);
}
for (const ext of ["-wal", "-shm"]) fs.rmSync(target + ext, { force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, bytes);
console.log(`복원했습니다: ${target} (${j.createdAt} 백업)`);
