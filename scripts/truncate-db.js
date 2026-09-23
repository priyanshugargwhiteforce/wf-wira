const readline = require('readline');
const { execSync } = require('child_process');
require('dotenv').config();

const TABLES = [
  'wira_app',
  'wira_app_message',
  'wira_whatsapp',
  'wira_whatsapp_message',
  'wira_cache_costs',
  'wira_queue',
  'wira_files',
  'wira_file_chunks',
];

const readLine = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (q) => new Promise((res) => readLine.question(q, res));

(async () => {
  const input = await ask('🔐 Enter password: ');

  if(input.trim() !== process.env.DB_SCRIPT_PASSWORD) 
  {
    console.error('❌ Wrong password. Access denied.');
    readLine.close();
    process.exit(1);
  }

  console.log('✅ Authenticated.\n');
  console.log('📋 Select tables to truncate (space or comma separated numbers):\n');
  TABLES.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  console.log();

  const selection = await ask('Enter numbers: ');
  readLine.close();

  const indices = selection.split(/[\s,]+/).map((n) => parseInt(n.trim(), 10) - 1).filter((n) => !isNaN(n) && n >= 0 && n < TABLES.length);
  if(indices.length === 0) 
  {
    console.error('❌ No valid selections. Exiting.');
    process.exit(1);
  }

  const selected = indices.map((i) => TABLES[i]);
  console.log(`\n⚠️  Truncating: ${selected.join(', ')}\n`);

  const sql = `TRUNCATE TABLE ${selected.join(', ')} CASCADE;`;

  try 
  {
    execSync(`sudo -u postgres psql -d whiteforce_ats -c "${sql}"`, { stdio: 'inherit' });
    console.log('\n✅ Truncation successful. Exiting.');
  } 
  catch(err) 
  {
    console.error('\n❌ Truncation failed:', err.message);
    process.exit(1);
  }
})();