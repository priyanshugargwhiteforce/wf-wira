const validator = require("validator");
const WiraRetrieve = require("../../Wira-Chatbot/WiraManager/WiraRetrieve");
const PayrollQueueManager = require("./PayrollQueueManager");
const AI = require("@wira/shared/AI/screening/AI");

class PayrollManager {
  constructor(
    redis,
    database,
    phonePool,
    perNumberConcurrency,
    languageToSarvamCodes,
    defaultVad,
    availableCallTypes,
  ) {
    this.redis = redis;
    this.database = database;
    this.phonePool = phonePool;
    this.perNumberConcurrency = perNumberConcurrency;
    this.languageToSarvamCodes = languageToSarvamCodes;
    this.defaultVad = defaultVad;
    this.availableCallTypes = availableCallTypes;

    this.retrieve = new WiraRetrieve();

    const payrollNumber =
      process.env.PLIVO_PAYROLL_PHONE_NUMBER || "+918031703171";
    this.payrollPhonePool = [payrollNumber];

    // Dedicated payroll queue manager — does NOT spawn any screening workers.
    // Only manages "payroll-call-queue" worker and "payroll-numbers-config" Redis key.
    this.payrollQueueManager = new PayrollQueueManager(this.redis, this.database);
    this.payrollQueueManager.payrollPhonePool = this.payrollPhonePool;
    this.payrollQueueManager.perNumberConcurrency = this.perNumberConcurrency;
    this.payrollQueueManager.initWorker();
  }

  deepMerge(target, source) {
    const output = { ...target };

    for (const key of Object.keys(source)) {
      const sourceVal = source[key];
      const targetVal = target[key];

      const bothAreObjects =
        sourceVal !== null &&
        typeof sourceVal === "object" &&
        !Array.isArray(sourceVal) &&
        key in target &&
        typeof targetVal === "object";
      output[key] = bothAreObjects
        ? this.deepMerge(targetVal, sourceVal)
        : sourceVal;
    }

    return output;
  }

  buildReminderText(clientName, companyName, amount, dueDate, subType) {
    const nameStr = clientName || "Valued Client";
    const companyStr = companyName || "White Force";
    const amountStr = amount ? `₹${amount}` : "your due amount";
    const dueDateStr = dueDate || "the scheduled date";

    if (subType === "reminder") {
      return `Hello ${nameStr}, I am Wira speaking from ${companyStr}. This is a gentle reminder that your payment of ${amountStr} is due in 3 days on ${dueDateStr}. Thank you.`;
    } else {
      return `Hello ${nameStr}, I am Wira speaking from ${companyStr}. This is an urgent notice regarding your payment of ${amountStr} which was due on ${dueDateStr}. Could you please let me know by when you will be able to complete this payment?`;
    }
  }

