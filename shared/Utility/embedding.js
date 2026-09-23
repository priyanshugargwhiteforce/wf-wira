const { Ollama } = require("ollama");
const { Queue, Worker, QueueEvents } = require("bullmq");

const ollama = new Ollama(
{
    host: "http://127.0.0.1:11434"
});

const redisConnection = 
{
    host: "127.0.0.1",
    port: 6379
};

const embeddingQueue = new Queue("OllamaEmbeddingQueue", 
{
    connection: redisConnection
});

const queueEvents = new QueueEvents("OllamaEmbeddingQueue", 
{
    connection: redisConnection
});

const worker = new Worker("OllamaEmbeddingQueue", async (job) => 
{
    const { resumeText } = job.data;
    return await runEmbedding(resumeText);
}, 
{
    connection: redisConnection,
    concurrency: 1
});

worker.on("failed", (job, err) => 
{
    console.error(`❌ Job ${job?.id} failed: ${err.message}`);
});

async function getEmbeddingOnce(text, limit)
{
    const input = text.slice(0, limit);

    const response = await ollama.embed(
    {
        model: "bge-large",
        input: input,
    });

    let embedding = response.embeddings[0];
    const mag = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0)) || 1;
    embedding = embedding.map(x => x / mag);

    return `[${embedding.join(",")}]`;
}

async function runEmbedding(resumeText)
{
    const limits = [1500, 1000, 500];

    for (const limit of limits)
    {
        try
        {
            return await getEmbeddingOnce(resumeText, limit);
        }
        catch(error)
        {
            const isContextError = error?.status_code === 400 && error?.error?.includes("context length");
            if(isContextError)
            {
                continue;
            }

            console.error(`❌ Error generating embedding at limit=${limit}: ${error.message}`);
            return null;
        }
    }

    console.error("❌ Failed to embed even at minimum size");
    return null;
}

async function getEmbedding(resumeText)
{
    const job = await embeddingQueue.add("embed-text", 
    {
        resumeText
    });
    
    const result = await job.waitUntilFinished(queueEvents);
    return result;
}

module.exports = 
{
    getEmbedding
};