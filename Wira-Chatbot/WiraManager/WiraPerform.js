const axios = require("axios");
const WiraUtility = require("./WiraUtility");
const AI = require("@wira/shared/AI/executeAI");
const DB = require("@wira/shared/database/WiraDB");

class WiraPerform
{
    constructor(database, utility, queue, session)
    {
        this.database = database;
        this.utility = utility;
        this.queue = queue;
        this.session = session;
        this.pdfBuilder = require("@wira/Wira-AI/pdfBuilder/builder.js");
    }

    //Apply to jobs.
    async applyJobs(phone, jobIds)
    {
        try
        {
            const response = await axios.post("https://white-force.com/plus/api/apply-jobs", {
                mobile: phone,
                job_id: jobIds
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            });

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
            console.error("Error occured applying to jobs: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured applying to jobs.",
                data: null,
            };
        }     
    }

    //Shortlist candidate for jobs.
    async shortlistCandidate(phone, jobIds)
    {
        try
        {
            const response = await axios.post("https://white-force.com/plus/api/shortlist-candidate", {
                mobile: phone,
                job_id: jobIds
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            });

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
            console.error("Error occured shortlisting candidate for jobs: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured shortlisting candidate for jobs.",
                data: null,
            };
        }     
    }

    //Set job to not interested.
    async notInterested(phone, jobIds)
    {
        try
        {
            const response = await axios.post("https://white-force.com/plus/api/not-interested", {
                mobile: phone,
                jobIds: jobIds
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            });

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
            console.error("Error occured setting job to not interested: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured setting job to not interested.",
                data: null
            };
        }
    }

    //Subscribe to White Force.
    async toggleSubscribe(phone, action)
    {
        if(action !== "subscribe" && action !== "unsubscribe")
        {
            return {
                statusCode: 400,
                success: false,
                message: "Invalid action.",
                data: null
            };
        }
        
        try
        {
            const response = await axios.post(`https://white-force.com/plus/api/job-subscription`, {
                mobile: phone,
                action: action
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            });

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
            console.error("Error occured subscribing/unsubscribing to White Force: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured subscribing/unsubscribing to White Force.",
                data: null
            };
        }
    }