  async handleIntroAudio(data, subType) {
    try {
      const textsWithLanguages = [];
      const ttsSpeaker = "neha";
      const languageCode = "en-IN";

      data.forEach((item) => {
        const clientName = item.clientName || item.name || "Client";
        const companyName = item.companyName || "White Force";
        const amount = item.amount || "";
        const dueDate = item.dueDate || "";

        item.intro = this.buildReminderText(
          clientName,
          companyName,
          amount,
          dueDate,
          subType,
        );

        const alreadyAdded = textsWithLanguages.find(
          (e) => e.text === item.intro && e.languageCode === languageCode,
        );

        if (!alreadyAdded) {
          textsWithLanguages.push({
            text: item.intro,
            languageCode: languageCode,
          });
        }
      });

      const audioBatchResult = await this.database.getOrBuildAudioBatch(
        textsWithLanguages,
        ttsSpeaker,
      );

      if (!audioBatchResult || !audioBatchResult.cacheMap) {
        return {
          statusCode: 500,
          success: false,
          message: "Failed to generate intro audios for payroll call.",
          data: null,
        };
      }

      data.forEach((item) => {
        const audio = audioBatchResult.cacheMap.get(`en-IN:${item.intro}`);

        if (audio) {
          item.introAudio = audio;
        }
      });

      return {
        statusCode: 200,
        success: true,
        message: "Payroll intro audios mapped successfully.",
        data: {
          items: data,
          preCostChars: audioBatchResult.preCostChars,
        },
      };
    } catch (error) {
      console.error("Error generating intro audio in payroll call:", error);

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async validatePayrollBody(data, subType) {
    try {
      const validity = data.map((body, index) => {
        const missingFieldMessages = [];

        if (!body.to) {
          missingFieldMessages.push("To number is required.");
        } else {
          if (!validator.isMobilePhone(body.to, "any")) {
            missingFieldMessages.push("Invalid To number.");
          }
        }

        if (!body.type) {
          missingFieldMessages.push("Call type is required.");
        }

        if (!body.companyName) {
          missingFieldMessages.push("Company name is required.");
        }

        if (missingFieldMessages.length > 0) {
          return {
            statusCode: 400,
            success: false,
            message: "Fields Missing.",
            data: {
              missingFieldMessages: missingFieldMessages,
            },
          };
        }

        return {
          statusCode: 200,
          success: true,
          message: "Payroll call body validated successfully.",
          data: body,
        };
      });

      if (validity.find((item) => item.success !== true)) {
        return {
          statusCode: 400,
          success: false,
          message: "Invalidity in payroll call body found.",
          data: validity,
        };
      }

      const payload = await this.createBodyPayload(data, subType);
      if (!payload.success) {
        return payload;
      }

      const finalResponse = await this.handleDatabaseAndRedisSave(
        payload,
        subType,
      );
      return finalResponse;
    } catch (error) {
      console.error(
        "Error occurred validating payroll call body:",
        error.message,
      );

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async createBodyPayload(data, subType) {
    try {
      const audioResult = await this.handleIntroAudio(data, subType);

      if (!audioResult.success) {
        return {
          statusCode: 500,
          success: false,
          message: "Failed to fetch Intro Audio in payroll call.",
          data: null,
        };
      }

      const enrichedItems = audioResult.data.items;
      const preCostChars = audioResult.data.preCostChars;

      const finalArray = enrichedItems.map((item) => {
        const clientName = item.clientName || item.name || "Valued Client";
        const callConfig = item.callConfig
          ? this.deepMerge(this.defaultVad, item.callConfig)
          : this.deepMerge({}, this.defaultVad);
        callConfig.tts = { speaker: "neha", languageCode: "en-IN" };
        callConfig.stt = { languageCode: "en-IN", sampleRate: 16000 };
        callConfig.language = "en";

        const idleWarningText = "Are you still on the line?";
        const idleDisconnectText =
          "No response received. This call will now be disconnected. Thank you.";

        return {
          to: item.to,
          from: this.payrollPhonePool[0],
          name: clientName,
          clientName: clientName,
          email: item.email ?? null,
          amount: item.amount ?? null,
          dueDate: item.dueDate ?? null,
          companyName: item.companyName,
          type: item.type,
          subType: subType,
          intro: item.intro,
          introAudio: item.introAudio ?? null,
          callConfig: callConfig,
          language: "en",
          idleWarningText: idleWarningText,
          idleDisconnectText: idleDisconnectText,
          status: "initiated",
          startedAt: new Date().toISOString(),
          startTime: null,
          transcript: [],
          recordingUrl: null,
          hangupBy: null,
          hangupCause: null,
          endedAt: null,
          duration: null,
          preCostChars: preCostChars,
          priority: item.priority ?? 0,
        };
      });

      return {
        statusCode: 200,
        success: true,
        message: "Body payload created successfully.",
        data: finalArray,
      };
    } catch (error) {
      console.error(
        "Error occurred creating payroll call payload:",
        error.message,
      );

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async handleDatabaseAndRedisSave(payload, subType) {
    try {
      const items = payload.data;
      const isSingle = items.length === 1;
      const results = [];

      for (const item of items) {
        try {
          const wiraCandidate = await this.database.candidateFindOrCreate(
            item.to,
            item.email ?? null,
            null,
            item.name ?? null,
            null,
          );

          if (!wiraCandidate) {
            results.push({
              to: item.to,
              from: item.from,
              success: false,
              message: "Failed to find or create client candidate.",
            });

            continue;
          }

          const { call: wiraCall, screening: wiraOutboundScreening } =
            await this.database.createCallWithScreening({
              wiraCandidateId: wiraCandidate.id,
              fromPhone: item.from,
              type: item.type,
              jobId: null,
              jobTitle: `Payroll Payment Notice (${subType})`,
              jobDescription: `Payment Due: ₹${item.amount || "N/A"} | Due Date: ${item.dueDate || "N/A"}`,
              companyName: item.companyName,
              intro: item.intro,
              screeningQuestions: [],
              preCost: 0,
              language: "en",
            });

          if (!wiraCall || !wiraOutboundScreening) {
            results.push({
              to: item.to,
              from: item.from,
              success: false,
              message: "Failed to create call record in database.",
            });

            continue;
          }

          const session = {
            type: item.type,
            subType: subType,
            wiraCallId: wiraCall.id,
            wiraOutboundScreeningId: wiraOutboundScreening.id,
            wiraCandidateId: wiraCandidate.id,
            callId: null,
            clientName: item.clientName,
            candidateName: item.clientName,
            amount: item.amount,
            dueDate: item.dueDate,
            companyName: item.companyName,
            jobTitle: `Payroll Payment Notice (${subType})`,
            jobDescription: `Payment Due: ₹${item.amount || "N/A"} | Due Date: ${item.dueDate || "N/A"}`,
            language: "en",
            intro: item.intro,
            introAudio: item.introAudio ?? null,
            screeningQuestions: [],
            fromPhone: item.from,
            toPhone: item.to,
            status: "initiated",
            startedAt: item.startedAt,
            startTime: null,
            transcript: [],
            promisedDate: null,
            callConfig: item.callConfig,
            idleWarningText: item.idleWarningText,
            idleDisconnectText: item.idleDisconnectText,
            duration: null,
            recordingUrl: null,
            hangupBy: null,
            hangupCause: null,
            endedAt: null,
          };

          await this.redis.set(
            `screening:callId:${wiraCall.id}`,
            JSON.stringify(session),
            "EX",
            3600,
          );

          // Push directly to dedicated payroll-call-queue —
          // bypasses the screening-questions pipeline entirely.
          await this.payrollQueueManager.pushToQueue(
            item.to,
            wiraCall.id,
            item.priority ?? 0,
          );

          results.push({
            success: true,
            wiraCallId: wiraCall.id,
            to: item.to,
            from: item.from,
            type: item.type,
          });
        } catch (itemError) {
          console.error(
            "Error processing item in handleDatabaseAndRedisSave (payroll):",
            itemError.message,
          );

          results.push({
            to: item.to,
            from: item.from ?? null,
            success: false,
            message: "Internal error processing this payroll call.",
          });
        }
      }

      if (isSingle) {
        const result = results[0];

        if (!result.success) {
          return {
            statusCode: 400,
            success: false,
            message: result.message,
            data: null,
          };
        }

        return {
          statusCode: 200,
          success: true,
          message: "Payroll call queued successfully.",
          data: {
            wiraCallId: result.wiraCallId,
            to: result.to,
            from: result.from,
            type: result.type,
          },
        };
      }

      return {
        statusCode: 200,
        success: true,
        message: "Payroll call batch processed.",
        data: results,
      };
    } catch (error) {
      console.error(
        "Error occurred in handleDatabaseAndRedisSave (payroll):",
        error.message,
      );

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async handlePayrollCall(items, subType) {
    try {
      const body = Array.isArray(items) ? items : [items];
      if (body.length === 0) {
        return {
          statusCode: 400,
          success: false,
          message: "Request body is required.",
          data: null,
        };
      }

      const result = await this.validatePayrollBody(body, subType);
      return result;
    } catch (error) {
      console.error("Error in handlePayrollCall:", error);

      return {
        statusCode: 500,
        success: false,
        message: "Internal server error.",
        data: null,
      };
    }
  }

  async flushCallEnd(callUUID, hangupBy, callStatus, session) {
    try {
      const costRaw = await this.redis.get(`cost:callId:${callUUID}`);
      const costRecord = costRaw ? JSON.parse(costRaw) : null;

      const endedAt = new Date();
      const startedAt = session.startTime ? new Date(session.startTime) : null;
      const durationSeconds = startedAt
        ? Math.floor((endedAt - startedAt) / 1000)
        : null;

      const allBuckets = [...(costRecord?.buckets ?? [])];
      const currentBucket = costRecord?.currentBucket;

      if (currentBucket && currentBucket.totalCost > 0) {
        allBuckets.push(currentBucket);
      }

      const sarvamTotal = allBuckets.reduce(
        (sum, b) => sum + (b.sarvamTTS?.cost ?? 0) + (b.sarvamSTT?.cost ?? 0),
        0,
      );
      const plivoTotal = allBuckets.reduce(
        (sum, b) => sum + (b.plivo?.cost ?? 0),
        0,
      );
      const geminiTotal = allBuckets.reduce(
        (sum, b) => sum + (b.gemini?.cost ?? 0),
        0,
      );

      let analysisResult = null;
      if (
        callStatus === "completed" &&
        session.transcript &&
        session.transcript.length > 0
      ) {
        analysisResult = await AI.analyzeConversation(
          session.transcript,
          `Payroll Payment Notice for ${session.clientName || "Client"}. Amount: ₹${session.amount || "N/A"}`,
        );
      }

      const costSummary = {
        sarvamTotal: sarvamTotal,
        plivoTotal: plivoTotal,
        geminiTotal: geminiTotal,
        updatedPreCost: 0,
        updatedGeminiPostCost: analysisResult
          ? analysisResult.geminiPostCost
          : 0,
        grandTotal:
          sarvamTotal +
          plivoTotal +
          geminiTotal +
          (analysisResult ? analysisResult.geminiPostCost : 0),
      };

      await this.database.persistCallEnd({
        session: session,
        analysisResult: analysisResult,
        costSummary: costSummary,
        callUUID: callUUID,
        callStatus: callStatus,
        hangupBy: hangupBy,
        durationSeconds: durationSeconds,
        endedAt: endedAt,
        startedAt: startedAt,
        buckets: allBuckets,
      });

      await this.redis.del(`screening:callId:${callUUID}`);
      await this.redis.del(`cost:callId:${callUUID}`);

      await this.payrollQueueManager.deallocateNumber(session.fromPhone);
    } catch (error) {
      console.error(
        "Error occurred in flushCallEnd in payroll manager:",
        error,
      );
    }
  }
}

module.exports = PayrollManager;
