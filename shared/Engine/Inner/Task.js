const axios = require("axios");
const embedder = require("../../Utility/embedding");
const vectorDb = require("../../database/pgFunctions");
const jobsDb = require("../../database/relevantSearchDb");
const wiraDb = require("../../database/WiraDB");
const utility = require("./Utility");
const Session = require("../../Wira/Session");
const oldAI = require("../../AI/executeAI");
const AI = require("../../Wira/AI");

class Task
{
    constructor(phone = null, command = null, data = null, session = null, ai = null)
    {
        this.phone = phone;
        this.command = command;
        this.data = data;

        this.statusCode = null;
        this.success = null;
        this.message = null;
        this.result = null;

        this.commands = 
        [
            {
                command: "fetch-candidate",
                function: this.fetchCandidate,
                schema: null
            },
            {
                command: "fetch-subscription-status",
                function: this.fetchSubscriptionStatus,
                schema: null
            },
            {
                command: "fetch-jobs",
                function: this.fetchJobs,
                schema: 
                {
                    jobIds: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "fetch-applied-status",
                function: this.fetchAppliedStatus,
                schema: 
                {
                    jobIds: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "fetch-wishlist-status",
                function: this.fetchWishlistStatus,
                schema: 
                {
                    jobIds: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "fetch-wishlist",
                function: this.fetchWishlist,
                schema: 
                {
                    perPage: 
                    { 
                        required: false, 
                        type: "number" 
                    },
                    pageNo: 
                    { 
                        required: false, 
                        type: "number" 
                    }
                }
            },
            {
                command: "fetch-applied",
                function: this.fetchApplied,
                schema: 
                {
                    perPage: 
                    { 
                        required: false, 
                        type: "number" 
                    },
                    pageNo: 
                    { 
                        required: false, 
                        type: "number" 
                    }
                }
            },
            {
                command: "fetch-semantic-jobs",
                function: this.fetchSemanticJobs,
                schema: {
                    searchFilters: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            embed: 
                            { 
                                required: true, 
                                type: "string" 
                            },
                            filters: 
                            { 
                                required: false, 
                                type: "object" 
                            },
                            jobIds: 
                            { 
                                required: false, 
                                type: "array" 
                            },
                            perPage: 
                            { 
                                required: false, 
                                type: "number" 
                            },
                            pageNo: 
                            { 
                                required: false, 
                                type: "number" 
                            }
                        }
                    }
                }
            },
            {
                command: "fetch-semantic-wishlist",
                function: this.fetchSemanticWishlist,
                schema: 
                {
                    searchFilters: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            embed: 
                            { 
                                required: true,  
                                type: "string" 
                            },
                            filters: 
                            { 
                                required: false, 
                                type: "object" 
                            },
                            perPage: 
                            { 
                                required: false, 
                                type: "number" 
                            },
                            pageNo:  
                            { 
                                required: false, 
                                type: "number" 
                            }
                        }
                    }
                }
            },
            {
                command: "fetch-semantic-applied",
                function: this.fetchSemanticApplied,
                schema: 
                {
                    searchFilters: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            embed: 
                            { 
                                required: true,  
                                type: "string" 
                            },
                            filters: 
                            { 
                                required: false, 
                                type: "object" 
                            },
                            perPage: 
                            { 
                                required: false, 
                                type: "number" 
                            },
                            pageNo:  
                            { 
                                required: false, 
                                type: "number" 
                            }
                        }
                    }
                }
            },
            {
                command: "fetch-semantic-past",
                function: this.fetchSemanticPast,
                schema: 
                {
                    embed: 
                    { 
                        required: true, 
                        type: "string" 
                    },
                    excludeIds:
                    {
                        required: false,
                        type: "array"
                    },
                    platform:
                    {
                        required: true,
                        type: "string"
                    },
                    threshold:
                    {
                        required: false,
                        type: "number"
                    },
                    limit:
                    {
                        required: false,
                        type: "number"
                    }
                }
            },
            {
                command: "fetch-business-info",
                function: this.fetchBusinessInfo,
                schema: 
                {
                    embed: 
                    { 
                        required: true, 
                        type: "string" 
                    }
                }
            },
            {
                command: "fetch-semantic-files",
                function: this.fetchSemanticFiles,
                schema: 
                {
                    embed:            
                    { 
                        required: true,  
                        type: "string" 
                    },
                    includeFileNames: 
                    { 
                        required: false, 
                        type: "array" 
                    },
                    excludeFileNames: 
                    { 
                        required: false, 
                        type: "array" 
                    }
                }
            },
            {
                command: "fetch-file-content",
                function: this.fetchFileContent,
                schema: 
                {
                    fileNames: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "parse-resume",
                function: this.parseResume,
                schema: 
                {
                    fileName: 
                    { 
                        required: true, 
                        type: "string" 
                    }
                }
            },
            {
                command: "fetch-tests",
                function: this.fetchTests,
                schema: 
                {
                    jobIds: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "generate-test",
                function: this.generateTest,
                schema: 
                {
                    jobId: 
                    { 
                        required: true, 
                        type: "number" 
                    }
                }
            },
            {
                command: "test-store",
                function: this.storeTestAnswer,
                schema: 
                {
                    examiner: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            id:      
                            { 
                                required: true, 
                                type: "number" 
                            },
                            answer:  
                            { 
                                required: true, 
                                type: "string" 
                            },
                            score:   
                            { 
                                required: true, 
                                type: "number" 
                            },
                            skipped: 
                            { 
                                required: true, 
                                type: "boolean" 
                            }
                        }
                    }
                }
            },
            {
                command: "test-end",
                function: this.endTest,
                schema: 
                {
                    examiner: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            interest: 
                            { 
                                required: true, 
                                type: "string", 
                                enum: 
                                [
                                    "HIGH", 
                                    "MEDIUM", 
                                    "LOW"
                                ] 
                            }
                        }
                    }
                }
            },
            {
                command: "fetch-screenings",
                function: this.fetchScreenings,
                schema: 
                {
                    jobIds: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "generate-screening",
                function: this.generateScreening,
                schema: 
                {
                    jobId: 
                    { 
                        required: true, 
                        type: "number" 
                    }
                }
            },
            {
                command: "screening-score",
                function: this.scoreScreening,
                schema: 
                {
                    screening: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            id:      
                            { 
                                required: true, 
                                type: "number" 
                            },
                            answer:  
                            { 
                                required: true, 
                                type: "string" 
                            },
                            score:   
                            { 
                                required: true, 
                                type: "number" 
                            },
                            skipped: 
                            { 
                                required: true, 
                                type: "boolean" 
                            }
                        }
                    }
                }
            },
            {
                command: "screening-end",
                function: this.endScreening,
                schema: 
                {
                    screening: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            interest: 
                            { 
                                required: true, 
                                type: "string", 
                                enum: 
                                [
                                    "HIGH", 
                                    "MEDIUM", 
                                    "LOW"
                                ] 
                            },
                            score:    
                            { 
                                required: true, 
                                type: "number" 
                            }
                        }
                    }
                }
            },
            {
                command: "profile-store",
                function: this.storeProfile,
                schema: 
                {
                    profile: 
                    { 
                        required: true, 
                        type: "object" 
                    }
                }
            },
            {
                command: "profile-end",
                function: this.endProfile,
                schema: null
            },
            {
                command: "create-resume",
                function: this.createResume,
                schema: 
                {
                    resume: 
                    { 
                        required: true, 
                        type: "object" 
                    }
                }
            },
            {
                command: "apply-jobs",
                function: this.applyJobs,
                schema: 
                {
                    jobIds: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "not-interested",
                function: this.notInterested,
                schema: 
                {
                    jobIds: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "update-candidate-wishlist",
                function: this.toggleWishlist,
                schema: 
                {
                    data: 
                    {
                        required: true,
                        type: "array",
                        minLength: 1,
                        items: 
                        {
                            jobId:  
                            { 
                                required: true 
                            },
                            action: 
                            {    
                                required: true, 
                                enum: 
                                [
                                    "add", 
                                    "remove"
                                ] 
                            }
                        }
                    }
                }
            },
            {
                command: "subscribe",
                function: this.subscribe,
                schema: null
            },
            {
                command: "unsubscribe",
                function: this.unsubscribe,
                schema: null
            },
            {
                command: "interview-schedule",
                function: this.interviewResponse,
                schema: 
                {
                    interview: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            jobId:             
                            { 
                                required: true 
                            },
                            status:            
                            { 
                                required: true, 
                                enum: 
                                [
                                    "confirmed", 
                                    "rejected", 
                                    "reschedule-requested"
                                ] 
                            },
                            remark:            
                            { 
                                required: true, 
                                type: "string" 
                            },
                            reason:            
                            { 
                                required: (data) => ["rejected", "reschedule-requested"].includes(data?.interview?.status), 
                                type: "string" 
                            },
                            preferredDate:     
                            { 
                                required: false, 
                                type: "string" 
                            },
                            preferredTimeFrom: 
                            { 
                                required: false, 
                                type: "string" 
                            },
                            preferredTimeTo:   
                            { 
                                required: false, 
                                type: "string" 
                            },
                            preferredMedium:   
                            { 
                                required: false, 
                                enum: 
                                [
                                    "video", 
                                    "telephonic", 
                                    "f2f"
                                ] 
                            }
                        }
                    }
                }
            },
            {
                command: "shortlist-candidate",
                function: this.shortlistCandidate,
                schema: 
                {
                    jobIds: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            },
            {
                command: "reminder-set",
                function: this.setReminder,
                schema: 
                {
                    reminder: 
                    {
                        required: true,
                        type: "object",
                        fields: 
                        {
                            message:  
                            { 
                                required: true, 
                                type: "string" 
                            },
                            datetime: 
                            { 
                                required: true, 
                                type: "string" 
                            }
                        }
                    }
                }
            },
            {
                command: "fetch-skills",
                function: this.fetchSkills,
                schema: 
                {
                    skills: 
                    { 
                        required: true, 
                        type: "array", 
                        minLength: 1 
                    }
                }
            }
        ];

        this.session = session ?? new Session(this.phone);
        this.ai = ai ?? new AI(this.phone, this.session);
    }

    //RETURNS THE PHONE NUMBER OF THE USER.
    getPhone()
    {
        return this.phone
    }

    //RETURNS THE INSTRUCTION COMMAND.
    getCommand()
    {
        return this.command;
    }

    //RETURNS THE INSTRUCTION DATA.
    getInstructionData()
    {
        return this.data;
    }

    //RETURNS THE STATUS CODE.
    getStatusCode()
    {
        return this.statusCode;
    }

    //RETURNS THE SUCCESS STATUS.
    getSuccess()
    {
        return this.success;
    }

    //RETURNS THE MESSAGE.
    getMessage()
    {
        return this.message;
    }

    //RETURNS THE RESULT DATA.
    getResult()
    {
        return this.result;
    }

    //VALIDATING IF ENOUGH FIELDS ARE GIVEN TO PERFORM THE TASK.
    validate()
    {
        //VALIDATING THE SCHEMA
        function validateSchema(schema, data, rootData)
        {
            for(const [field, rules] of Object.entries(schema))
            {
                const value = data?.[field];

                //CHECK REQUIRED — supports boolean or function
                const isRequired = typeof rules.required === "function" ? rules.required(rootData) : rules.required;
                if(isRequired && (value === null || value === undefined))
                {
                    return `${field} is required`;
                }

                //NOT PRESENT AND NOT REQUIRED — SKIP FURTHER CHECKS
                if(value === null || value === undefined)
                {
                    continue;
                }

                //CHECK TYPE
                if(rules.type)
                {
                    if(rules.type === "array" && !Array.isArray(value))
                    {
                        return `${field} must be an array`;
                    }
                    else if(rules.type !== "array" && typeof value !== rules.type)
                    {
                        return `${field} must be of type ${rules.type}`;
                    }
                }

                //CHECK ENUM
                if(rules.enum && !rules.enum.includes(value))
                {
                    return `${field} must be one of: ${rules.enum.join(", ")}`;
                }

                //CHECK MINLENGTH FOR ARRAYS
                if(rules.minLength && Array.isArray(value) && value.length < rules.minLength)
                {
                    return `${field} must have at least ${rules.minLength} item(s)`;
                }

                //CHECK NESTED FIELDS FOR OBJECTS
                if(rules.type === "object" && rules.fields)
                {
                    const nestedError = validateSchema(rules.fields, value, rootData);
                    if(nestedError)
                    {
                        return `${field}.${nestedError}`;
                    }
                }

                //CHECK ITEMS FOR ARRAYS
                if(rules.type === "array" && rules.items && Array.isArray(value))
                {
                    for(let i = 0; i < value.length; i++)
                    {
                        const itemError = validateSchema(rules.items, value[i], rootData);
                        if(itemError)
                        {
                            return `${field}[${i}].${itemError}`;
                        }
                    }
                }
            }

            return null;
        }

        //VALIDATING PHONE NUMBER
        if(this.phone === null)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Phone number is required",
                data: 
                { 
                    phone: this.phone 
                }
            };
        }

        //VALIDATING COMMAND
        if(this.command === null)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Command is required",
                data: 
                { 
                    command: this.command 
                }
            };
        }

        // CHECKING IF COMMAND EXISTS
        const entry = this.commands.find(item => item.command === this.command);
        if(!entry)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Command does not exist",
                data: 
                { 
                    command: this.command 
                }
            };
        }

        //IF NO SCHEMA, NO DATA VALIDATION NEEDED
        if(!entry.schema)
        {
            return {
                statusCode: 200,
                success: true,
                message: "Valid",
                data: null
            };
        }

        //IF SCHEMA EXISTS BUT NO DATA PROVIDED
        if(this.data === null || this.data === undefined)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Instruction data is required for this command",
                data: 
                { 
                    command: this.command, 
                    instructionData: this.data 
                }
            };
        }

        //SCHEMA VALIDATION
        const error = validateSchema(entry.schema, this.data, this.data);
        if(error)
        {
            return {
                statusCode: 400,
                success: false,
                message: error,
                data: 
                { 
                    command: this.command, 
                    instructionData: this.data 
                }
            };
        }

        return {
            statusCode: 200,
            success: true,
            message: "Valid",
            data: null
        };
    }

    //EXECUTES THE COMMAND.
    async execute()
    {
        //RETURNING IF THE COMMAND IS IMPOSSIBLE TO EXECUTE.
        const validation = this.validate();
        if(!validation.success)
        {
            this.statusCode = validation.statusCode;
            this.success = validation.success;
            this.message = validation.message;
            this.result = validation.data;

            return validation;
        }

        //FINDING COMMAND.
        const entry = this.commands.find(item => item.command === this.command);
        const result = await entry.function.call(this);

        this.statusCode = result.statusCode;
        this.success = result.success;
        this.message = result.message;
        this.result = result.data;

        return {
            statusCode: result.statusCode,
            success: result.success,
            message: result.message,
            data: result.data
        };
    }

    //-------------------------------------------------
    //COMMAND FUNCTIONS.
    //-------------------------------------------------

    //FETCHES THE FULL CANDIDATE PROFILE FROM THE CENTRAL SERVER.
    async fetchCandidate()
    {
        //PARSING EXPERIENCE DATA FROM THE RAW DATA IN A SPECIFIC STRUCTURE.
        function parseExperienceData(data) 
        {
            if(data) 
            {
                const parsedData = JSON.parse(data);
                return parsedData.map((exp) => 
                    {
                        return {
                            companyName: exp.company_name,
                            designation: exp.designation,
                            currentSalary: parseFloat(exp.current_salary) || 0,
                            totalExperience: parseFloat(exp.total_experience) || 0,
                            isCurrentCompany: exp.is_current_company,
                            startDate: exp.start_date,
                            endDate: exp.end_date
                        };
                    }
                );
            } 
            else 
            {
                return [];
            }
        }

        //PARSING EDUCATION DATA FROM THE RAW DATA IN A SPECIFIC STRUCTURE.
        function parseEducationData(data) 
        {
            if(data) 
            {
                const parsedData = JSON.parse(data);
                return parsedData.map((edu) => 
                    {
                        return {
                            educationType: edu.education_type,
                            educationName: edu.education_name,
                            graduationYear: parseInt(edu.education_year) || null,
                            university: edu.university,
                            startDate: edu.start_date,
                            endDate: edu.end_date
                        };
                    }
                );
            } 
            else 
            {
                return [];
            }
        }

        try
        {
            //FETCHING THE CANDIDATE'S DATA FROM BOTH THE CENTRAL SERVER FOR THE ACTUAL DATA, WHILE SIMULTANIOUSLY FETHING FROM OUR OWN DATABASE FOR SPECIFIC FIELDS EXCLUSIVE TO OUR DATABASE.. LIKE INFORMATION OF ATS FRIENDLY RESUME.
            const [apiResponse, wiraCandidate] = await Promise.all(
                [
                    axios.post(
                        `https://white-force.com/plus/api/get-profile-data?mobile=${this.phone}`, 
                        {}, 
                        {
                            headers: 
                            {
                                "x-api-key": process.env.WIRA_API_KEY,
                            },
                        }
                    ),
                    wiraDb.fetchWiraCandidates(
                        { 
                            phone: this.phone 
                        }
                    ).catch(() => 
                        {
                            return null;
                        }
                    )
                ]
            );
            
            //THE LINK TO CANDIDATE'S ATS FRIENDLY RESUME WE CREATED, JUST TO MAKE SURE WE DON'T RECREATE IT.
            const atsResume = wiraCandidate?.rows?.[0]?.atsResume ?? null;
            
            //CHECKING IF THE CENTRAL SERVER RESPONDED WITH DATA.
            if(apiResponse.data.status)
            {
                //STRUCTURING THE CANDIDATE'S DATA TO MATCH OUR REQUIRED FORMAT.
                const d = apiResponse.data.data;
                const data = 
                {
                    candidateId: d.id ?? null,
                    resume: d.resume_file ?? null,
                    atsResume: atsResume ?? null,
                    resumeParserJson: d.resume_parser_json ?? null,
                    fullName: d.name ?? null,
                    phone: d.mobile ?? this.phone,
                    email: d.email ?? null,
                    preferredLocation: d.preferred_location ?? null,
                    noticePeriod: d.notice_period ?? null,
                    industry: d.industry ?? null,
                    expectedSalary: d.expected_salary ?? null,
                    experience: d.experience ?? null,
                    totalExperience: utility.formatExperience(d.total_experience ?? null),
                    experienceData: d.experience_details ? parseExperienceData(d.experience_details) : null,
                    educationData: d.education_details ? parseEducationData(d.education_details) : null,
                    gender: d.gender ?? null,
                    maritalStatus: d.marital_status ?? null,
                    relocate: d.is_relocate ?? null,
                    language: d.languages ? d.languages.split(",").map(l => l.trim()) : null,
                    communication: d.communication ?? null,
                    dateOfBirth: d.date_of_birth ?? null,
                    skills: d.skills ? d.skills.split(",").map(s => s.trim()) : [],
                    country: d.country ?? null,
                    state: d.state ?? null,
                    city: d.city ?? null,
                    address: d.address ?? null,
                    postelCode: d.pin_code ?? null,
                };
            
                //RETURNING THE DATA IF THE CENTRAL SERVER RESPONDED WITH DATA.
                return {
                    statusCode: 200,
                    success: true,
                    message: apiResponse.data.message,
                    data: data
                };
            }
            else
            {
                //RETURNING AN ERROR IF THE CENTRAL SERVER FAILED TO RESPOND.
                return {
                    statusCode: 400,
                    success: false,
                    message: apiResponse.data.message,
                    data: null
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while fetching candidate in Task class fetchCandidate", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch candidate",
                data: null
            };
        }
    }

    //CHECKS WHETHER THE CANDIDATE IS SUBSCRIBED TO PERIODIC JOB RECOMMENDATIONS.
    async fetchSubscriptionStatus()
    {
        try
        {
            //FETCHING THE SUBSCRIPTION STATUS OF THE CANDIDATE FROM THE CENTRAL SERVER.
            const response = await axios.post(
                `https://white-force.com/plus/api/subscription-status`,
                {
                    mobile: this.phone,
                },
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
            
            //CHECKING IF THE CENTRAL SERVER RESPONDED WITH DATA.
            if(response.data.status) 
            {
                //RETURNING THE DATA IF THE CENTRAL SERVER RESPONDED WITH DATA.
                return {
                    statusCode: 200,
                    success: true,
                    message: "Subscription status fetched successfully.",
                    data: 
                    {
                        isSubscribed: response.data.data.subscribed,
                    },
                };
            } 
            else 
            {
                //RETURNING AN ERROR IF THE CENTRAL SERVER FAILED TO RESPOND.
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error fetching subscription status.",
                    data: null,
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while fetching subscription status in Task class fetchSubscriptionStatus", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch subscription status",
                data: null
            };
        }
    }

    //FETCHES FULL DETAILS OF ONE OR MORE SPECIFIC JOBS BY THEIR IDS.
    async fetchJobs()
    {
        try
        {
            const response = await axios.post(
                `https://white-force.com/plus/api/jobs-by-ids`, 
                { 
                    job_id: this.data.jobIds 
                }, 
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
            
            //CHECKING IF THE CENTRAL SERVER RESPONDED WITH DATA.
            if(response.data.status)
            {
                //RETURNING THE DATA IF THE CENTRAL SERVER RESPONDED WITH DATA.
                if(response.data.data && response.data.data.length > 0)
                {
                    //MAPPING THE DATA TO THE REQUIRED FORMAT.
                    const jobs = response.data.data.map((item, index) => 
                        {
                            return {
                                id: item.id,
                                clientId: item.client_id,
                                clientName: item.clientname,
                                positionName: item.position_name,
                                openings: item.openings,
                                country: item.countries,
                                countryCode: item.country_code,
                                state: item.states,
                                city: item.city,
                                location: item.locations,
                                jobAddress: item.job_address,
                                postalCode: item.postal_code,
                                jobDescription: item.job_description,
                                skillSet: item.skill_set ? item.skill_set.split(",").map(s => s.trim()) : [],
                                minYearExp: item.min_year_exp,
                                maxYearExp: item.max_year_exp,
                                eduQualification: item.edu_qualification,
                                specification: item.specification ? item.specification.split(",").map(s => s.trim()).filter(Boolean) : [],
                                salaryType: item.salary_type,
                                payType: item.pay_type,
                                minSalary: item.min_salary,
                                maxSalary: item.max_salary,
                                jobType: item.job_type,
                                isRemoteWork: !!item.is_remote_work,
                                industry: item.industry,
                                gender: item.gender,
                                contactPersonName: item.contact_person_name,
                                personContact: item.person_contact,
                                personEmail: item.person_email,
                                jdJson: item.jd_json ? JSON.parse(item.jd_json) : null
                            };
                        }
                    );
            
                    //CHECKING IF THE CANDIDATE HAS ANY WISHLISTED OR APPLIED JOBS.
                    if(this.phone)
                    {
                        //FETCHING THE CANDIDATE'S SESSION DATA.
                        const session = await this.session.getSession();
                        const wishlistIds = (session && session.wishlistIds.length > 0) ? session.wishlistIds : null;
                        const appliedJobIds = (session && session.appliedJobIds.length > 0) ? session.appliedJobIds : null;
            
                        //CHECKING IF THE FETCHED JOBS ARE WISHLISTED OR APPLIED TO BY THE CANDIDATE.
                        jobs.forEach((job) =>
                            {
                                //CHECKING IF THE JOB IS WISHLISTED BY THE CANDIDATE.
                                if(wishlistIds !== null)
                                {
                                    job.isWishlisted = wishlistIds.includes(job.id);
                                }
            
                                //CHECKING IF THE JOB IS APPLIED BY THE CANDIDATE.
                                if(appliedJobIds !== null)
                                {
                                    job.isApplied = appliedJobIds.includes(job.id);
                                }
                            }
                        );
                    }

                    //RETURNING THE DATA IF THE CENTRAL SERVER RESPONDED WITH DATA.
                    return {
                        statusCode: 200,
                        success: true,
                        message: "Jobs retrieved successfully.",
                        data: { 
                            jobs: jobs
                        }
                    };
                }
                else
                {
                    //RETURNING AN ERROR IF THE CENTRAL SERVER FAILED TO RESPOND.
                    return {
                        statusCode: 404,
                        success: false,
                        message: "Jobs not found.",
                        data: null
                    };
                }
            }
        }
        catch(error)
        {
            console.log("Error occured while fetching jobs in Task class fetchJobs", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch jobs",
                data: null
            };
        }
    }

    //FETCHES THE PIPELINE STATUS OF ONE OR MORE SPECIFIC APPLIED JOBS.
    async fetchAppliedStatus()
    {
        try
        {
            const response = await axios.post(
                `https://white-force.com/plus/api/candidate-application-status`, 
                {
                    mobile: this.phone,
                    job_id: this.data.jobIds  
                }, 
                {   
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
        
            if(response.data.status)
            {
                if(response.data.data && response.data.data.length > 0)
                {
                    const statuses = response.data.data.map((item) =>
                        {
                            const pipelineData = item.pipeline_data;
    
                            return {
                                id: item.id,
                                status: item.status,
                                pipelineData: pipelineData ? {
                                    id: pipelineData.id,
                                    positionId: pipelineData.position_id,
                                    stage: pipelineData.stage,
                                    updatedAt: pipelineData.updated_at,
                                    interviewDate: pipelineData.interview_date,
                                    interviewTimeFrom: pipelineData.interview_time_from,
                                    interviewTimeTo: pipelineData.interview_time_to,
                                    interviewVenue: pipelineData.interview_venue,
                                    interviewStage: pipelineData.interview_stage,
                                    joiningDate: pipelineData.joining_date,
                                    isJoined: pipelineData.is_joined
                                } : null
                            };        
                        }
                    );
        
                    return {
                        statusCode: 200,
                        success: true,
                        message: response.data.message,
                        data: 
                        {
                            statuses: statuses
                        }
                    };
                }
                else
                {
                    return {
                        statusCode: 400,
                        success: false,
                        message: "No job statuses found.",
                        data: null
                    };
                }
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured fetching job statuses.",
                    data: null
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while fetching applied status in Task class fetchAppliedStatus", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch applied status",
                data: null
            };
        }
    }

    //CHECKS WHETHER SPECIFIC JOBS ARE WISHLISTED OR APPLIED TO BY THE CANDIDATE.
    async fetchWishlistStatus()
    {
        try
        {
            const session = await this.session.getSession();
            if(session)
            {
                const wishlistIds = session.wishlistIds ?? [];
                const appliedJobIds = session.appliedJobIds ?? [];
            
                return {
                    statusCode: 200,
                    success: true,
                    message: "Fetched isWishlisted/isApplied successfully.",
                    data: this.data.jobIds.map((id) => 
                        {
                            return {
                                id: id,
                                isWishlisted: wishlistIds.includes(id),
                                isApplied: appliedJobIds.includes(id)
                            }
                        }
                    )
                };
            }
            
            const response = await axios.post(
                `https://white-force.com/plus/api/wish-list-status`, 
                {
                    mobile: this.phone,
                    job_id: this.data.jobIds  
                }, 
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
            
            if(response.data.status)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Fetched isWishlisted/isApplied successfully.",
                    data: response.data.data
                };
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured fetching isWishlisted/isApplied",
                    data: null
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while fetching wishlist status in Task class fetchWishlistStatus", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch wishlist status",
                data: null
            };
        }
    }

    //FETCHES ALL OF THE CANDIDATE'S WISHLISTED JOBS WITH NO SEARCH QUERY.
    async fetchWishlist()
    {
        try
        {
            const requests = [];
            const session = await this.session.getSession();

            if(!this.data.pageNo)
            {
                this.data.pageNo = 1;
            }

            if(!this.data.perPage)
            {
                this.data.perPage = 10;
            }

            requests.push(
                axios.post(
                    `https://white-force.com/plus/api/get-candidate-wishlist?mobile=${this.phone}&per_page=${this.data.perPage}&page=${this.data.pageNo}`, 
                    {},
                    {
                        headers: 
                        {
                            "x-api-key": process.env.WIRA_API_KEY,
                        },
                    }
                )
            );
            
            if(session.wishlistIds && session.wishlistIds.length > 0)
            {
                const start = (this.data.pageNo - 1) * this.data.perPage;
                const pagedIds = session.wishlistIds.slice(start, start + this.data.perPage);

                if(pagedIds.length > 0)
                {
                    requests.push(
                        this.fetchJobs(pagedIds, this.phone).then((result) =>
                            {
                                if(result.success)
                                {
                                    return { 
                                        source: "fetchJobs", 
                                        ...result 
                                    };
                                }
            
                                return Promise.reject("fetchJobs failed");
                            }
                        )
                    );
                }
            }
            
            const winner = await Promise.any(requests.map((request) =>
                {
                    return Promise.resolve(request).then((response) =>
                        {
                            if(response && response.source === "fetchJobs")
                            {
                                return response;
                            }
            
                            if(response && response.data && response.data.status)
                            {
                                return { 
                                    source: "api", 
                                    ...response 
                                };
                            }
            
                            return Promise.reject("Request failed or invalid");
                        }
                    );  
                }
            ));
                            
            
            if(winner.source === "fetchJobs")
            {
                const jobs = winner.data.jobs;
                const appliedJobIds = (session && session.appliedJobIds.length > 0) ? session.appliedJobIds : null;
            
                jobs.forEach((job) =>
                    {
                        job.isWishlisted = true;
            
                        if(appliedJobIds !== null)
                        {
                            job.isApplied = appliedJobIds.includes(job.id);
                        }
                    }
                );
            
                return {
                    statusCode: 200,
                    success: true,
                    message: "Wishlisted jobs retrieved successfully.",
                    data: 
                    {
                        jobs: jobs,
                        pagination: 
                        {
                            currentPage: this.data.pageNo,
                            lastPage: Math.ceil(session.wishlistIds.length / this.data.perPage),
                            perPage: this.data.perPage,
                            total: session.wishlistIds.length
                        }
                    }
                };
            }
            
            const response = winner;
            if(response.data && response.data.data && response.data.data.length > 0)
            {
                const jobs = response.data.data.map((item, index) =>
                    {
                        return {
                            id: item.id,
                            clientId: item.client_id,
                            clientName: item.clientname,
                            positionName: item.position_name,
                            openings: item.openings,
                            country: item.countries,
                            countryCode: item.country_code,
                            state: item.states,
                            city: item.city,
                            location: item.locations,
                            jobAddress: item.job_address,
                            postalCode: item.postal_code,
                            jobDescription: item.job_description,
                            skillSet: item.skill_set ? item.skill_set.split(",").map(s => s.trim()) : [],
                            minYearExp: item.min_year_exp,
                            maxYearExp: item.max_year_exp,
                            eduQualification: item.edu_qualification,
                            specification: item.specification ? item.specification.split(",").map(s => s.trim()).filter(Boolean) : [],
                            salaryType: item.salary_type,
                            payType: item.pay_type,
                            minSalary: item.min_salary,
                            maxSalary: item.max_salary,
                            jobType: item.job_type,
                            isRemoteWork: !!item.is_remote_work,
                            industry: item.industry,
                            gender: item.gender,
                            contactPersonName: item.contact_person_name,
                            personContact: item.person_contact,
                            personEmail: item.person_email,
                            jdJson: item.jd_json ? JSON.parse(item.jd_json) : null
                        };
                    }
                );
            
                const appliedJobIds = (session && session.appliedJobIds.length > 0) ? session.appliedJobIds : null;
            
                jobs.forEach((job) =>
                    {
                        job.isWishlisted = true;
            
                        if(appliedJobIds !== null)
                        {
                            job.isApplied = appliedJobIds.includes(job.id);
                        }
                    }
                );
            
                return {
                    statusCode: 200,
                    success: true,
                    message: response.data.message,
                    data: 
                    {
                        jobs: jobs,
                        pagination: 
                        {
                            currentPage: response.data.pagination.current_page,
                            lastPage: response.data.pagination.last_page,
                            perPage: response.data.pagination.per_page,
                            total: response.data.pagination.total
                        }
                    }
                };
            }
            else
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "No wishlisted jobs found.",
                    data: null
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while fetching wishlist in Task class fetchWishlist", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch wishlist",
                data: null
            };
        }
    }

    //FETCHES ALL OF THE CANDIDATE'S APPLIED JOBS WITH NO SEARCH QUERY.
    async fetchApplied()
    {
        function deriveStatus(item)
        {
            if(!item.pipeline_data)
            {
                return "applied";
            }

            if(item.pipeline_data.is_joined)
            {
                return "joined";
            }

            if(item.pipeline_data.stage)
            {
                return item.pipeline_data.stage.toLowerCase();
            }

            return "applied";
        }

        try
        {
            const requests = [];
            const session = await this.session.getSession();
            
            requests.push(
                axios.get(
                    `https://white-force.com/plus/api/candidate-applied-jobs?mobile=${this.phone}&per_page=${this.data.perPage}&page=${this.data.pageNo}`, 
                    {
                        headers: 
                        {
                            "x-api-key": process.env.WIRA_API_KEY,
                        },
                    }
                )
            );
            
            if(session && session.appliedJobIds.length > 0)
            {
                const start = (this.data.pageNo - 1) * this.data.perPage;
                const pagedIds = session.appliedJobIds.slice(start, start + this.data.perPage);
            
                if(pagedIds.length > 0)
                {
                    requests.push(this.fetchJobs(pagedIds, this.phone).then((result) => 
                        {
                            if(result.success)
                            {
                                return { 
                                    source: "fetchJobs", 
                                    ...result 
                                };
                            }
            
                            return Promise.reject("fetchJobs failed");
                        }
                    ));
                }
            }
            
            const winner = await Promise.any(requests.map((request) =>
                {
                    return Promise.resolve(request).then((response) =>
                        {
                            if(response && response.source === "fetchJobs")
                            {
                                return response;
                            }
            
                            if(response && response.data && response.data.status)
                            {
                                return { 
                                    source: "api", 
                                    ...response 
                                };
                            }
            
                            return Promise.reject("Request failed or invalid");
                        }
                    );
                }
            ));
            
            if(winner.source === "fetchJobs")
            {
                const jobs = winner.data.jobs;
                const wishlistIds = (session && session.wishlistIds.length > 0) ? session.wishlistIds : null;
            
                jobs.forEach((job) =>
                    {
                        job.isApplied = true;
            
                        if(wishlistIds !== null)
                        {
                            job.isWishlisted = wishlistIds.includes(job.id);
                        }
                    }
                );
            
                return {
                    statusCode: 200,
                    success: true,
                    message: "Applied jobs retrieved successfully.",            
                    data:
                    {
                        jobs: jobs,
                        pagination: 
                        {
                            currentPage: this.data.pageNo,
                            lastPage: Math.ceil(session.appliedJobIds.length / this.data.perPage),
                            perPage: this.data.perPage,
                            total: session.appliedJobIds.length
                        }
                    }
                };
            }
            
            const response = winner;
            if(response.data && response.data.data && response.data.data.length > 0)
            {
                const jobs = response.data.data.map((item) =>
                    {
                        const pipelineData = item.pipeline_data;
            
                        return {
                            id: item.job_id,
                            clientId: item.position_details.client_id,
                            clientName: item.position_details.clientname,
                            positionName: item.position_details.position_name,
                            openings: item.position_details.openings,
                            country: item.position_details.countries,
                            countryCode: item.position_details.country_code,
                            state: item.position_details.states,
                            city: item.position_details.city,
                            location: item.position_details.locations,
                            jobAddress: item.position_details.job_address,
                            postalCode: item.position_details.postal_code,
                            jobDescription: item.position_details.job_description,
                            skillSet: item.position_details.skill_set ? item.position_details.skill_set.split(",").map(s => s.trim()) : [],
                            minYearExp: item.position_details.min_year_exp,
                            maxYearExp: item.position_details.max_year_exp,
                            eduQualification: item.position_details.edu_qualification,
                            specification: item.position_details.specification ? item.position_details.specification.split(",").map(s => s.trim()).filter(Boolean) : [],
                            salaryType: item.position_details.salary_type,
                            payType: item.position_details.pay_type,
                            minSalary: item.position_details.min_salary,
                            maxSalary: item.position_details.max_salary,
                            jobType: item.position_details.job_type,
                            isRemoteWork: !!item.position_details.is_remote_work,
                            industry: item.position_details.industry,
                            gender: item.position_details.gender,
                            contactPersonName: item.position_details.contact_person_name,
                            personContact: item.position_details.person_contact,
                            personEmail: item.position_details.person_email,
                            jdJson: item.position_details.jd_json ? JSON.parse(item.position_details.jd_json) : null,
                            status: deriveStatus(item),
                            pipelineData: pipelineData ? {
                                id: pipelineData.id,
                                positionId: pipelineData.position_id,
                                stage: pipelineData.stage,
                                updatedAt: pipelineData.updated_at,
                                interviewDate: pipelineData.interview_date,
                                interviewTimeFrom: pipelineData.interview_time_from,
                                interviewTimeTo: pipelineData.interview_time_to,
                                interviewVenue: pipelineData.interview_venue,
                                interviewStage: pipelineData.interview_stage,
                                joiningDate: pipelineData.joining_date,
                                isJoined: pipelineData.is_joined
                            } : null
                        };
                    }
                );
            
                const wishlistIds = (session && session.wishlistIds.length > 0) ? session.wishlistIds : null;
            
                jobs.forEach((job) =>
                    {
                        job.isApplied = true;
            
                        if(wishlistIds !== null)
                        {
                            job.isWishlisted = wishlistIds.includes(job.id);
                        }
                    }
                );
            
                return {
                    statusCode: 200,
                    success: true,
                    message: response.data.message,
                    data: 
                    {
                        jobs: jobs,
                        pagination: 
                        {
                            currentPage: response.data.pagination.current_page,
                            lastPage: response.data.pagination.last_page,
                            perPage: response.data.pagination.per_page,
                            total: response.data.pagination.total
                        }
                    }
                };
            }
            else
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "No applied jobs found.",
                    data: null
                };
            }
        } 
        catch(error)
        {
            console.log("Error occured while fetching applied jobs in Task class fetchApplied", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch applied jobs",
                data: null
            };
        }
    }

    //RUNS A SEMANTIC SEARCH FOR JOBS MATCHING THE CANDIDATE'S QUERY OR PROFILE.
    async fetchSemanticJobs()
    {
        try
        {
            if(!this.data.searchFilters.filters)
            {
                this.data.searchFilters.filters = {};
            }

            if(!this.data.searchFilters.jobIds)
            {
                this.data.searchFilters.jobIds = [];
            }

            if(!this.data.searchFilters.perPage)
            {
                this.data.searchFilters.perPage = 10;
            }

            if(!this.data.searchFilters.pageNo)
            {
                this.data.searchFilters.pageNo = 1;
            }

            let embedding = await embedder.getEmbedding(this.data.searchFilters.embed);
            if(!embedding)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to generate embedding.",
                    data: null
                };
            }
            
            const offset = (this.data.searchFilters.pageNo - 1) * this.data.searchFilters.perPage;
            const result = await jobsDb.searchJobs(embedding, this.data.searchFilters.perPage, offset, 30, this.data.searchFilters.filters, this.data.searchFilters.jobIds);
            
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "No matching jobs found.",
                    data: null
                };
            }
            
            const jobIdResults = result.rows.map(j => j.id);
            const jobData = await this.fetchJobs(jobIdResults, this.data.phone);
            
            if(!jobData.success)
            {
                return jobData;
            }
            
            const similarityMap = new Map(
                result.rows.map((job) => 
                    {
                        return [
                            job.id, 
                            { 
                                similarity: job.similarity, 
                                rawSimilarity: job.rawSimilarity 
                            }
                        ];
                    }
                )
            );
            
            const jobs = jobData.data.jobs.map((item) => 
                {
                    const sim = similarityMap.get(item.id) || {};
            
                    return {
                        id: item.id,
                        clientId: item.clientId,
                        clientName: item.clientName,
                        positionName: item.positionName,
                        openings: item.openings,
                        country: item.country,
                        countryCode: item.countryCode,
                        state: item.state,
                        city: item.city,
                        location: item.location,
                        jobAddress: item.jobAddress,
                        postalCode: item.postalCode,
                        jobDescription: item.jobDescription,
                        skillSet: item.skillSet,
                        minYearExp: item.minYearExp,
                        maxYearExp: item.maxYearExp,
                        eduQualification: item.eduQualification,
                        specification: item.specification,
                        salaryType: item.salaryType,
                        payType: item.payType,
                        minSalary: item.minSalary,
                        maxSalary: item.maxSalary,
                        jobType: item.jobType,
                        isRemoteWork: item.isRemoteWork,
                        industry: item.industry,
                        gender: item.gender,
                        contactPersonName: item.contactPersonName,
                        personContact: item.personContact,
                        personEmail: item.personEmail,
                        jdJson: item.jdJson,
                        similarity: sim.similarity || null,
                        rawSimilarity: sim.rawSimilarity || null
                    };
                }
            );
            
            const lastPage = Math.ceil(result.total / this.data.searchFilters.perPage);
            
            return {
                statusCode: 200,
                success: true,
                message: "Semantic job search completed successfully.",
                data: 
                {
                    jobs: jobs,
                    pagination: 
                    {
                        currentPage: this.data.searchFilters.pageNo,
                        lastPage: lastPage,
                        perPage: this.data.searchFilters.perPage,
                        total: result.total
                    }
                }
            };
        }
        catch(error)
        {
            console.log("Error occured while fetching semantic jobs in Task class fetchSemanticJobs", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch semantic jobs",
                data: null
            };
        }
    }

    //SEMANTICALLY SEARCHES WITHIN THE CANDIDATE'S WISHLISTED JOBS.
    async fetchSemanticWishlist()
    {
        try
        {
            if(!this.data.searchFilters.filters)
            {
                this.data.searchFilters.filters = {};
            }

            if(!this.data.searchFilters.jobIds)
            {
                this.data.searchFilters.jobIds = [];
            }

            if(!this.data.searchFilters.perPage)
            {
                this.data.searchFilters.perPage = 10;
            }

            if(!this.data.searchFilters.pageNo)
            {
                this.data.searchFilters.pageNo = 1;
            }

            let wishlistIds = null;
            
            const session = await this.session.getSession(phone);
            if(session && session.wishlistIds && session.wishlistIds.length > 0)
            {
                wishlistIds = session.wishlistIds;
            }
            else
            {
                const response = await axios.post(
                    "https://white-force.com/plus/api/candidate-wishlist-ids", 
                    {
                        mobile: this.phone
                    }, 
                    {
                        headers: 
                        {
                            "x-api-key": process.env.WIRA_API_KEY,
                        },
                    }
                );
            
                if(!response.data.status || !response.data.data || response.data.data.length === 0)
                {
                    return {
                        statusCode: 400,
                        success: false,
                        message: "No wishlisted jobs found.",
                        data: null
                    };
                }
            
                wishlistIds = response.data.data;
            }
            
            const result = await this.fetchSemanticJobs(this.data.query, this.data.searchFilters.filters, wishlistIds, this.data.searchFilters.perPage, this.data.searchFilters.pageNo, this.data.phone);
            if(!result.success)
            {
                return result;
            }
            
            return {
                ...result,
                message: "Semantic wishlist fetched successfully.",
            };
        }
        catch(error)
        {
            console.log("Error occured while fetching semantic wishlist in Task class fetchSemanticWishlist", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch semantic wishlist",
                data: null
            };
        }
    }

    //SEMANTICALLY SEARCHES WITHIN THE CANDIDATE'S APPLIED JOBS.
    async fetchSemanticApplied()
    {
        try
        {
            if(!this.data.searchFilters.filters)
            {
                this.data.searchFilters.filters = {};
            }

            if(!this.data.searchFilters.jobIds)
            {
                this.data.searchFilters.jobIds = [];
            }

            if(!this.data.searchFilters.perPage)
            {
                this.data.searchFilters.perPage = 10;
            }

            if(!this.data.searchFilters.pageNo)
            {
                this.data.searchFilters.pageNo = 1;
            }

            let appliedIds = null;
            
            const session = await this.session.getSession();
            if(session && session.appliedJobIds && session.appliedJobIds.length > 0)
            {
                appliedIds = session.appliedJobIds;
            }
            else
            {
                const response = await axios.post(
                    "https://white-force.com/plus/api/candidate-applied-ids", 
                    {
                        mobile: this.phone
                    }, 
                    {
                        headers: 
                        {
                            "x-api-key": process.env.WIRA_API_KEY,
                        },
                    }
                );
            
                if(!response.data.status || !response.data.data || response.data.data.length === 0)
                {
                    return {
                        statusCode: 400,
                        success: false,
                        message: "No applied jobs found.",
                        data: null
                    };
                }
            
                appliedIds = response.data.data;
            }
            
            const result = await this.fetchSemanticJobs(this.data.query, this.data.searchFilters.filters, appliedIds, this.data.searchFilters.perPage, this.data.searchFilters.pageNo, this.phone);
            if(!result.success)
            {
                return result;
            }
            
            const returnedJobIds = result.data.jobs.map(job => job.id);
            const statusResult = await this.fetchJobStatus(this.phone, returnedJobIds);
            const statusMap = new Map();
            
            if(statusResult.success)
            {
                statusResult.data.statuses.forEach(s => statusMap.set(s.id, s));
            }
            
            const jobs = result.data.jobs.map((job) =>
                {
                    const statusEntry = statusMap.get(job.id);
            
                    return {
                        ...job,
                        status: statusEntry ? statusEntry.status : null,
                        pipelineData: statusEntry ? statusEntry.pipelineData : null
                    };
                }
            );
            
            return {
                statusCode: 200,
                success: true,
                message: "Semantic applied jobs fetched successfully.",
                data: 
                {
                    jobs: jobs,
                    pagination: result.data.pagination
                }
            };
        }
        catch(error)
        {
            console.log("Error occured while fetching semantic applied jobs in Task class fetchSemanticApplied", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch semantic applied jobs",
                data: null
            };
        }
    }

    //SEMANTICALLY SEARCHES PAST MESSAGES AND CALL SUMMARIES ACROSS ALL PLATFORMS.
    async fetchSemanticPast()
    {
        try
        {
            if(!this.data.excludeIds)
            {
                this.data.excludeIds = [];
            }
            
            if(!this.data.platform)
            {
                this.data.platform = "App";
            }
            
            if(!this.data.threshold)
            {
                this.data.threshold = 30;
            }
            
            if(!this.data.limit)
            {
                this.data.limit = 5;
            }

            const candidateResult = await wiraDb.fetchWiraCandidates(
                { 
                    phone: this.phone 
                }
            );

            if(!candidateResult || candidateResult.total === 0)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "Candidate not found",
                    data: null
                };
            }
            
            const candidate = candidateResult.rows[0];
            const embedding = await embedder.getEmbedding(this.data.embed);
            const searchPromises = [];

            const appSessionResult = await wiraDb.fetchWiraApps(
                { 
                    wiraCandidateId: candidate.id 
                }, 
                1, 
                1
            );

            const appSession = appSessionResult?.rows?.[0] ?? null;
            if(appSession)
            {
                searchPromises.push(
                    wiraDb.semanticSearchWiraAppMessages(
                        embedding, 
                        this.data.threshold, 
                        1, 
                        this.data.limit, 
                        {
                            wiraAppId: appSession.id,
                            excludeIds: (this.data.platform === "App" || this.data.platform === "Web") ? this.data.excludeIds : []
                        }
                    )
                    .then(result => (result?.rows ?? []).map((row) => 
                        {
                            return { 
                                ...row, 
                                source: "App" 
                            };
                        }
                    ))
                );  
            }
            
            if(candidate.hasWhatsapp)
            {
                const whatsappResult = await wiraDb.fetchWiraWhatsapps(
                    { 
                        wiraCandidateId: candidate.id 
                    }, 
                    1, 
                    1
                );

                const whatsappSession = whatsappResult?.rows?.[0] ?? null;
                if(whatsappSession)
                {
                    searchPromises.push(
                        wiraDb.semanticSearchWiraWhatsappMessages(
                            embedding, 
                            this.data.threshold, 
                            1, 
                            this.data.limit, 
                            {
                                wiraWhatsappId: whatsappSession.id,
                                excludeIds: this.data.platform === "Whatsapp" ? this.data.excludeIds : []
                            }
                        )
                        .then(result => (result?.rows ?? []).map((row) => 
                            {
                                return { 
                                    ...row, 
                                    source: "Whatsapp" 
                                };
                            }
                        ))
                    );
                }
            }
            
            if(candidate.hasCall)
            {  
                searchPromises.push(
                    wiraDb.semanticSearchWiraCalls(
                        embedding, 
                        this.data.threshold, 
                        1, 
                        this.data.limit, 
                        {
                            wiraCandidateId: candidate.id
                        }
                    )
                    .then(result => (result?.rows ?? []).map((row) => 
                        {
                            return { 
                                ...row, 
                                source: "Call" 
                            };
                        }
                    ))
                );
            }
            
            const searchResults = await Promise.all(searchPromises);
            const merged = searchResults.flat();
            merged.sort((a, b) => b.similarity - a.similarity);
            const results = merged.slice(0, this.data.limit);

            return {
                statusCode: 200,
                success: true,
                message: "Semantic message search completed successfully.",
                data: results ?? []
            };
        }
        catch(error)
        {
            console.log("Error occured while fetching semantic past in Task class fetchSemanticPast", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch semantic past",
                data: null
            };
        }
    }

    //FETCHES RELEVANT CHUNKS FROM THE COMPANY KNOWLEDGE BASE.
    async fetchBusinessInfo()
    {
        try
        {
            let embedding = await embedder.getEmbedding(this.data.embed);
            
            if(!embedding) 
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to generate embedding.",
                    data: null,
                };
            }
            
            const results = await vectorDb.searchCompanyData(embedding, 5);
            
            return {
                statusCode: 200,
                success: true,
                message: "Relevant chunks fetched successfully.",
                data: results,
            };
        }
        catch(error)
        {
            console.log("Error occured while fetching business info in Task class fetchBusinessInfo", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch business info",
                data: null
            };
        }
    }

    //SEMANTICALLY SEARCHES THE CANDIDATE'S UPLOADED FILES.
    async fetchSemanticFiles()
    {
        try
        {
            const embedResult = await oldAI.runWiraEmbedChunks(
                {
                    chunks: [this.data.embed],
                    taskType: "RETRIEVAL_QUERY",
                    outputDimensionality: 1536
                }
            );
            
            if(!embedResult || !embedResult.vectors || embedResult.vectors.length === 0)
            {
                return null;
            }
            
            const embedding = `[${embedResult.vectors[0].join(",")}]`;
            const filters = 
            {
                excludeFileNames: this.data.excludeFileNames.length > 0 ? this.data.excludeFileNames : null,
                includeFileNames: this.data.includeFileNames.length > 0 ? this.data.includeFileNames : null
            };
            
            const searchResult = await wiraDb.semanticSearchWiraFileChunks(
                embedding,
                this.data.threshold,
                1,
                this.data.limit,
                filters
            );
            
            if(!searchResult || searchResult.total === 0)
            {
                return [];
            }

            return {
                statusCode: 200,
                success: true,
                message: "Semantic file search completed successfully.",
                data: searchResult.rows ?? []
            };
        }
        catch(error)
        {
            console.log("Error occured while fetching semantic files in Task class fetchSemanticFiles", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch semantic files",
                data: null
            };
        }
    }

    //FETCHES THE FULL CONTENT OF ONE OR MORE SPECIFIC FILES BY NAME.
    async fetchFileContent()
    {
        try
        {
            if(!this.data.fileNames || this.data.fileNames.length === 0)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "No file names provided.",
                    data: null
                };
            }

            const results = await Promise.all(this.data.fileNames.map(async (fileName) =>
                {
                    try
                    {
                        const fileResult = await wiraDb.fetchWiraFiles(
                            { 
                                fileName: fileName, 
                                extracted: true 
                            }, 
                            1, 
                            1
                        );

                        if(!fileResult || fileResult.total === 0)
                        {
                            return { 
                                fileName: fileName, 
                                transcript: null 
                            };
                        }

                        const file = fileResult.rows[0];
                        if(!file.extracted || !file.chunkCount || file.chunkCount === 0)
                        {
                            return { 
                                fileName: fileName, 
                                transcript: null 
                            };
                        }

                        const chunksResult = await wiraDb.fetchWiraFileChunks(
                            { 
                                wiraFileId: file.id 
                            }, 
                            1, 
                            file.chunkCount
                        );

                        if(!chunksResult || chunksResult.total === 0)
                        {
                            return { 
                                fileName: fileName, 
                                transcript: null 
                            };
                        }

                        const sorted = chunksResult.rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
                        const transcript = sorted.map(c => c.content).join(" ");

                        return { 
                            fileName: fileName, 
                            transcript: transcript 
                        };
                    }
                    catch(err)
                    {
                        console.error(`❌ fetchFilesContent: failed for ${fileName}:`, err.message);

                        return { 
                            fileName: fileName, 
                            transcript: null 
                        };
                    }
                }
            ));

            return {
                statusCode: 200,
                success: true,
                message: "File content fetched successfully.",
                data: results
            };
        }
        catch(error)
        {
            console.log("Error occured while fetching file content in Task class fetchFileContent", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch file content",
                data: null
            };
        }
    }

    //PARSES AN UPLOADED RESUME FILE AND EXTRACTS STRUCTURED PROFILE DATA.
    async parseResume()
    {
        try
        {
            const result = await this.ai.parseResume(this.data.fileName);

            if(!result.success)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to parse resume",
                    data: null
                };
            }

            return {
                statusCode: 200,
                success: true,
                message: "Resume parsed successfully.",
                data: result.data
            };
        }
        catch(error)
        {
            console.log("Error occured while parsing resume in Task class parseResume", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to parse resume",
                data: null
            };
        }
    }

    //FETCHES THE CANDIDATE'S PAST INTERVIEW PREPARATION TEST RESULTS FOR SPECIFIC JOBS.
    async fetchTests()
    {
        try
        {
            
        }
        catch(error)
        {
            console.log("Error occured while fetching tests in Task class fetchTests", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch tests",
                data: null
            };
        }
    }

    //GENERATES INTERVIEW PREPARATION QUESTIONS FOR A SPECIFIC JOB.
    async generateTest()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while generating test in Task class generateTest", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to generate test",
                data: null
            };
        }
    }

    //SAVES A SINGLE QUESTION'S ANSWER AND SCORE TO THE ACTIVE TEST SESSION.
    async storeTestAnswer()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while storing test answer in Task class storeTestAnswer", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to store test answer",
                data: null
            };
        }
    }

    //FINALIZES AND SUBMITS THE COMPLETED INTERVIEW PREPARATION TEST.
    async endTest()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while ending test in Task class endTest", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to end test",
                data: null
            };
        }
    }

    //FETCHES THE CANDIDATE'S PAST SCREENING RESULTS FOR SPECIFIC JOBS.
    async fetchScreenings()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while fetching screenings in Task class fetchScreenings", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch screenings",
                data: null
            };
        }
    }

    //GENERATES SCREENING QUESTIONS FOR A SPECIFIC JOB.
    async generateScreening()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while generating screening in Task class generateScreening", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to generate screening",
                data: null
            };
        }
    }

    //SCORES A SINGLE SCREENING RESPONSE AND SAVES IT TO THE ACTIVE SCREENING SESSION.
    async scoreScreening()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while scoring screening in Task class scoreScreening", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to score screening",
                data: null
            };
        }
    }

    //FINALIZES AND SUBMITS THE COMPLETED SCREENING WITH AN INTEREST LEVEL AND SCORE.
    async endScreening()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while ending screening in Task class endScreening", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to end screening",
                data: null
            };
        }
    }

    //SAVES PARTIAL PROFILE DATA COLLECTED DURING THE PROFILE COLLECTION FLOW.
    async storeProfile()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while storing profile in Task class storeProfile", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to store profile",
                data: null
            };
        }
    }

    //FINALIZES THE PROFILE COLLECTION FLOW AND COMMITS THE FULL PROFILE.
    async endProfile()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while ending profile in Task class endProfile", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to end profile",
                data: null
            };
        }
    }

    //GENERATES AN ATS-FRIENDLY RESUME FROM THE CANDIDATE'S PROFILE DATA.
    async createResume()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while creating resume in Task class createResume", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to create resume",
                data: null
            };
        }
    }

    //APPLIES THE CANDIDATE TO ONE OR MORE JOBS.
    async applyJobs()
    {
        try
        {
            const response = await axios.post(
                "https://white-force.com/plus/api/apply-jobs", 
                {
                    mobile: this.phone,
                    job_id: this.data.jobIds
                }, 
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
            
            if(response.data.status)
            {
                if(response.data.data && response.data.data.length > 0)
                {
                    return {
                        statusCode: 200,
                        success: true,
                        message: "Applied to jobs successfully.",
                        data: response.data.data,
                    };
                }
                else
                {
                    return {
                        statusCode: 400,
                        success: false,
                        message: "No jobs found matching the criteria.",
                        data: null,
                    };
                }
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured applying to jobs.",
                    data: null,
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while applying to jobs in Task class applyJobs", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to apply to jobs",
                data: null
            };
        }
    }

    //MARKS ONE OR MORE APPLIED JOBS AS NOT INTERESTED.
    async notInterested()
    {
        try
        {
            const response = await axios.post(
                "https://white-force.com/plus/api/not-interested", 
                {
                    mobile: this.phone,
                    jobIds: this.data.jobIds
                }, 
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
            
            if(response.data.status)
            {
                if(response.data.data && response.data.data.length > 0)
                {
                    return {
                        statusCode: 200,
                        success: true,
                        message: "Jobs set to not interested successfully.",
                        data: response.data.data
                    };
                }
                else
                {
                    return {
                        statusCode: 400,
                        success: false,
                        message: "No jobs found to set to not interested.",
                        data: null
                    };
                }
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error marking job as not interested.",
                    data: null,
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while marking jobs as not interested in Task class notInterested", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to mark jobs as not interested",
                data: null
            };
        }
    }

    //ADDS OR REMOVES ONE OR MORE JOBS FROM THE CANDIDATE'S WISHLIST.
    async toggleWishlist()
    {
        try
        {
            const response = await axios.post(
                `https://white-force.com/plus/api/update-candidate-wishlist`, 
                {
                    mobile: this.phone,
                    data: this.data.data
                },
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
                        
            if(response.data.status)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Wishlist updated successfully.",
                    data: response.data.data ?? null,
                };
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to update wishlist.",
                    data: null,
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while toggling wishlist in Task class toggleWishlist", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to toggle wishlist",
                data: null
            };
        }
    }

    //SUBSCRIBES THE CANDIDATE TO PERIODIC JOB RECOMMENDATIONS.
    async subscribe()
    {
        try
        {
            const response = await axios.post(
                `https://white-force.com/plus/api/job-subscription`, 
                {
                    mobile: this.phone,
                    action: "subscribe"
                }, 
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
            
            if(response.data.status)
            {
                if(response.data.data)
                {
                    if(response.data.data.subscribed)
                    {
                        return {
                            statusCode: 200,
                            success: true,
                            message: "Subscribed to White Force successfully.",
                            data: response.data.data
                        };
                    }
                    else
                    {
                        return {
                            statusCode: 200,
                            success: true,
                            message: "Unsubscribed from White Force successfully.",
                            data: response.data.data
                        };
                    }
                }
                else
                {
                    return {
                        statusCode: 500,
                        success: false,
                        message: "Error occured subscribing/unsubscribing to White Force.",
                        data: null,
                    };
                }
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured subscribing/unsubscribing to White Force.",
                    data: null,
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while subscribing in Task class subscribe", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to subscribe",
                data: null
            };
        }
    }

    //UNSUBSCRIBES THE CANDIDATE FROM PERIODIC JOB RECOMMENDATIONS.
    async unsubscribe()
    {
        try
        {
            const response = await axios.post(
                `https://white-force.com/plus/api/job-subscription`, 
                {
                    mobile: this.phone,
                    action: "unsubscribe"
                }, 
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
            
            if(response.data.status)
            {
                if(response.data.data)
                {
                    if(response.data.data.subscribed)
                    {
                        return {
                            statusCode: 200,
                            success: true,
                            message: "Subscribed to White Force successfully.",
                            data: response.data.data
                        };
                    }
                    else
                    {
                        return {
                            statusCode: 200,
                            success: true,
                            message: "Unsubscribed from White Force successfully.",
                            data: response.data.data
                        };
                    }
                }
                else
                {
                    return {
                        statusCode: 500,
                        success: false,
                        message: "Error occured subscribing/unsubscribing to White Force.",
                        data: null,
                    };
                }
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured subscribing/unsubscribing to White Force.",
                    data: null,
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while unsubscribing in Task class unsubscribe", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to unsubscribe",
                data: null
            };
        }
    }

    //SUBMITS THE CANDIDATE'S RESPONSE TO AN INTERVIEW INVITATION.
    async interviewResponse()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while submitting interview response in Task class interviewResponse", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to submit interview response",
                data: null
            };
        }
    }

    //SHORTLISTS THE CANDIDATE FOR ONE OR MORE SPECIFIC JOBS.
    async shortlistCandidate()
    {
        try
        {
            const response = await axios.post(
                "https://white-force.com/plus/api/shortlist-candidate", 
                {
                    mobile: this.phone,
                    job_id: this.data.jobIds
                }, 
                {
                    headers: 
                    {
                        "x-api-key": process.env.WIRA_API_KEY,
                    },
                }
            );
            
            if(response.data.status)
            {
                if(response.data.data)
                {
                    return {
                        statusCode: 200,
                        success: true,
                        message: "Candidate shortlisted successfully.",
                        data: response.data.data,
                    };
                }
                else
                {
                    return {
                        statusCode: 400,
                        success: false,
                        message: "No jobs found matching the criteria.",
                        data: null,
                    };
                }
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured shortlisting candidate for jobs.",
                    data: null,
                };
            }
        }
        catch(error)
        {
            console.log("Error occured while shortlisting candidate in Task class shortlistCandidate", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to shortlist candidate",
                data: null
            };
        }
    }

    //SCHEDULES A REMINDER FOR THE CANDIDATE AT A SPECIFIC DATE AND TIME.
    async setReminder()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while setting reminder in Task class setReminder", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to set reminder",
                data: null
            };
        }
    }

    //INJECTS ONE OR MORE SKILL PROMPTS INTO THE CURRENT TURN'S CONTEXT.
    async fetchSkills()
    {
        try
        {

        }
        catch(error)
        {
            console.log("Error occured while fetching skills in Task class fetchSkills", error);

            return {
                statusCode: 500,
                success: false,
                message: "Failed to fetch skills",
                data: null
            };
        }
    }
}

module.exports = Task