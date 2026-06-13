import { Database } from "bun:sqlite";

function check(dbPath: string) {
  console.log(`Checking ${dbPath}...`);
  try {
    const db = new Database(dbPath);
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log("  Tables:", tables);
    
    const accounts = db.query("SELECT * FROM accounts").all();
    console.log("  Accounts count:", accounts.length);
    console.log("  Accounts:", accounts.map((a: any) => ({ id: a.id, email: a.email, provider: a.provider, status: a.status })));
  } catch (e: any) {
    console.log("  Error:", e.message);
  }
}

check("data/poolprox3.db");
check("etteum-pool.db");
