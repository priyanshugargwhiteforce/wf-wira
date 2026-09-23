const { PythonShell } = require('python-shell');
const path = require('path');

async function extractSpeakerEmbedding(audioPath) 
{
    return new Promise((resolve, reject) => 
    {
        const pythonScript = path.join(__dirname, '../../scripts/speaker_embedding_simple.py');
        console.log(`🐍 Starting Python process for: ${audioPath}`);
        
        const pyshell = new PythonShell(pythonScript, 
            {
                mode: 'text',
                pythonOptions: [
                    '-u', 
                    '-W', 
                    'ignore'
                ],
                args: [audioPath],
                pythonPath: '/usr/bin/python3',
                timeout: 300000,
                env: 
                {
                    PYTHONUNBUFFERED: '1'
                }
            }
        );
 
        let hasResponded = false;
        let fullOutput = '';
        let processTimeout;
 
        pyshell.on('message', (message) => 
            {
                fullOutput += message;
            }
        );
 
        pyshell.on('close', (code) => 
            {
                if(processTimeout)
                {
                    clearTimeout(processTimeout);
                }
            
                if(!hasResponded) 
                {
                    try 
                    {
                        const jsonMatch = fullOutput.match(/\{[\s\S]*\}/);
                        if(jsonMatch) 
                        {
                            const parsed = JSON.parse(jsonMatch[0]);
                            console.log("✅ Successfully parsed embedding data");
                            hasResponded = true;
                        
                            try 
                            { 
                                pyshell.kill('SIGTERM'); 
                            } 
                            catch(e) 
                            {

                            }
                        
                            resolve(parsed);
                        } 
                        else 
                        {
                            throw new Error("No JSON found in output");
                        }
                    } 
                    catch(err) 
                    {
                        console.error("❌ Failed to parse output:", err.message);
                        console.error("Full output was:", fullOutput);
                        hasResponded = true;
                    
                        try 
                        { 
                            pyshell.kill('SIGTERM'); 
                        }
                        catch(e) 
                        {

                        }
                    
                        reject(err);
                    }
                }
            }
        );
 
        pyshell.on('error', (err) => 
            {
                console.error("❌ Python error:", err.message);
            
                if(processTimeout)
                {
                    clearTimeout(processTimeout);
                }
            
                if(!hasResponded) 
                {
                    hasResponded = true;

                    try 
                    { 
                        pyshell.kill('SIGTERM'); 
                    } 
                    catch(e) 
                    {

                    }

                    reject(err);
                }
            }
        );
 
        processTimeout = setTimeout(() => 
            {
                if(!hasResponded) 
                {
                    console.error("❌ No response from Python after 5 mins");
                    hasResponded = true;

                    try 
                    { 
                        pyshell.kill('SIGKILL'); 
                    } 
                    catch(e) 
                    {

                    }
                
                    reject(new Error("Python process timeout - exceeded 300 seconds"));
                }
            }, 
            300000
        );
    });
}

module.exports = {
    extractSpeakerEmbedding,
};