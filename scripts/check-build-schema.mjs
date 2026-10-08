/** Read-only diagnostic: never creates a database, applies migrations or prints credentials. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(root,false);
if(!process.env.DATABASE_URL) {console.log(JSON.stringify({cloudConfigured:false}));process.exit(0);}
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,max:1});
try {
  const result=await pool.query("select name,applied_at from schema_migrations where name in ('018_buyer_activity_priority.sql','019_durable_research.sql','020_research_query_cache.sql') order by name");
  console.log(JSON.stringify({readOnly:true,migrations:result.rows}));
} finally {await pool.end();}
