//IMPORTS
const validator = require("validator");
const WiraRetrieve = require("../../Wira-Chatbot/WiraManager/WiraRetrieve");
const RedisManager = require("./RedisManager");
const AI = require("@wira/shared/AI/screening/AI");

class OutboundScreeningManager {
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
    this.redisManager = new RedisManager(
      this.database,
      this.phonePool,
      this.perNumberConcurrency,
    );
    this.tableName = "wira_outbound_screening";

    //DEFAULTS
    this.defaultIntroMessage =
      "हेलो, मैं वीरा एआई बात कर रही हूँ व्हाइट फोर्स की तरफ से। मैं आपसे एक जॉब के बारे में बात करना चाहती हूँ। क्या अभी बात करने का सही समय है?";
  }

  //UTILITY---------------------------------------------------

  deepMerge(target, source) {
    const output = {
      ...target,
    };

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

  async fetchCandidateData(phone) {
    try {
      const candidateResult = await this.retrieve.fetchCandidate(phone);

      if (!candidateResult.success) {
        return {
          statusCode: 400,
          success: false,
          message: "Unable to fetch candidate data.",
          data: null,
        };
      } else {
        return {
          statusCode: 200,
          success: true,
          message: "Candidate data fetched successfully.",
          data: {
            phone: phone,
            ...candidateResult.data,
          },
        };
      }
    } catch (error) {
      console.error(
        "Error occured fetching candidate data in outbound call: ",
        error,
      );

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async handleJobDescription(data) {
    try {
      const jobIds = data
        .map((item) => {
          if (!item.jobDescription && item.jobId) {
            return item.jobId;
          }
        })
        .filter(Boolean);

      if (jobIds.length > 0) {
        const jobFetchResult = await this.retrieve.fetchJobs(jobIds);

        if (!jobFetchResult.success) {
          return {
            statusCode: 400,
            success: false,
            message: "Unable to generate job description.",
            data: null,
          };
        } else {
          const fetchedJobs = jobFetchResult.data.jobs;

          data.forEach((item) => {
            if (!item.jobDescription && item.jobId) {
              const matchedJob = fetchedJobs.find(
                (job) => job.id === item.jobId,
              );

              if (matchedJob) {
                item.jobDescription = matchedJob.jobDescription;
              }
            }
          });
        }
      }

      return {
        statusCode: 200,
        success: true,
        message: "Job descriptions processed successfully.",
        data: data,
      };
    } catch (error) {
      console.error(
        "Error generating job description in outbound call: ",
        error,
      );

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async handleIntroAudio(data) {
    try {
      const textsWithLanguages = [];
      let ttsSpeaker = this.defaultVad.tts.speaker;

      data.forEach((item) => {
        if (!item.intro) {
          item.intro = this.defaultIntroMessage;
        }

        const languageCode = item.callConfig?.tts?.languageCode
          ? item.callConfig.tts.languageCode
          : this.defaultVad.tts.languageCode;

        if (item.callConfig?.tts?.speaker) {
          ttsSpeaker = item.callConfig.tts.speaker;
        }

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
          message: "Failed to generate intro audios.",
          data: null,
        };
      }

      data.forEach((item) => {
        const languageCode = item.callConfig?.tts?.languageCode
          ? item.callConfig.tts.languageCode
          : "hi-IN";
        const audio = audioBatchResult.cacheMap.get(
          `${languageCode}:${item.intro}`,
        );

        if (audio) {
          item.introAudio = audio;
        }
      });

      return {
        statusCode: 200,
        success: true,
        message: "Intro audios mapped successfully.",
        data: {
          items: data,
          preCostChars: audioBatchResult.preCostChars,
        },
      };
    } catch (error) {
      console.error("Error generating intro audio in outbound call: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async handleWiraCandidateFetch(phone) {
    try {
      const wiraCandidate = await this.database.db.fetchWiraCandidates(
        {
          phone: phone,
        },
        1,
        1,
      );

      if (!wiraCandidate.success) {
        return {
          statusCode: 400,
          success: false,
          message: "Unable to fetch Wira Candidate.",
          data: null,
        };
      } else {
        if (wiraCandidate.rows.length > 0) {
          return {
            statusCode: 200,
            success: true,
            message: "Wira Candidate fetched successfully.",
            data: wiraCandidate.rows[0],
          };
        } else {
          return {
            statusCode: 404,
            success: false,
            message: "Wira Candidate not found.",
            data: null,
          };
        }
      }
    } catch (error) {
      console.log(
        "Error occured fetching Wira Candidate in outbound call: ",
        error,
      );

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  //----------------------------------------------------------

  async validateOutboundBody(data) {
    try {
      const validity = data.map((body, index) => {
        const missingFieldMessages = [];

        //VALIDATING TO NUMBER.
        if (!body.to) {
          missingFieldMessages.push("To number is required.");
        } else {
          if (!validator.isMobilePhone(body.to, "any")) {
            missingFieldMessages.push("Invalid To number.");
          }
        }

        //VALIDATING FROM NUMBER
        if (body.from) {
          if (!validator.isMobilePhone(body.from, "any")) {
            missingFieldMessages.push("Invalid From number.");
          }

          if (!this.phonePool.includes(body.from)) {
            missingFieldMessages.push(
              "From number is not from allowed numbers.",
            );
          }
        }

        if (!body.jobTitle) {
          missingFieldMessages.push("Job title is required.");
        }

        //VALIDATING CALL TYPE.
        if (!body.type) {
          missingFieldMessages.push("Call type is required.");
        } else {
          if (!this.availableCallTypes.includes(body.type)) {
            missingFieldMessages.push("Call type is not supported.");
          }
        }

        //VALIDATING JOB ID AND JOB DESCRIPTION.
        if (!body.jobId && !body.jobDescription) {
          missingFieldMessages.push("Job Id or Job Description is required.");
        }

        //VALIDATING JOB TITLE.
        if (body.jobDescription && !body.jobTitle) {
          missingFieldMessages.push(
            "Job title is required when job description is provided.",
          );
        }

        //VALIDATING COMPANY NAME.
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
          message: "Outbound call body validated successfully.",
          data: body,
        };
      });

      if (validity.find((item) => item.success !== true)) {
        return {
          statusCode: 400,
          success: false,
          message: "Invalidity in outbound screening found",
          data: validity,
        };
      } else {
        const payload = await this.createBodyPayload(data);

        if (!payload.success) {
          return payload;
        }

        const finalRespose = await this.handleDatabaseAndRedisSave(payload);
        return finalRespose;
      }
    } catch (error) {
      console.error(
        "Error occured validating outbound call body: ",
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

  async createBodyPayload(data) {
    try {
      const [jobDescResult, audioResult] = await Promise.all([
        this.handleJobDescription(data),
        this.handleIntroAudio(data),
      ]);

      if (!jobDescResult.success) {
        return {
          statusCode: 400,
          success: false,
          message: "Failed to fetch Job Descriptions in outbound call",
          data: null,
        };
      }

      if (!audioResult.success) {
        return {
          statusCode: 500,
          success: false,
          message: "Failed to fetch Intro Audio in outbound call",
          data: null,
        };
      }

      const enrichedItems = audioResult.data.items;
      const preCostChars = audioResult.data.preCostChars;

      const candidatePromises = enrichedItems.map(async (item) => {
        if (item.name && item.email && item.candidateId && item.candidateData) {
          return {
            phone: item.to,
            success: true,
            data: {
              name: item.name,
              email: item.email,
              candidateId: item.candidateId,
              candidateData: item.candidateData,
            },
          };
        }

        const fetched = await this.fetchCandidateData(item.to);
        return {
          phone: item.to,
          success: fetched.success,
          data: fetched.success ? fetched.data : null,
        };
      });

      const candidateResults = await Promise.all(candidatePromises);

      const candidateMap = new Map();
      for (const result of candidateResults) {
        candidateMap.set(result.phone, result.success ? result.data : null);
      }

      const finalArray = enrichedItems.map((item) => {
        const retrieved = candidateMap.get(item.to) ?? null;

        const name =
          item.name ?? retrieved?.name ?? retrieved?.fullName ?? null;
        const email = item.email ?? retrieved?.email ?? null;
        const candidateId = item.candidateId ?? retrieved?.candidateId ?? null;
        const candidateData = item.candidateData ?? retrieved ?? null;
        const callConfig = item.callConfig
          ? this.deepMerge(this.defaultVad, item.callConfig)
          : this.deepMerge({}, this.defaultVad);
        const language = callConfig.language ?? this.defaultVad.language;
        const idleWarningText =
          callConfig.messages?.idleWarning?.[language] ??
          this.defaultVad.messages.idleWarning[language] ??
          this.defaultVad.messages.idleWarning["hi"];
        const idleDisconnectText =
          callConfig.messages?.idleDisconnect?.[language] ??
          this.defaultVad.messages.idleDisconnect[language] ??
          this.defaultVad.messages.idleDisconnect["hi"];

        return {
          to: item.to,
          from: item.from ?? null,
          name: name,
          email: email,
          candidateId: candidateId,
          candidateData: candidateData,
          jobId: item.jobId ?? null,
          jobTitle: item.jobTitle,
          jobDescription: item.jobDescription,
          companyName: item.companyName,
          type: item.type,
          intro: item.intro,
          introAudio: item.introAudio ?? null,
          callConfig: callConfig,
          language: language,
          idleWarningText: idleWarningText,
          idleDisconnectText: idleDisconnectText,
          screeningQuestions: [],
          cacheId: null,
          cacheCostPerSecond: 0,
          status: "initiated",
          startedAt: new Date().toISOString(),
          startTime: null,
          transcript: [],
          cleanTranscript: [],
          screeningQA: [],
          recordingUrl: null,
          hangupBy: null,
          hangupCause: null,
          endedAt: null,
          duration: null,
          preCostChars: preCostChars,
          priority: item.priority,
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
        "Error occured creating outbound call payload: ",
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

  async handleDatabaseAndRedisSave(payload) {
    try {
      const items = payload.data;
      const isSingle = items.length === 1;
      const results = [];

      for (const item of items) {
        try {
          const wiraCandidate = await this.database.candidateFindOrCreate(
            item.to,
            item.email ?? null,
            item.candidateId ?? null,
            item.name ?? null,
            item.candidateData ?? null,
          );

          if (!wiraCandidate) {
            results.push({
              to: item.to,
              from: item.from,
              success: false,
              message: "Failed to find or create candidate.",
            });

            continue;
          }

          const { call: wiraCall, screening: wiraOutboundScreening } =
            await this.database.createCallWithScreening({
              wiraCandidateId: wiraCandidate.id,
              fromPhone: item.from ?? null,
              type: item.type,
              jobId: item.jobId ?? null,
              jobTitle: item.jobTitle,
              jobDescription: item.jobDescription,
              companyName: item.companyName,
              intro: item.intro,
              screeningQuestions: [],
              preCost: 0,
              language: item.language,
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
            wiraCallId: wiraCall.id,
            wiraOutboundScreeningId: wiraOutboundScreening.id,
            wiraCandidateId: wiraCandidate.id,
            callId: null,
            candidateName: item.name ?? "Candidate",
            jobTitle: item.jobTitle,
            jobDescription: item.jobDescription,
            companyName: item.companyName,
            language: item.language,
            intro: item.intro,
            introAudio: item.introAudio ?? null,
            screeningQuestions: [],
            cacheId: null,
            cacheCostPerSecond: 0,
            fromPhone: item.from ?? null,
            toPhone: item.to,
            status: "initiated",
            startedAt: item.startedAt,
            startTime: null,
            transcript: [],
            cleanTranscript: [],
            screeningQA: [],
            callConfig: item.callConfig,
            idleWarningText: item.idleWarningText,
            idleDisconnectText: item.idleDisconnectText,
            duration: null,
            recordingUrl: null,
            hangupBy: null,
            hangupCause: null,
            endedAt: null,
          };

          const now = new Date();
          const istOffset = 5.5 * 60 * 60 * 1000;
          const istNow = new Date(now.getTime() + istOffset);
          const istHour = istNow.getUTCHours();
          const ttl = istHour >= 20 ? 86400 : 3600;

          await this.redis.set(
            `screening:callId:${wiraCall.id}`,
            JSON.stringify(session),
            "EX",
            ttl,
          );

          await this.redisManager.processJobScreeningQueue(
            item.jobDescription,
            item.to,
            item.jobTitle,
            item.companyName,
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
            "Error processing item in handleDatabaseAndRedisSave:",
            itemError.message,
          );

          results.push({
            to: item.to,
            from: item.from ?? null,
            success: false,
            message: "Internal error processing this call.",
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
          message: "Call queued successfully.",
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
        message: "Batch processed.",
        data: results,
      };
    } catch (error) {
      console.error(
        "Error occured in handleDatabaseAndRedisSave:",
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

      let cacheStorageCost = 0;
      if (durationSeconds && session.cacheCostPerSecond) {
        cacheStorageCost = durationSeconds * session.cacheCostPerSecond;
      }

      let analysisResult = null;
      if (
        callStatus === "completed" &&
        session.transcript &&
        session.transcript.length > 0
      ) {
        analysisResult = await AI.analyzeConversation(
          session.transcript,
          session.jobDescription ?? null,
        );
      }

      const existingScreening =
        await this.database.db.fetchWiraOutboundScreenings({
          id: session.wiraOutboundScreeningId,
        });
      let existingPreCost = 0;

      if (
        existingScreening &&
        existingScreening.rows &&
        existingScreening.rows[0]
      ) {
        existingPreCost = parseFloat(existingScreening.rows[0].preCost);
      }

      const totalPreCost = existingPreCost + cacheStorageCost;
      const geminiPostCost = analysisResult ? analysisResult.geminiPostCost : 0;
      const grandTotal =
        sarvamTotal + plivoTotal + geminiTotal + totalPreCost + geminiPostCost;

      const costSummary = {
        sarvamTotal: sarvamTotal,
        plivoTotal: plivoTotal,
        geminiTotal: geminiTotal,
        updatedPreCost: totalPreCost,
        updatedGeminiPostCost: geminiPostCost,
        grandTotal: grandTotal,
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

      if (session.cacheId) {
        await AI.deleteContextCache(session.cacheId);
      }

      await this.redis.del(`screening:callId:${callUUID}`);
      await this.redis.del(`cost:callId:${callUUID}`);

      await this.redisManager.deallocateNumber(
        this.phonePool,
        this.perNumberConcurrency,
        session.fromPhone,
      );
    } catch (error) {
      console.error(
        "Error occurred in flushCallEnd in outbound screening:",
        error,
      );
    }
  }
}

module.exports = OutboundScreeningManager;
