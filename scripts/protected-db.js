const readline = require('readline');
const { execSync } = require('child_process');
require('dotenv').config();

const readLine = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

readLine.question('🔐 Enter password: ', (input) => 
{
  readLine.close();

  if(input.trim() !== process.env.DB_SCRIPT_PASSWORD) 
  {
    console.error('❌ Wrong password. Access denied.');
    process.exit(1);
  }

  console.log('✅ Authenticated. Connecting to database...');
  execSync('sudo -u postgres PAGER=cat psql -d whiteforce_ats', { stdio: 'inherit' })
});