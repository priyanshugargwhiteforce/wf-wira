const Redis = require("ioredis");
const OutboundScreeningManager = require("./OutboundScreeningManager");
const InboundManager = require("./InboundManager");
const PayrollManager = require("./PayrollManager");
const WiraDatabase = require("../../Wira-Chatbot/WiraManager/WiraDatabase");

class CallManager {
  constructor() {
    this.redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
    });

    this.database = new WiraDatabase();

    this.phonePool = ["+918031903192", "+918031320770"];
    this.perNumberConcurrency = 9;

    this.languageToSarvamCodes = {
      hi: "hi-IN",
      en: "en-IN",
      bn: "bn-IN",
      gu: "gu-IN",
      kn: "kn-IN",
      ml: "ml-IN",
      mr: "mr-IN",
      or: "od-IN",
      pa: "pa-IN",
      ta: "ta-IN",
      te: "te-IN",
    };

    this.defaultVad = {
      vad: {
        aggressiveness: 3,
        silenceTimeoutPackets: 25,
        speechConfirmPackets: 3,
        postSpeechWaitMs: 500,
      },
      idle: {
        warningAfterMs: 15000,
        disconnectAfterMs: 30000,
      },
      tts: {
        speaker: "shreya",
        languageCode: "hi-IN",
      },
      stt: {
        languageCode: "hi-IN",
        sampleRate: 16000,
      },
      language: "hi",
      maxCallDurationMs: 600000,
      messages: {
        idleWarning: {
          hi: "क्या आप अभी भी लाइन पर हैं?",
          en: "Are you still on the line?",
          bn: "আপনি কি এখনও লাইনে আছেন?",
          gu: "શું તમે હજુ પણ લાઇન પર છો?",
          kn: "ನೀವು ಇನ್ನೂ ಲೈನ್‌ನಲ್ಲಿ ಇದ್ದೀರಾ?",
          ml: "നിങ്ങൾ ഇപ്പോഴും ലൈനിൽ ഉണ്ടോ?",
          mr: "तुम्ही अजूनही लाइनवर आहात का?",
          or: "ଆପଣ ଏପର୍ଯ୍ୟନ୍ତ ଲାଇନରେ ଅଛନ୍ତି କି?",
          pa: "ਕੀ ਤੁਸੀਂ ਅਜੇ ਵੀ ਲਾਈਨ 'ਤੇ ਹੋ?",
          ta: "நீங்கள் இன்னும் லைனில் இருக்கிறீர்களா?",
          te: "మీరు ఇంకా లైన్‌లో ఉన్నారా?",
        },
        idleDisconnect: {
          hi: "कोई जवाब न मिलने के कारण यह कॉल अब समाप्त की जा रही है।",
          en: "No response received. This call will now be disconnected.",
          bn: "কোনো সাড়া না পাওয়ায় এই কলটি এখন সংযোগ বিচ্ছিন্ন করা হচ্ছে।",
          gu: "કોઈ પ્રતિસાદ ન મળવાને કારણે આ કૉલ હવે ડિસ્કનેક્ટ કરવામાં આવશે।",
          kn: "ಯಾವುದೇ ಪ್ರತಿಕ୍ରಿಯೆ ਬರದ ಕಾರಣ ಈ ਕရೆಯನ್ನು ಈಗ ಸಂಪರ್ಕ ಕಡਿਤಗೊಳಿಸಲಾಗುತ್ತಿದೆ.",
          ml: "പ്രതികരണം ലഭിക്കാത്തതിനാൽ ഈ കോൾ ഇപ്പോൾ വിച്ഛേദിക്കപ്പെടുന്നു.",
          mr: "कोणताही प्रतिसाद न मिळाल्यामुळे हे कॉल आता डिस्कनेक्ट केले जात आहे.",
          or: "କୌଣସି ପ୍ରତିକ୍ରିୟା ନ ମିଳିବାରୁ ଏହି କଲ୍ ବର୍ତ୍ତମାନ ସଂଯୋଗ ବିଚ୍ଛିନ୍ନ କରାଯାଉଛି।",
          pa: "ਕੋਈ ਜਵਾਬ ਨਾ ਮਿਲਣ ਕਾਰਨ ਇਹ ਕਾਲ ਹੁਣ ਡਿਸਕਨੈਕਟ ਕੀਤੀ ਜਾ ਰਹੀ ਹੈ।",
          ta: "எந்த பதிலும் இல்லாததால் இந்த அழைப்பு இப்போது துண்டிக்கப்படுகிறது.",
          te: "స్పందன లేనందున ఈ కాల్ ఇప్పుడు డిస్‌కనెక్ట్ చేయబడుతోంది.",
        },
      },
    };

    this.availableCallTypes = [
      "outbound-screening",
      "outbound-payroll-reminder",
      "outbound-payroll-overdue",
    ];

    this.handlers = [
      {
        type: "outbound-screening",
        resolve: (request, response) =>
          this.handleOutboundScreening(request, response),
        flush: (callUUID, hangupBy, callStatus, session) =>
          this.outboundScreening.flushCallEnd(
            callUUID,
            hangupBy,
            callStatus,
            session,
          ),
      },
      {
        type: "outbound-payroll-reminder",
        resolve: (items) => this.payroll.handlePayrollCall(items, "reminder"),
        flush: (callUUID, hangupBy, callStatus, session) =>
          this.payroll.flushCallEnd(callUUID, hangupBy, callStatus, session),
      },
      {
        type: "outbound-payroll-overdue",
        resolve: (items) => this.payroll.handlePayrollCall(items, "overdue"),
        flush: (callUUID, hangupBy, callStatus, session) =>
          this.payroll.flushCallEnd(callUUID, hangupBy, callStatus, session),
      },
    ];

    this.outboundScreening = new OutboundScreeningManager(
      this.redis,
      this.database,
      this.phonePool,
      this.perNumberConcurrency,
      this.languageToSarvamCodes,
      this.defaultVad,
      this.availableCallTypes,
    );
    this.inbound = new InboundManager(
      this.redis,
      this.database,
      this.phonePool,
      this.perNumberConcurrency,
      this.languageToSarvamCodes,
      this.defaultVad,
      this.availableCallTypes,
    );
    this.payroll = new PayrollManager(
      this.redis,
      this.database,
      this.phonePool,
      this.perNumberConcurrency,
      this.languageToSarvamCodes,
      this.defaultVad,
      this.availableCallTypes,
    );
  }

  fetchCallHandler(type) {
    return this.handlers.find((handler) => handler.type === type);
  }

  async handleOutboundScreening(data) {
    try {
      const body = Array.isArray(data) ? data : [data];
      if (body.length === 0) {
        const returnData = {
          statusCode: 400,
          success: false,
          message: "Request body is required.",
          data: null,
        };

        return returnData;
      }

      const result = await this.outboundScreening.validateOutboundBody(body);
      return result;
    } catch (error) {
      console.error("Error in handleOutboundScreening:", error);

      const returnData = {
        statusCode: 500,
        success: false,
        message: "Internal server error.",
        data: null,
      };

      return returnData;
    }
  }

  async handleOutboundCall(request, response) {
    try {
      if (!request.body) {
        const returnData = {
          statusCode: 400,
          success: false,
          message: "Request body is required.",
          data: null,
        };

        return response.status(returnData.statusCode).json(returnData);
      }

      const isArray = Array.isArray(request.body);
      const bodyArray = isArray ? request.body : [request.body];

      if (bodyArray.length === 0) {
        const returnData = {
          statusCode: 400,
          success: false,
          message: "Request body cannot be empty.",
          data: null,
        };

        return response.status(returnData.statusCode).json(returnData);
      }

      for (let i = 0; i < bodyArray.length; i++) {
        if (!bodyArray[i].type) {
          const returnData = {
            statusCode: 400,
            success: false,
            message: `Type is required for item at index ${i}.`,
            data: null,
          };

          return response.status(returnData.statusCode).json(returnData);
        }
      }

      const groupsByType = {};
      for (const item of bodyArray) {
        if (!groupsByType[item.type]) {
          groupsByType[item.type] = [];
        }

        groupsByType[item.type].push(item);
      }

      const processedResults = [];
      let overallSuccess = true;
      let overallStatusCode = 200;
      let overallMessage = isArray
        ? "Batch processed successfully."
        : "Call queued successfully.";

      for (const [type, items] of Object.entries(groupsByType)) {
        const handler = this.fetchCallHandler(type);

        if (!handler) {
          const returnData = {
            statusCode: 400,
            success: false,
            message: `Invalid call type: '${type}'.`,
            data: null,
          };

          return response.status(returnData.statusCode).json(returnData);
        }

        const result = await handler.resolve(items);
        if (!result.success) {
          overallSuccess = false;
          overallStatusCode = result.statusCode || 400;
          overallMessage = result.message || "Error processing call batch.";
        }

        processedResults.push({
          type: type,
          statusCode: result.statusCode,
          success: result.success,
          message: result.message,
          data: result.data,
        });
      }

      if (!isArray && processedResults.length === 1) {
        const single = processedResults[0];

        return response.status(single.statusCode).json({
          statusCode: single.statusCode,
          success: single.success,
          message: single.message,
          data: single.data,
        });
      }

      return response.status(overallStatusCode).json({
        statusCode: overallStatusCode,
        success: overallSuccess,
        message: overallMessage,
        data: processedResults,
      });
    } catch (error) {
      console.error("Error in handleOutboundCall:", error);

      return response.status(500).json({
        statusCode: 500,
        success: false,
        message: "Internal server error.",
        data: null,
      });
    }
  }

  async handlePlivoAnswerGet(request, response) {
    const callUUID = request.query.CallUUID || "";
    let routeName = null;
    let session = null;

    try {
      if (callUUID) {
        const raw = await this.redis.get(`screening:callId:${callUUID}`);

        if (raw) {
          session = JSON.parse(raw);

          if (request.query.routeName) {
            routeName = request.query.routeName;
          } else {
            if (session.type) {
              routeName = session.type;
            } else {
              routeName = "outbound-screening";
            }
          }

          session.startTime = new Date().toISOString();
          await this.redis.set(
            `screening:callId:${callUUID}`,
            JSON.stringify(session),
            "EX",
            3600,
          );
        } else {
          if (request.query.routeName) {
            routeName = request.query.routeName;
          } else {
            routeName = "outbound-screening";
          }

          console.error("No Session Found in handlePlivoAnswerGet");
        }
      }
    } catch (err) {
      console.error("Error in handlePlivoAnswerGet:", err);
    } finally {
      const webSocketUrl = `wss://wira-ai.com/call-socket/${routeName}?CallUUID=${callUUID}`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
                <Response>
                    <Record recordSession="true" maxLength="1200" callbackUrl="https://wira-ai.com/call/plivo-recording" />
                    <Stream bidirectional="true" keepCallAlive="true">${webSocketUrl}</Stream>
                </Response>`;

      response.set("Content-Type", "text/xml");
      return response.status(200).send(xml);
    }
  }

  async handlePlivoAnswerPost(request, response) {
    response.status(200).send("");

    const callUUID = request.body.CallUUID ?? null;
    const hangupBy = request.body.HangupSource ?? null;
    const callStatus = request.body.CallStatus ?? null;

    if (!callUUID) {
      return;
    }

    const statusMap = {
      completed: "completed",
      "no-answer": "no_answer",
      busy: "busy",
      failed: "failed",
      canceled: "canceled",
    };

    const resolvedStatus = statusMap[callStatus] ?? "failed";

    try {
      const raw = await this.redis.get(`screening:callId:${callUUID}`);
      if (!raw) {
        return;
      }

      const session = JSON.parse(raw);
      const handler = this.fetchCallHandler(session.type);

      if (!handler) {
        return;
      }

      await handler.flush(callUUID, hangupBy, resolvedStatus, session);
    } catch (error) {
      console.error("Error occurred in handlePlivoAnswerPost:", error);
    }
  }

  async handlePlivoRecording(request, response) {
    response.status(200).send("");
    const callUUID = request.body.CallUUID ?? null;
    const recordingUrl = request.body.RecordUrl ?? null;

    if (!callUUID || !recordingUrl) {
      return;
    }

    await this.database.saveRecordingUrl(callUUID, recordingUrl);
    return;
  }

  async handleInboundAnswer(request, response) {
    const callUUID = request.body.CallUUID ?? request.query.CallUUID ?? "";
    const fromPhone = request.body.From ?? request.query.From ?? "";
    const toPhone = request.body.To ?? request.query.To ?? "";

    console.log("Inbound Call Recieved: ", {
      callUUID: callUUID,
      fromPhone: fromPhone,
      toPhone: toPhone,
    });

    const streamUrl = `https://wira-ai.com/call/inbound-stream?CallUUID=${callUUID}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <PreAnswer>
                <Wait length="5"/>
            </PreAnswer>
            <Redirect method="GET">${streamUrl}</Redirect>
        </Response>`;

    console.log("XML RESPONSE:", xml);
    response.set("Content-Type", "text/xml");
    response.status(200).send(xml);

    const racePromise = this.inbound.buildSession(callUUID, fromPhone, toPhone);
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
        });
      }, 5000);
    });

    Promise.race([racePromise, timeoutPromise]).then((result) => {
      console.log("Inbound call race result: ", {
        callUUID: callUUID,
        success: result.success,
      });
    });

    racePromise.catch((err) => {
      console.log("Inbound session build failed: ", {
        callUUID: callUUID,
        error: err.message,
      });
    });
  }

  handleInboundStream(request, response) {
    const callUUID = request.query.CallUUID ?? "";

    console.log("Inbound Stream Recieved: ", {
      callUUID: callUUID,
    });

    const webSocketUrl = `wss://wira-ai.com/call-socket/inbound-call?CallUUID=${callUUID}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <Record recordSession="true" maxLength="1200" callbackUrl="https://astro-buddy.in/AI/plivo-recording" />
            <Stream bidirectional="true" keepCallAlive="true">${webSocketUrl}</Stream>
        </Response>`;

    response.set("Content-Type", "text/xml");
    return response.status(200).send(xml);
  }
}

module.exports = CallManager;
