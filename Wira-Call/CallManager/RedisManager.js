const Redis = require("ioredis");
const redis = require("@wira/shared/config/redisConfig");
const QueueManager = require("./QueueManager");

const ALLOCATE_SCRIPT = `
    local configKey = KEYS[1]
    local concurrency = tonumber(ARGV[1])
    local preferredNumber = ARGV[2]
    local initConfigJson = ARGV[3]

    local function cleanDigits(numStr)
        if not numStr then return "" end
        return string.gsub(tostring(numStr), "%D", "")
    end

    local function matchPhones(a, b)
        if not a or not b or a == "" or b == "" then return false end
        if a == b then return true end
        local da = cleanDigits(a)
        local db = cleanDigits(b)
        if da == db then return true end
        if #da >= 10 and #db >= 10 then
            return string.sub(da, -10) == string.sub(db, -10)
        end
        return false
    end

    local raw = redis.call('GET', configKey)
    local config
    local initConfig = cjson.decode(initConfigJson)

    if raw then
        config = cjson.decode(raw)
        -- Synchronize missing numbers from initConfig into config
        for _, initItem in ipairs(initConfig) do
            local exists = false
            for _, item in ipairs(config) do
                if matchPhones(item.number, initItem.number) then
                    exists = true
                    break
                end
            end
            if not exists then
                table.insert(config, {
                    number = initItem.number,
                    totalCalls = 0,
                    available = true
                })
            end
        end
    else
        config = initConfig
    end

    local selectedIdx = nil

    if preferredNumber ~= '' then
        -- First try preferred number if provided and has available capacity
        for i, item in ipairs(config) do
            if matchPhones(item.number, preferredNumber) then
                if item.totalCalls < concurrency then
                    selectedIdx = i
                end
                break
            end
        end
    end

    -- If preferred number was not specified OR was full / not found,
    -- fall back to picking the available number with the FEWEST active calls
    if not selectedIdx then
        local minCalls = nil
        for i, item in ipairs(config) do
            if item.totalCalls < concurrency then
                if minCalls == nil or item.totalCalls < minCalls then
                    minCalls = item.totalCalls
                    selectedIdx = i
                end
            end
        end
    end

    if not selectedIdx then
        return cjson.encode({ success = false, config = config })
    end

    config[selectedIdx].totalCalls = config[selectedIdx].totalCalls + 1
    config[selectedIdx].available = config[selectedIdx].totalCalls < concurrency

    redis.call('SET', configKey, cjson.encode(config))

    return cjson.encode({ 
        success = true, 
        allotedNumber = config[selectedIdx].number, 
        config = config 
    })
`;

const DEALLOCATE_SCRIPT = `
    local configKey = KEYS[1]
    local concurrency = tonumber(ARGV[1])
    local targetNumber = ARGV[2]
    local initConfigJson = ARGV[3]

    local function cleanDigits(numStr)
        if not numStr then return "" end
        return string.gsub(tostring(numStr), "%D", "")
    end

    local function matchPhones(a, b)
        if not a or not b or a == "" or b == "" then return false end
        if a == b then return true end
        local da = cleanDigits(a)
        local db = cleanDigits(b)
        if da == db then return true end
        if #da >= 10 and #db >= 10 then
            return string.sub(da, -10) == string.sub(db, -10)
        end
        return false
    end

    local raw = redis.call('GET', configKey)
    local config
    local initConfig = cjson.decode(initConfigJson)

    if raw then
        config = cjson.decode(raw)
        -- Synchronize missing numbers from initConfig into config
        for _, initItem in ipairs(initConfig) do
            local exists = false
            for _, item in ipairs(config) do
                if matchPhones(item.number, initItem.number) then
                    exists = true
                    break
                end
            end
            if not exists then
                table.insert(config, {
                    number = initItem.number,
                    totalCalls = 0,
                    available = true
                })
            end
        end
    else
        config = initConfig
        redis.call('SET', configKey, cjson.encode(config))
        return cjson.encode({ success = true, wasNew = true, config = config })
    end

    local found = false
    for i, item in ipairs(config) do
        if matchPhones(item.number, targetNumber) then
            found = true
            item.totalCalls = math.max(0, item.totalCalls - 1)
            item.available = item.totalCalls < concurrency
            break
        end
    end

    if not found then
        return cjson.encode({ success = false, reason = 'not_found' })
    end

    redis.call('SET', configKey, cjson.encode(config))
    return cjson.encode({ success = true, config = config })
`;

class RedisManager {
  constructor(database, phonePool, perNumberConcurrency) {
    this.redis = redis;
    this.database = database;
    this.phonePool = phonePool;
    this.perNumberConcurrency = perNumberConcurrency;
    this.queueManager = new QueueManager(this.redis, this.database, this);
  }