    //Submit Test Results.
    async submitTest(phone, jobId, interest, questions)
    {
        try
        {
            const totalPossible = questions.length * 10;
            const totalScored = questions.reduce((sum, q) => sum + (q.skipped ? 0 : (q.score || 0)), 0);
            const score = parseFloat(((totalScored / totalPossible) * 100).toFixed(2));

            const response = await axios.post(`https://white-force.com/plus/api/submit-test-result`, {
                mobile: phone,
                jobId: jobId,
                interest: interest,
                score: score,
                questions: questions.map((q) =>
                {
                    return {
                        type: q.type,
                        question: q.question,
                        answer: q.answer,
                        skipped: q.skipped,
                        score: q.skipped ? 0 : (q.score || 0)
                    };
                })
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            });

            if(response.data.status)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Test submitted successfully.",
                    data: response.data.data || null
                };
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured submitting test.",
                    data: null
                };
            }
        }
        catch(error)
        {
            console.error("Error occured submitting test: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured submitting test.",
                data: null
            };
        }
    }

    //Submit Screening Results.
    async submitScreening(phone, jobId, interest, score, questions)
    {
        try
        {
            const response = await axios.post(`https://white-force.com/plus/api/submit-screening-result`, {
                mobile: phone,
                jobId: jobId,
                interest: interest,
                score: score,
                questions: questions.map((q) =>
                {
                    return {
                        question: q.question,
                        answer: q.answer,
                        skipped: q.skipped
                    };
                })
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            });

            if(response.data.status)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Screening submitted successfully.",
                    data: response.data.data || null
                };
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured submitting screening.",
                    data: null
                };
            }
        }
        catch(error)
        {
            console.error("Error occured submitting screening: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured submitting screening.",
                data: null
            };
        }
    }

    //Submit interview responses for one or more jobs.
    async interviewResponse(phone, responses = [])
    {
        try
        {
            const response = await axios.post(`https://white-force.com/plus/api/interview-response`, {
                mobile: phone,
                responses: responses.map((r) =>
                {
                    const entry = {
                        jobId: r.jobId,
                        status: r.status,
                        remark: r.remark
                    };  

                    if(r.status === "rejected" || r.status === "reschedule-requested")
                    {
                        entry.reason = r.reason || null;
                    }

                    if(r.status === "reschedule-requested")
                    {
                        entry.preferredDate = r.preferredDate || null;
                        entry.preferredTimeFrom = r.preferredTimeFrom || null;
                        entry.preferredTimeTo = r.preferredTimeTo || null;
                        entry.preferredMedium = r.preferredMedium || null;
                    }

                    return entry;
                })
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            });

            if(response.data.status)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Interview responses submitted successfully.",
                    data: response.data.data || null
                };
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured submitting interview responses.",
                    data: null
                };
            }
        }
        catch(error)
        {
            console.error("Error occured submitting interview responses: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured submitting interview responses.",
                data: null
            };
        }
    }

    //Upsert candidate.
    async upsertCandidate(phone, data = {})
    {
        function serializeExperience(arr)
        {
            return JSON.stringify(arr.map(exp => ({
                company_name: exp.companyName ?? null,
                designation: exp.designation ?? null,
                current_salary: exp.currentSalary ?? null,
                total_experience: exp.totalExperience ?? null,
                is_current_company: exp.isCurrentCompany ?? null,
                start_date: exp.startDate ?? null,
                end_date: exp.endDate ?? null,
            })));
        }

        function serializeEducation(arr)
        {
            return JSON.stringify(arr.map(edu => ({
                education_type: edu.educationType ?? null,
                education_name: edu.educationName ?? null,
                education_year: edu.graduationYear ?? null,
                university: edu.university ?? null,
                start_date: edu.startDate ?? null,
                end_date: edu.endDate ?? null,
            })));
        }

        function transformPayload(data)
        {
            const fieldMap = {
                fullName: "name",
                phone: "mobile",
                email: "email",
                experience: "experience",
                preferredLocation: "preferred_location",
                country: "country",
                state: "state",
                city: "city",
                address: "address",
                postelCode: "pin_code",
                totalExperience: "total_experience",
                dateOfBirth: "date_of_birth",
                relocate: "is_relocate",
                expectedSalary: "expected_salary",
                maritalStatus: "marital_status",
                industry: "industry",
                noticePeriod: "notice_period",
                gender: "gender",
                communication: "communication",
                skills: "skills",
                source: "source",
                resume: "resume_file",
                resumeParserJson: "resume_parser_json",
                experienceData: "experience_details",
                educationData: "education_details",
                language: "languages",
            };

            const payload = {};

            for(const [jsKey, apiKey] of Object.entries(fieldMap))
            {
                if(!(jsKey in data))
                {
                    continue;
                }

                let value = data[jsKey];

                if(apiKey === "experience_details")
                {
                    value = serializeExperience(value);
                }
                else if(apiKey === "education_details")
                {
                    value = serializeEducation(value);
                }

                payload[apiKey] = value;
            }

            return payload;
        }

        function transformCandidateData(candidateData)
        {
            return {
                candidateId: candidateData.id,
                resume: candidateData.resume_file,
                resumeParserJson: candidateData.resume_parser_json,
                fullName: candidateData.name,
                phone: candidateData.mobile,
                email: candidateData.email,
                preferredLocation: candidateData.preferred_location,
                noticePeriod: candidateData.notice_period,
                industry: candidateData.industry,
                expectedSalary: candidateData.expected_salary,
                experience: candidateData.experience,
                totalExperience: candidateData.total_experience,
                experienceData: candidateData.experience_details ? JSON.parse(candidateData.experience_details).map(exp => ({
                    companyName: exp.company_name,
                    designation: exp.designation,
                    currentSalary: parseFloat(exp.current_salary)   || 0,
                    totalExperience: parseFloat(exp.total_experience) || 0,
                    isCurrentCompany: exp.is_current_company,
                    startDate: exp.start_date,
                    endDate: exp.end_date,
                })) : [],
                educationData: candidateData.education_details ? JSON.parse(candidateData.education_details).map(edu => ({
                    educationType: edu.education_type,
                    educationName: edu.education_name,
                    graduationYear: parseInt(edu.education_year) || null,
                    university: edu.university,
                    startDate: edu.start_date,
                    endDate: edu.end_date,
                })) : [],
                gender: candidateData.gender,
                maritalStatus: candidateData.marital_status,
                relocate: candidateData.is_relocate,
                language: candidateData.languages ? candidateData.languages.split(",").map(l => l.trim()) : [],
                communication: candidateData.communication,
                dateOfBirth: candidateData.date_of_birth,
                skills: candidateData.skills ? candidateData.skills.split(",").map(s => s.trim()) : [],
                country: candidateData.country,
                state: candidateData.state,
                city: candidateData.city,
                address: candidateData.address,
                postelCode: candidateData.pin_code,
            };
        }

        try
        {
            const response = await axios.post("https://white-force.com/plus/api/upsert-candidate",
            {
                mobile: phone,
                data: transformPayload(data),
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            });

            if(response.data.status)
            {
                const candidateData = response.data.data.candidateData ? transformCandidateData(response.data.data.candidateData) : null;

                return {
                    statusCode: 200,
                    success: true,
                    message: "Candidate profile created/updated successfully.",
                    data: {
                        ...response.data.data,
                        new: response.data.data.new ?? false,
                        mobile: (response.data.data.new && response.data.data.mobile) ? response.data.data.mobile : null,
                        password: (response.data.data.new && response.data.data.password) ? response.data.data.password : null,
                        email : (response.data.data.new && response.data.data.email) ? response.data.data.email : null,
                        candidateData: candidateData
                    } ?? null,
                };
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to create/update candidate profile.",
                    data: null,
                };
            }
        }
        catch(error)
        {
            console.error("Error creating/updating user profile: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error creating/updating user profile.",
                data: null,
            };
        }
    }

    //Toggle Wishlist for jobs
    async toggleWishlist(phone, data)
    {
        try
        {
            const response = await axios.post(`https://white-force.com/plus/api/update-candidate-wishlist`, {
                mobile: phone,
                data: data
            }, 
            {
                headers: {
                    "x-api-key": process.env.WIRA_API_KEY,
                },
            })
            
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
            console.error("Error toggling wishlist: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error toggling wishlist.",
                data: null,
            };
        }
    }

    //Create ATS Friendly Resume
    async createResume(phone, data)
    {
        try
        {
            const candidate = await DB.getWiraCandidateByPhone(phone);
            if(!candidate)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "Candidate not found.",
                    data: null
                };
            }

            const result = await this.pdfBuilder.createWiraResume(data);
            if(!result.success)
            {
                return {
                    statusCode: result.statusCode,
                    success: false,
                    message: result.message,
                    data: null
                };
            }

            const [fileRecord] = await Promise.all([
                DB.insertWiraFile({
                    wireCandidateId: candidate.id,
                    fileName: result.fileName,
                    fileType: result.fileType,
                    sizeKb: result.fileSize,
                    mimeType: "application/pdf",
                    extracted: false,
                    storagePath: result.filePath
                }),
                DB.updateWiraCandidates(
                    { 
                        atsResume: result.publicUrl 
                    },
                    { 
                        id: candidate.id 
                    }
                )
            ]);

            const session = await this.session.getSession(phone);
            if(session)
            {
                if(session.user)
                {
                    session.user.atsResume = result.publicUrl;
                }

                await this.session.updateSession(phone, session);
            }

            if(fileRecord && result.transcript)
            {
                const chunkText = (text, maxWords = 250) =>
                {
                    const words = text.split(/\s+/).filter(Boolean);
                    const chunks = [];

                    for(let i = 0; i < words.length; i += maxWords)
                    {
                        chunks.push(words.slice(i, i + maxWords).join(" "));
                    }

                    return chunks;
                };

                const chunks = chunkText(result.transcript, 250);

                (async () =>
                {
                    try
                    {
                        const { vectors, costInr } = await AI.runWiraEmbedChunks({ chunks });

                        const insertPromises = chunks.map((content, i) =>
                        {
                            const wordCount = content.split(/\s+/).filter(Boolean).length;

                            return DB.insertWiraFileChunk({
                                wiraFileId: fileRecord.id,
                                chunkIndex: i,
                                content: content,
                                wordCount: wordCount,
                                embedding: JSON.stringify(vectors[i])
                            });
                        });

                        await Promise.all(insertPromises);

                        await DB.updateWiraFiles(
                            {
                                extracted: true,
                                extractedAt: new Date(),
                                chunkCount: chunks.length,
                                embeddingCostInr: costInr
                            },
                            {
                                id: fileRecord.id
                            }
                        );
                    }
                    catch(error)
                    {
                        console.error(`❌ Resume embedding failed for wiraFileId ${fileRecord.id}:`, error.message);

                        await DB.updateWiraFiles(
                            { 
                                extracted: false 
                            },
                            { 
                                id: fileRecord.id 
                            }
                        ).catch(() => {});
                    }
                })();
            }

            return {
                statusCode: 200,
                success: true,
                message: "Resume created successfully.",
                data: {
                    atsResume: result.publicUrl,
                    files: [
                        {
                            fileName: result.fileName,
                            fileSize: result.fileSize,
                            fileType: result.fileType,
                            filePath: result.publicUrl,
                            saved: true,
                            message: "Resume saved successfully."
                        }
                    ]
                }
            };
        }
        catch(error)
        {
            console.error("Error occurred creating resume: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occurred creating resume.",
                data: null
            };
        }
    }
}

module.exports = WiraPerform;