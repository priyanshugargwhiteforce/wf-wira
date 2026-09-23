const readline = require('readline');
const exec = require('child_process');

require('dotenv').config(
    { 
        path: require('path').resolve(__dirname, '../../.env') 
    }
);

const readLine = readline.createInterface(
    {
        input: process.stdin,
        output: process.stdout
    }
);

readLine.question('🔐 Enter password: ', (input) =>
{
    readLine.close();

    if(input.trim() !== process.env.DB_SCRIPT_PASSWORD)
    {
        console.error('❌ Wrong password. Access denied.');
        process.exit(1);
    }

    console.log('✅ Authenticated. Clearing call queue...');
    exec.execSync(`redis-cli keys "bull:call-queue:*" | xargs redis-cli del`, { stdio: 'inherit' });
    console.log('🗑️ Call queue cleared.');
});