  async allocateNumber(numberList, concurrency, number, configKey = "numbers-config") {
    //VALIDATION-----------------------------------------
    if (!concurrency) {
      return {
        statusCode: 400,
        success: false,
        message: "Concurrency must be provided.",
        data: null,
      };
    } else {
      if (concurrency <= 0) {
        return {
          statusCode: 400,
          success: false,
          message: "Concurrency must be greater than 0.",
          data: null,
        };
      }
    }

    if (!numberList) {
      return {
        statusCode: 400,
        success: false,
        message: "No number list provided.",
        data: null,
      };
    } else {
      if (numberList.length <= 0) {
        return {
          statusCode: 400,
          success: false,
          message: "No number list provided.",
          data: null,
        };
      }
    }
    //--------------------------------------------------

    const initConfig = JSON.stringify(
      numberList.map((n) => ({
        number: n,
        totalCalls: 0,
        available: true,
      })),
    );

    try {
      const resultRaw = await this.redis.eval(
        ALLOCATE_SCRIPT,
        1,
        configKey,
        concurrency,
        number || "",
        initConfig,
      );

      const parsed = JSON.parse(resultRaw);

      if (!parsed.success) {
        return {
          statusCode: 429,
          success: false,
          message: "All numbers are currently in use.",
          data: {
            allotedNumber: null,
            config: parsed.config ?? null,
          },
        };
      }

      return {
        statusCode: 200,
        success: true,
        message: "Numbers config updated successfully.",
        data: {
          allotedNumber: parsed.allotedNumber,
          config: parsed.config,
        },
      };
    } catch (error) {
      console.error("Error occurred in allocateNumber: ", error.message);

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async deallocateNumber(numberList, concurrency, number, configKey = "numbers-config") {
    //VALIDATION-------------------------------------------
    if (!concurrency) {
      return {
        statusCode: 400,
        success: false,
        message: "Concurrency must be provided.",
        data: null,
      };
    } else {
      if (concurrency <= 0) {
        return {
          statusCode: 400,
          success: false,
          message: "Concurrency must be greater than 0.",
          data: null,
        };
      }
    }

    if (!numberList) {
      return {
        statusCode: 400,
        success: false,
        message: "No number list provided.",
        data: null,
      };
    } else {
      if (numberList.length <= 0) {
        return {
          statusCode: 400,
          success: false,
          message: "No number list provided.",
          data: null,
        };
      }
    }

    if (!number) {
      return {
        statusCode: 400,
        success: false,
        message: "Number to deallocate must be provided.",
        data: null,
      };
    }

    //----------------------------------------------------

    const initConfig = JSON.stringify(
      numberList.map((n) => ({
        number: n,
        totalCalls: 0,
        available: true,
      })),
    );

    try {
      const resultRaw = await this.redis.eval(
        DEALLOCATE_SCRIPT,
        1,
        configKey,
        concurrency,
        number,
        initConfig,
      );

      const parsed = JSON.parse(resultRaw);

      if (!parsed.success) {
        if (parsed.reason === "not_found") {
          return {
            statusCode: 404,
            success: false,
            message: "Provided number not found in configuration.",
            data: null,
          };
        }

        return {
          statusCode: 500,
          success: false,
          message: "Failed to deallocate number.",
          data: null,
        };
      }

      return {
        statusCode: 200,
        success: true,
        message: parsed.wasNew
          ? "Numbers config created and number is already deallocated."
          : "Number deallocated successfully.",
        data: {
          deallocatedNumber: number,
          config: parsed.config,
        },
      };
    } catch (error) {
      console.error("Error occurred in deallocateNumber: ", error.message);

      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error.",
        data: null,
      };
    }
  }

  async processJobScreeningQueue(
    jobDescription,
    phone,
    jobTitle,
    companyName,
    wiraCallId,
    priority = 0,
  ) {
    if (!jobDescription || !phone) {
      return {
        statusCode: 400,
        success: false,
        message: "Missing required parameters.",
        data: null,
      };
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const dateString = `${year}-${month}-${day}`;
    const tenPM = new Date(now);
    tenPM.setHours(22, 0, 0, 0);

    if (now.getTime() > tenPM.getTime()) {
      tenPM.setDate(tenPM.getDate() + 1);
    }

    const ttlSeconds = Math.floor((tenPM.getTime() - now.getTime()) / 1000);

    const jobDescriptionString = JSON.stringify(jobDescription);
    const deduplicationId = require("crypto")
      .createHash("md5")
      .update(jobDescriptionString)
      .digest("hex");

    let maxRetries = 3;
    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        const configKey = `screeningQuestions:${dateString}`;
        await this.redis.watch(configKey);

        let rawData = await this.redis.get(configKey);
        const queueArray = rawData ? JSON.parse(rawData) : [];

        const existingEntryIndex = queueArray.findIndex(
          (item) =>
            JSON.stringify(item.jobDescription) === jobDescriptionString,
        );

        if (existingEntryIndex !== -1) {
          const existingEntry = queueArray[existingEntryIndex];
          if (existingEntry.processing === true) {
            if (!existingEntry.data.some((d) => d.phone === phone)) {
              existingEntry.data.push({ phone, wiraCallId });
            }

            const multi = this.redis.multi();
            multi.set(configKey, JSON.stringify(queueArray), "EX", ttlSeconds);
            const results = await multi.exec();

            if (!results) {
              attempts++;
              continue;
            }

            return {
              statusCode: 200,
              success: true,
              message: "Added phone to existing processing queue.",
              data: null,
            };
          } else {
            await this.redis.unwatch();
            await this.queueManager.pushToCallQueue(
              phone,
              wiraCallId,
              priority,
            );

            return {
              statusCode: 200,
              success: true,
              message:
                "Questions already generated. Pushed directly to call queue.",
              data: null,
            };
          }
        } else {
          const newEntry = {
            jobDescription: jobDescription,
            processing: true,
            questions: [],
            data: [{ phone, wiraCallId }],
          };

          queueArray.push(newEntry);

          const multi = this.redis.multi();
          multi.set(configKey, JSON.stringify(queueArray), "EX", ttlSeconds);
          const results = await multi.exec();

          if (!results) {
            attempts++;
            continue;
          }

          await this.queueManager.pushToQuestionsQueue(
            jobDescription,
            jobTitle,
            companyName,
            deduplicationId,
            priority,
          );

          return {
            statusCode: 200,
            success: true,
            message: "New job description added and pushed to questions queue.",
            data: null,
          };
        }
      } catch (error) {
        await this.redis.unwatch();
        console.error(
          "Error occured processing screening queue entry: ",
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

    return {
      statusCode: 409,
      success: false,
      message: "System busy. Please try again.",
      data: null,
    };
  }
}

module.exports = RedisManager;
