const bull = require("bullmq");
const AI = require("@wira/shared/AI/screening/AI");
const plivo = require("@wira/shared/Utility/PlivoHandler");

class QueueManager {
  constructor(redis, database, redisManager) {
    this.redis = redis;
    this.database = database;
    this.redisManager = redisManager;

    this.connection = {
      host: "127.0.0.1",
      port: 6379,
      maxRetriesPerRequest: null,
    };

    this.questionsQueue = new bull.Queue("screening-questions-queue", {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });

    this.callQueue = new bull.Queue("call-queue", {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });

    this.initWorker();
  }

  initWorker() {
    //WORKERS
    this.questionsWorker = new bull.Worker(
      "screening-questions-queue",
      async (job) => {
        const jobDescription = job.data.jobDescription;
        const jobTitle = job.data.jobTitle;
        const companyName = job.data.companyName;
        const priority = job.opts.priority || 0;

        try {
          const aiPayload = {
            jobDescription: jobDescription,
            jobTitle: jobTitle,
            companyName: companyName,
          };

          const questions = await AI.generateScreeningQuestions(aiPayload);

          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, "0");
          const day = String(now.getDate()).padStart(2, "0");
          const dateString = `${year}-${month}-${day}`;
          const configKey = `screeningQuestions:${dateString}`;

          const tenPM = new Date(now);
          tenPM.setHours(22, 0, 0, 0);
          if (now.getTime() > tenPM.getTime()) {
            tenPM.setDate(tenPM.getDate() + 1);
          }

          const ttlSeconds = Math.floor(
            (tenPM.getTime() - now.getTime()) / 1000,
          );
          let rawData = await this.redis.get(configKey);
          let queueArray = rawData ? JSON.parse(rawData) : [];

          const jobDescriptionString = JSON.stringify(jobDescription);
          const existingIndex = queueArray.findIndex(
            (item) =>
              JSON.stringify(item.jobDescription) === jobDescriptionString,
          );

          let phonesToCall = [];

          if (existingIndex !== -1) {
            queueArray[existingIndex].processing = false;
            queueArray[existingIndex].questions = questions;
            phonesToCall = queueArray[existingIndex].data;

            await this.redis.set(
              configKey,
              JSON.stringify(queueArray),
              "EX",
              ttlSeconds,
            );
          }

          for (const entry of phonesToCall) {
            await this.pushToCallQueue(entry.phone, entry.wiraCallId, priority);
          }

          return {
            statusCode: 200,
            success: true,
            message:
              "Screening questions generated and calls queued successfully.",
            data: {
              questions: questions,
              totalCallsQueued: phonesToCall.length,
            },
          };
        } catch (aiError) {
          const response = {
            statusCode: 500,
            success: false,
            message: `AI generation failed: ${aiError.message}`,
            data: null,
          };

          const responseJson = JSON.stringify(response);
          throw new Error(responseJson);
        }
      },
      {
        connection: this.connection,
        concurrency: 1,
      },
    );

