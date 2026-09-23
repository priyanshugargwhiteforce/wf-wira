const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const DB = require("../database/tenderDBFunctions");
const scraper = require("../utility/tenderScraper");

const connection = new IORedis(
{
    host : process.env.REDIS_HOST || "127.0.0.1",
    port : process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest : null
});

const queueName = "tender-migration";
const migrationQueue = new Queue(queueName, { connection });

async function enqueueMigrationJobs()
{
    const perPage = 500;
    let pageNo = 1;
    let totalEnqueued = 0;
    let totalSkipped = 0;

    while(true)
    {
        const result = await DB.fetchTenders({}, pageNo, perPage);

        if(!result.data || result.data.length === 0)
        {
            break;
        }

        for(const tender of result.data)
        {
            if(!tender.url)
            {
                continue;
            }

            const existsResult = await DB.tenderExists({ tdr : tender.tdr });

            if(existsResult.success && existsResult.exists)
            {
                totalSkipped++;
                continue;
            }

            await migrationQueue.add("migrate-tender",
            {
                url : tender.url,
                category : tender.category
            },
            {
                jobId : `tender-${tender.tdr || tender.id}`,
                attempts : 3,
                backoff :
                {
                    type : "exponential",
                    delay : 5000
                },
                removeOnComplete : true,
                removeOnFail : false
            });

            totalEnqueued++;
        }

        console.log(`✅ Page ${pageNo} processed, enqueued: ${totalEnqueued}, skipped: ${totalSkipped}`);

        if(!result.pagination.hasNext)
        {
            break;
        }

        pageNo++;
    }

    console.log(`✅ Migration enqueue complete: ${totalEnqueued} jobs added, ${totalSkipped} already migrated`);

    return { 
        enqueued : totalEnqueued, 
        skipped : totalSkipped 
    };
}

function startMigrationWorker()
{
    const worker = new Worker(queueName, async (job) =>
    {
        const url = job.data.url;
        const category = job.data.category;

        const payload = await scraper.extractTenderDetails(url, category);
        if(!payload.success)
        {
            throw new Error(payload.error || "Unknown scraping failure");
        }

        return { 
            url : url, 
            inserted : payload.inserted 
        };
    },
    {
        connection : connection,
        concurrency : 5,
        limiter :
        {
            max : 5,
            duration : 1000
        }
    });

    worker.on("completed", (job, returnValue) =>
    {
        console.log(`✅ Job ${job.id} completed:`, returnValue);
    });

    worker.on("failed", (job, err) =>
    {
        console.error(`❌ Job ${job ? job.id : "unknown"} failed:`, err.message);
    });

    return worker;
}

let workerStarted = false;

async function triggerTenderMigration()
{
    if(!workerStarted)
    {
        startMigrationWorker();
        workerStarted = true;
    }

    const summary = await enqueueMigrationJobs();

    return { 
        success : true, 
        ...summary 
    };
}

module.exports = { 
    triggerTenderMigration, 
    migrationQueue 
};