    this.callWorker = new bull.Worker(
      "call-queue",
      async (job) => {
        const phone = job.data.phone;
        const wiraCallId = job.data.wiraCallId;

        const raw = await this.redis.get(`screening:callId:${wiraCallId}`);
        if (!raw) {
          throw new bull.UnrecoverableError(
            JSON.stringify({
              statusCode: 404,
              success: false,
              message: "Session not found for wiraCallId: " + wiraCallId,
              data: null,
            }),
          );
        }

        const session = JSON.parse(raw);

        // Screening-only: always uses screening phonePool + "numbers-config"
        const allocationResult = await this.redisManager.allocateNumber(
          this.redisManager.phonePool,
          this.redisManager.perNumberConcurrency,
          session.fromPhone ?? null,
        );
        console.log(
          "[Screening] allocationResult : ",
          JSON.stringify(allocationResult),
        );
        if (!allocationResult.success) {
          throw new Error(
            JSON.stringify({
              statusCode: 503,
              success: false,
              message: "ALLOCATION_FAILED — no slots available, retrying...",
              data: null,
            }),
          );
        }

        const fromPhone = allocationResult.data.allotedNumber;
        let plivoResponse = null;

        try {
          plivoResponse = await plivo.initiateCall(
            phone,
            fromPhone,
            session.type,
          );
        } catch (error) {
          await this.redisManager.deallocateNumber(
            this.redisManager.phonePool,
            this.redisManager.perNumberConcurrency,
            fromPhone,
          );
          await this.database.db.updateWiraCalls(
            { status: "failed" },
            { id: wiraCallId }
          );
          throw new bull.UnrecoverableError(
            JSON.stringify({
              statusCode: 502,
              success: false,
              message: "Plivo initiate call failed: " + error.message,
              data: null,
            }),
          );
        }

        const plivoCallId =
          plivoResponse.requestUuid ?? plivoResponse.request_uuid ?? null;
        if (!plivoCallId) {
          await this.redisManager.deallocateNumber(
            this.redisManager.phonePool,
            this.redisManager.perNumberConcurrency,
            fromPhone,
          );
          await this.database.db.updateWiraCalls(
            { status: "failed" },
            { id: wiraCallId }
          );
          throw new bull.UnrecoverableError(
            JSON.stringify({
              statusCode: 502,
              success: false,
              message: "No plivo call ID returned.",
              data: null,
            }),
          );
        }

        const updatedSession = {
          ...session,
          callId: plivoCallId,
          fromPhone: fromPhone,
        };

        await this.redis.set(
          `screening:callId:${plivoCallId}`,
          JSON.stringify(updatedSession),
          "EX",
          3600,
        );
        const dbUpdate = await this.database.db.updateWiraCalls(
          {
            callId: plivoCallId,
          },
          {
            id: wiraCallId,
          },
        );

        if (!dbUpdate) {
          throw new bull.UnrecoverableError(
            JSON.stringify({
              statusCode: 500,
              success: false,
              message:
                "Failed to update wira call in database for wiraCallId: " +
                wiraCallId,
              data: null,
            }),
          );
        }
      },
      {
        connection: this.connection,
        concurrency: 30,
        lockDuration: 180000,
        lockRenewTime: 30000,
        limiter: {
          max: 2,
          duration: 1500,
        },
        stalledInterval: 60000,
        maxStalledCount: 2,
      },
    );

    //LISTENERS---------------------------------------------------
    this.questionsWorker.on("completed", (job, returnValue) => {
      console.log("Job completed with return value:", returnValue);
    });

    this.questionsWorker.on("failed", (job, error) => {
      try {
        const errorData = JSON.parse(error.message);
        console.log(`Job ${job.id} failed with structured data:`, errorData);
      } catch (parseError) {
        console.log(`Job ${job.id} failed with raw error:`, error.message);
      }
    });

    this.callWorker.on("completed", (job, returnValue) => {
      console.log("Job completed with return value:", returnValue);
    });

    this.callWorker.on("failed", (job, error) => {
      try {
        const errorData = JSON.parse(error.message);
        console.log(`Job ${job.id} failed with structured data:`, errorData);
      } catch (parseError) {
        console.log(`Job ${job.id} failed with raw error:`, error.message);
      }
    });
    //------------------------------------------------------------
  }

  async pushToQuestionsQueue(
    jobDescription,
    jobTitle,
    companyName,
    id,
    priority,
  ) {
    try {
      await this.questionsQueue.add(
        "screening-questions-job",
        {
          jobDescription: jobDescription,
          jobTitle: jobTitle,
          companyName: companyName,
        },
        {
          priority: priority,
          jobId: id,
        },
      );

      return {
        statusCode: 200,
        success: true,
        message: "Successfully added job to questions queue.",
        data: null,
      };
    } catch (error) {
      console.log(
        "Error occured adding to questions queue in outbound call: ",
        error,
      );

      return {
        statusCode: 500,
        success: false,
        message: "Error occured adding to questions queue in outbound call.",
        data: null,
      };
    }
  }

  async pushToCallQueue(phone, wiraCallId, priority) {
    try {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istNow = new Date(now.getTime() + istOffset);
      const istHour = istNow.getUTCHours();

      let delay = 0;
      if (istHour >= 20) {
        const nextDay = new Date(istNow);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        nextDay.setUTCHours(4, 30, 0, 0);
        delay = nextDay.getTime() - now.getTime();
      }

      const jobOptions = {
        priority: priority,
        jobId: phone,
        attempts: 999,
        backoff: {
          type: "fixed",
          delay: 3000,
        },
      };

      if (delay > 0) {
        jobOptions.delay = delay;
      }

      await this.callQueue.add(
        "outbound-calling-job",
        {
          phone: phone,
          wiraCallId: wiraCallId,
        },
        jobOptions,
      );
    } catch (error) {
      console.log(
        "Error occured adding to call queue in outbound call: ",
        error,
      );

      return {
        statusCode: 500,
        success: false,
        message: "Error occured adding to call queue in outbound call.",
        data: null,
      };
    }
  }
}

module.exports = QueueManager;
